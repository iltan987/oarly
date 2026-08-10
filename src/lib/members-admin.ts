import { and, asc, eq, gt, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import type { DbOrTx } from '@/db';
import { memberships, penalties, skillLevels, user } from '@/db/schema';
import { recomputeBan } from '@/lib/attendance';
import { logAudit } from '@/lib/audit';
import type { DB } from '@/lib/membership';
import { clampPage } from '@/lib/pagination';
import { escapeLike } from '@/lib/search-params';

/** One page of the owner's roster. Same 25 as `/admin/users` and `/admin`. */
export const MEMBERS_PAGE_SIZE = 25;

/**
 * How many pending requests the page renders before it stops rendering rows and
 * starts rendering a number.
 *
 * NOT a page size: there is no page 2 for pending, on purpose. See
 * `listPendingMembers`.
 */
export const PENDING_CAP = 25;

/**
 * One person on the owner's members page — the membership and the identity that
 * makes it addressable, flattened.
 *
 * `status` is narrower than `membership_status`: `rejected` never appears, because
 * neither loader below selects it. That is the product's shape, not an oversight —
 * `setMembershipStatus` writes `rejected` and nothing in the console reads it back.
 */
export type ClubMemberRow = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  status: 'pending' | 'approved' | 'banned';
  skillLevelId: string | null;
  bannedUntil: Date | null;
};

/** The two statuses `searchClubMembers` answers about — the roster proper. */
const ROSTER_STATUSES = ['approved', 'banned'] as const;

/**
 * Narrow the column's four-value enum to the three this module returns.
 *
 * `rejected` is unreachable through either loader's WHERE clause, and it is thrown on
 * rather than folded into `approved`, because a rejected person rendered as an approved
 * member is the same class of collapse `restrictionState` exists to prevent — one
 * silently wrong row on the roster, with nothing on screen to say so. A WHERE clause
 * that drifts away from this mapping should be loud.
 */
function rosterStatus(status: (typeof memberships.$inferSelect)['status']): ClubMemberRow['status'] {
  if (status === 'rejected') throw new Error(`members-admin: unexpected membership status ${status}`);
  return status;
}

/**
 * The join requests waiting on the owner, oldest first, capped rather than paged.
 *
 * **Never paginated and never filtered by `?q=`.** It is a work queue, not a list: it
 * is small by construction because it drains, and hiding a join request behind page 2
 * of a search the owner typed to find somebody *else* is how a request sits unanswered
 * for a month. `total` is counted before the cap so the page can say "+N more" — a
 * number, which is a prompt to keep going, rather than a pager, which is a place to
 * leave people.
 *
 * Oldest first for the same reason: the longest-waiting request is the one that has
 * already cost the club the most, and it must not be pushed down by newer ones.
 * `id` breaks `joined_at` ties, which are real — `defaultNow()` is transaction time.
 */
export async function listPendingMembers(
  db: DbOrTx,
  opts: { clubId: string; cap?: number },
): Promise<{ rows: ClubMemberRow[]; total: number }> {
  const cap = opts.cap ?? PENDING_CAP;
  const where = and(eq(memberships.clubId, opts.clubId), eq(memberships.status, 'pending'));

  const [countRow] = await db.select({ n: sql<number>`count(*)::int` })
    .from(memberships).where(where);
  const total = countRow?.n ?? 0;

  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      name: user.name,
      email: user.email,
      status: memberships.status,
      skillLevelId: memberships.skillLevelId,
      bannedUntil: memberships.bannedUntil,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(where)
    .orderBy(asc(memberships.joinedAt), asc(memberships.id))
    .limit(cap);

  return { rows: rows.map((r) => ({ ...r, status: rosterStatus(r.status) })), total };
}

/**
 * Paged search over one club's roster — approved and banned members, by name or email.
 *
 * `src/lib/users-admin.ts:49-110` transposed to a single tenant, and deliberately line
 * for line: `escapeLike` + `ilike` on both columns because `name` is free text and one
 * case rule for the whole box is what an owner expects; the total counted BEFORE the
 * page is resolved, because the clamp needs it; `page` clamped here as well as at the
 * route, because it is interpolated into `OFFSET`, which Postgres parses as `bigint`,
 * and `?page=1.5` reached that as `12.5` and raised out of a render.
 *
 * There is no unbounded branch: an empty query is still capped at `pageSize`. A
 * 200-member club is exactly the case this function exists for.
 *
 * `id` breaks the name tie, and this is the half that a fixture with distinct names
 * cannot see. Names repeat in a rowing club — two Mehmets is unremarkable — and a
 * non-total ORDER BY makes offset pages OVERLAP: Postgres is free to return the tied
 * rows in a different order for the page-1 query than for the page-2 query, so one
 * member appears on both pages and another appears on neither. On a roster the owner is
 * working through to assign skill levels, "appears on neither" is a person who quietly
 * never gets one.
 */
export async function searchClubMembers(
  db: DbOrTx,
  opts: { clubId: string; q?: string; page?: number; pageSize?: number },
): Promise<{ rows: ClubMemberRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = opts.pageSize ?? MEMBERS_PAGE_SIZE;
  const q = opts.q?.trim();
  const pattern = q ? `%${escapeLike(q)}%` : null;
  const where = and(
    eq(memberships.clubId, opts.clubId),
    inArray(memberships.status, [...ROSTER_STATUSES]),
    pattern ? or(ilike(user.name, pattern), ilike(user.email, pattern)) : undefined,
  );

  // The count joins `user` too: the search predicate reads that table, so a count over
  // `memberships` alone would report a total the rows cannot fill.
  const [countRow] = await db.select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(where);
  const total = countRow?.n ?? 0;
  // Counted before the page is resolved on purpose: the clamp needs the total.
  const page = clampPage(opts.page, total, pageSize);

  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      name: user.name,
      email: user.email,
      status: memberships.status,
      skillLevelId: memberships.skillLevelId,
      bannedUntil: memberships.bannedUntil,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(where)
    // `id` breaks ties: names repeat, and a non-total order makes offset pages overlap.
    .orderBy(asc(user.name), asc(user.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows: rows.map((r) => ({ ...r, status: rosterStatus(r.status) })), total, page, pageSize };
}

/**
 * Approve or reject a join request. Wrapped in a transaction purely so the audit
 * row commits with the decision: a membership decision that left no trace is the
 * failure the audit log exists to prevent, and a statement plus an insert is a
 * trivial transaction (spec §4.3).
 *
 * COMPARE-AND-SWAP, not a blind write. The UPDATE used to match on identity alone,
 * so a request for the status the row ALREADY has still "succeeded" and still wrote
 * a `member.approve` row — a state transition that did not occur. Two things reach
 * that state routinely:
 *
 *  - one owner clicking Approve on a members page another owner has already actioned
 *    (the page is stale; the row is already `approved`), and
 *  - two owners approving the same pending member in the same second — reproduced on
 *    a warm pool, both returned true and the log gained TWO rows naming TWO different
 *    actors for one act.
 *
 * In a membership dispute that log names someone who took no action. This is the same
 * defect `setPlatformAdmin` documents at length, and it gets the same treatment:
 * read to distinguish "no such membership" from "already in that state", then guard
 * the UPDATE with `ne(status, …)` so the write itself is the arbiter under
 * concurrency. No explicit lock is needed and none is taken — the loser blocks on the
 * row, Postgres re-checks the `status <> 'approved'` qualification against the
 * committed version, nothing matches, and it returns without writing a second row.
 *
 * A no-op returns `true`, not `false`: the state the caller asked for is the state
 * that holds, so there is nothing for the owner to do differently and a refusal would
 * present a stale page as an error. `false` keeps its existing meaning — no such
 * membership in this club.
 */
export async function setMembershipStatus(
  db: DB,
  input: { membershipId: string; clubId: string; status: 'approved' | 'rejected'; actorId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.id, input.membershipId), eq(memberships.clubId, input.clubId)))
      .limit(1);
    // The membership does not exist, or belongs to another club. Logging here would be
    // noise that makes the log less trustworthy, not more.
    if (!current) return false;
    if (current.status === input.status) return true;

    const changed = await tx.update(memberships)
      .set({ status: input.status })
      .where(and(
        eq(memberships.id, input.membershipId),
        eq(memberships.clubId, input.clubId),
        ne(memberships.status, input.status),
      ))
      .returning({ id: memberships.id });
    // Lost the race: a concurrent transaction committed this exact transition first.
    // Its audit row is the true one; a second would name a second actor for one act.
    if (changed.length === 0) return true;

    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: input.status === 'approved' ? 'member.approve' : 'member.reject',
      target: input.membershipId,
      actingAsRole: 'owner',
    });
    return true;
  });
}

/**
 * Set (or clear) a member's skill level. Transactional for the same reason as above,
 * and compare-and-swap for the same reason as above: re-assigning the level a member
 * already has is a no-op, and a `member.skill_assign` row for it says a person's
 * standing in the club changed when it did not.
 *
 * The guard is `IS DISTINCT FROM`, spelled out rather than written as `ne`, because
 * `skill_level_id` is NULLABLE — clearing a level is a legitimate change and
 * `ne(col, null)` is `col <> NULL`, which is NULL, which matches nothing. That form
 * would have made "clear this member's level" silently unwritable.
 */
export async function assignSkillLevel(
  db: DB,
  input: { membershipId: string; clubId: string; skillLevelId: string | null; actorId: string },
): Promise<boolean> {
  if (input.skillLevelId) {
    const [lvl] = await db.select({ id: skillLevels.id }).from(skillLevels)
      .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId))).limit(1);
    if (!lvl) return false;
  }
  // `memberships.skill_level_id IS DISTINCT FROM $requested`, built from the two
  // primitives drizzle exposes so the null case is explicit rather than accidental.
  const distinctFromRequested = input.skillLevelId === null
    ? isNotNull(memberships.skillLevelId)
    : or(isNull(memberships.skillLevelId), ne(memberships.skillLevelId, input.skillLevelId));

  return db.transaction(async (tx) => {
    const identity = and(
      eq(memberships.id, input.membershipId),
      eq(memberships.clubId, input.clubId),
      eq(memberships.status, 'approved'),
    );
    const [current] = await tx.select({ skillLevelId: memberships.skillLevelId })
      .from(memberships).where(identity).limit(1);
    // No such membership in this club, or it is not approved — `false`, as before.
    if (!current) return false;
    if (current.skillLevelId === input.skillLevelId) return true;

    const changed = await tx.update(memberships)
      .set({ skillLevelId: input.skillLevelId })
      .where(and(identity, distinctFromRequested))
      .returning({ id: memberships.id });
    if (changed.length === 0) return true;

    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: 'member.skill_assign',
      target: input.membershipId,
      actingAsRole: 'owner',
    });
    return true;
  });
}

/**
 * Reverse the penalties a member is currently serving, and restore their standing.
 *
 * This is the only thing in the product that undoes a PERMANENT suspension. Nothing else
 * can: `setMembershipStatus('approved')` writes the status and leaves the permanent
 * penalty row exactly where it was, so the next `recomputeBan` — the next absence anyone
 * marks, or the next undo — folds it back in and re-bans the member. The escape hatch has
 * to remove the rows from the fold, and that is what this does.
 *
 * ## Which rows are "in force"
 *
 * `lifted_at IS NULL AND (permanent OR banned_until > now)`. Two halves, each excluding
 * something for its own reason:
 *
 *  - **Already lifted** rows are skipped so a second click cannot re-stamp them. The
 *    stamp is a record of who reversed what and when; overwriting it with a later
 *    owner's no-op relabels a decision that person did not take.
 *  - **Lapsed** rows — a timed penalty from March, on a membership permanently suspended
 *    in July — are skipped because they are not part of what is being reversed. Stamping
 *    them would enter, in the audit trail this whole design exists to keep, the claim
 *    that an owner reversed a penalty which had already expired on its own four months
 *    earlier. Leaving them costs nothing: `resolveBan` still folds them and they fold to
 *    a date in the past, which `restrictionState` reads as no restriction at all. So the
 *    member's `banned_until` after this call may be a PAST date rather than null, and
 *    that is correct.
 *
 * Rows with no ban at all (`off` policy: no end date, not permanent) are excluded by the
 * same predicate, which is right — they record an absence and restrict nothing, so there
 * is nothing about them to reverse.
 *
 * Everything in force goes, not just the permanent row. A member with a permanent
 * penalty AND a live timed one would otherwise come out of a "lift the suspension" still
 * paused until December, and — since the owner's control only appears on suspended rows —
 * with nothing left on screen to finish the job.
 *
 * ## Concurrency
 *
 * `FOR UPDATE` on the membership row first, exactly as `markNoShow` and `undoNoShow` now
 * take it, and for the reason set out at length on `recomputeBan`: this is a
 * read-modify-write over the same ban those two rewrite, and without the lock an owner
 * lifting while another marks an absence commits a membership reading 'approved' with a
 * fresh un-lifted permanent penalty under it.
 *
 * The UPDATE is expressed as a predicate rather than as `WHERE id IN (…ids read a moment
 * ago…)`. Under READ COMMITTED that second form re-evaluates identity alone against the
 * committed row and will happily stamp a row whose state changed in between — the defect
 * `markNoShow`'s cascade documents having shipped once already, where a `WHERE` on the
 * primary key relabelled a member's own cancellation as a penalty. Here the same shape
 * would stamp `lifted_at` on a row another transaction had just lifted, or on one that
 * lapsed between the read and the write.
 *
 * `true` for a no-op, `false` only for "no such membership in this club" — the same
 * meanings `setMembershipStatus` documents, and for the same reason: a stale page whose
 * member is no longer suspended is not an error the owner can act on. A no-op writes no
 * audit row, because an audit row means the thing happened.
 */
export async function liftPenalties(
  db: DB,
  input: { membershipId: string; clubId: string; actorId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [membership] = await tx
      .select({ id: memberships.id, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.id, input.membershipId), eq(memberships.clubId, input.clubId)))
      .limit(1)
      .for('update');
    // No such membership, or it belongs to another club. No audit row: noise here makes
    // the log less trustworthy, not more.
    if (!membership) return false;

    const lifted = await tx.update(penalties)
      .set({ liftedAt: now })
      .where(and(
        eq(penalties.membershipId, membership.id),
        isNull(penalties.liftedAt),
        or(eq(penalties.permanent, true), gt(penalties.bannedUntil, now)),
      ))
      .returning({ id: penalties.id });
    // Nothing was in force. The state the caller asked for is the state that holds, so
    // there is nothing to recompute and nothing happened to record.
    if (lifted.length === 0) return true;

    // Restores `status` and clears `bannedUntil` on its own, from the rows that are left.
    await recomputeBan(tx, membership.id, membership.status);

    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: 'member.penalty_lift',
      target: input.membershipId,
      actingAsRole: 'owner',
    });
    return true;
  });
}
