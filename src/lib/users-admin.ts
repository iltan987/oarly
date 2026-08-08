import { and, asc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';

import type { DB, DbOrTx } from '@/db';
import { clubs, memberships, user } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { clampPage } from '@/lib/pagination';

export type UserMembershipSummary = {
  clubId: string;
  clubName: string;
  role: 'owner' | 'member' | 'admin';
  status: 'pending' | 'approved' | 'rejected' | 'banned';
};

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  createdAt: Date;
  memberships: UserMembershipSummary[];
};

export const USERS_PAGE_SIZE = 25;

/**
 * Paged user search over email and name, case-insensitive substring.
 *
 * Offset pagination, unlike the audit log's keyset: this list is ordered by name
 * and does not grow at its head, so page boundaries are stable between clicks and
 * an operator can meaningfully ask for "page 3".
 *
 * There is no unbounded branch — an empty query is still capped at `pageSize`,
 * because the console's job is to answer "which user is this", not to stream the
 * whole `user` table into a render.
 *
 * Memberships are fetched in one follow-up query keyed by the page's user ids
 * rather than joined into the main select — a join would multiply the user rows
 * by their membership count and break both LIMIT and the total.
 *
 * `page` is clamped HERE and not only at the route, because it is interpolated into
 * `OFFSET`, which Postgres parses as `bigint`: `?page=1.5` reached this function as
 * an offset of `12.5` and raised `invalid input syntax for type bigint` out of the
 * render. A caller cannot be trusted to have sanitized a URL parameter, and the
 * returned `page` is the one actually shown — clamped to the last page that exists,
 * so the rows, the row range and the pagination links all describe the same page.
 */
export async function searchUsers(
  db: DbOrTx,
  opts: { q?: string; page?: number; pageSize?: number },
): Promise<{ rows: AdminUserRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = opts.pageSize ?? USERS_PAGE_SIZE;
  const q = opts.q?.trim();
  // Escape LIKE metacharacters so a literal `_` or `%` in a search box matches itself.
  // Unescaped, `_` is a single-character wildcard: searching `a_b` would quietly return
  // `axb` too, and the operator would never know the result set was wrong.
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  // `user.email` is stored lowercased by Better Auth, but `ilike` is used on both columns
  // anyway: `name` is free text, and one case rule for the whole box is what an operator
  // expects.
  const where = pattern ? or(ilike(user.email, pattern), ilike(user.name, pattern)) : undefined;

  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(user).where(where);
  const total = countRow?.n ?? 0;
  // Counted before the page is resolved on purpose: the clamp needs the total.
  const page = clampPage(opts.page, total, pageSize);

  const people = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(where)
    // `id` breaks ties: names repeat, and a non-total order makes offset pages overlap.
    .orderBy(asc(user.name), asc(user.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = people.map((p) => p.id);
  const links = ids.length
    ? await db
        .select({
          userId: memberships.userId,
          clubId: clubs.id,
          clubName: clubs.name,
          role: memberships.role,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(clubs, eq(clubs.id, memberships.clubId))
        .where(inArray(memberships.userId, ids))
        .orderBy(asc(clubs.name))
    : [];

  const byUser = new Map<string, UserMembershipSummary[]>();
  for (const l of links) {
    const list = byUser.get(l.userId) ?? [];
    list.push({ clubId: l.clubId, clubName: l.clubName, role: l.role, status: l.status });
    byUser.set(l.userId, list);
  }

  return {
    rows: people.map((p) => ({ ...p, memberships: byUser.get(p.id) ?? [] })),
    total,
    page,
    pageSize,
  };
}

export type SetPlatformAdminResult =
  | { ok: true; isAdmin: boolean }
  | { ok: false; error: 'not_found' | 'self_revoke' | 'last_admin' };

/**
 * Grant or revoke the platform-admin flag.
 *
 * Two guards, both here rather than in the UI, because a server action is
 * reachable by a direct POST and a layout does not govern it (spec §6.2):
 *
 *  - self-revoke is refused, so one misclick cannot lock the operator out of the
 *    console they are standing in;
 *  - the last remaining admin cannot be revoked, counted INSIDE this transaction
 *    with the admin rows locked `for update`. A count taken outside, or without
 *    the lock, lets two concurrent revokes each observe two admins and each
 *    proceed — emptying the set with nobody left to refill it.
 *
 * A request that asks for the flag the target ALREADY has is a no-op: it returns
 * `{ ok: true }` and writes nothing. Two operators on `/admin/users`, one revoking
 * while the other still has the pre-revoke page rendered, is enough to reach it —
 * as is a crafted POST. Without this check the second click wrote a
 * `user.admin_revoke` row for a revoke that did not happen, which is precisely the
 * lie an audit log exists to prevent. It also stops a duplicate grant from writing
 * a second `user.admin_grant`, and stops a revoke of a NON-admin from being refused
 * as `last_admin` — telling the operator "this is the last platform admin" about
 * someone who is not an admin at all.
 *
 * `{ ok: true }` rather than a `no_change` refusal: the state the operator asked
 * for is the state that holds, so there is nothing for them to do differently, and
 * a refusal would present a stale page as an error. What must not happen is the
 * audit row, and no audit row is written.
 *
 * The lock is what makes the second guard a guard. Under READ COMMITTED the loser
 * blocks on the locked rows, and when it is released Postgres re-checks the
 * `is_admin = true` qualification against the committed row version: the row the
 * winner just cleared drops out of the result, the count comes back as 1, and the
 * loser refuses.
 */
export async function setPlatformAdmin(
  db: DB,
  input: { targetUserId: string; isAdmin: boolean; actorId: string },
): Promise<SetPlatformAdminResult> {
  if (!input.isAdmin && input.targetUserId === input.actorId) return { ok: false, error: 'self_revoke' };

  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: user.id, isAdmin: user.isAdmin }).from(user)
      .where(eq(user.id, input.targetUserId)).limit(1);
    if (!target) return { ok: false, error: 'not_found' };
    // Already in the requested state — before the last-admin count, so revoking a
    // non-admin is a no-op rather than a nonsense `last_admin` refusal.
    if (target.isAdmin === input.isAdmin) return { ok: true, isAdmin: input.isAdmin };

    if (!input.isAdmin) {
      // `orderBy` before `for('update')` so concurrent revokes take the admin rows in
      // the same order and block instead of deadlocking.
      const admins = await tx.select({ id: user.id }).from(user)
        .where(eq(user.isAdmin, true)).orderBy(asc(user.id)).for('update');
      if (admins.length <= 1) return { ok: false, error: 'last_admin' };
    }

    // `ne(...)` repeats the read above as a WHERE clause, which is what makes the
    // no-op check hold under concurrency: the grant path takes no lock, so two
    // simultaneous grants both read `is_admin = false`. The loser blocks on the row,
    // Postgres re-checks this qualification against the committed version, no row
    // matches, and it returns without writing a second `user.admin_grant`.
    const changed = await tx.update(user).set({ isAdmin: input.isAdmin })
      .where(and(eq(user.id, input.targetUserId), ne(user.isAdmin, input.isAdmin)))
      .returning({ id: user.id });
    if (changed.length === 0) return { ok: true, isAdmin: input.isAdmin };
    // No `clubId`: the platform-admin flag is not scoped to a club, and inventing one
    // would be a lie in the log.
    await logAudit(tx, {
      actorUserId: input.actorId,
      action: input.isAdmin ? 'user.admin_grant' : 'user.admin_revoke',
      target: input.targetUserId,
      actingAsRole: 'admin',
    });
    return { ok: true, isAdmin: input.isAdmin };
  });
}
