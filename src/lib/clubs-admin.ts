import { and, eq, ne } from 'drizzle-orm';

import { clubs, memberships, user } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { DB } from '@/lib/membership';
import { validateSlug } from '@/lib/slug';

// Better Auth's internal adapter lowercases `email` on both `createUser` and
// `findUserByEmail` (see internal-adapter.ts), so every row Better Auth writes
// already has a lowercase email — matching against `.toLowerCase()` here is
// consistent with how Better Auth itself looks users up, no `lower()` SQL needed.
export async function createClub(
  db: DB,
  input: { name: string; slug: string; ownerEmail: string; createdBy: string },
): Promise<{ ok: true; clubId: string } | { ok: false; error: 'slug_invalid' | 'slug_reserved' | 'slug_taken' | 'owner_not_found' }> {
  const v = validateSlug(input.slug);
  if (!v.ok) return { ok: false, error: v.reason === 'reserved' ? 'slug_reserved' : 'slug_invalid' };

  const [owner] = await db.select().from(user).where(eq(user.email, input.ownerEmail.trim().toLowerCase())).limit(1);
  if (!owner) return { ok: false, error: 'owner_not_found' };

  // `ne(status, 'rejected')` mirrors the partial index `clubs_slug_uq`: a rejected
  // request no longer holds its slug, so it must not report `slug_taken` either.
  const [existing] = await db.select({ id: clubs.id }).from(clubs)
    .where(and(eq(clubs.slug, input.slug), ne(clubs.status, 'rejected'))).limit(1);
  if (existing) return { ok: false, error: 'slug_taken' };

  return db.transaction(async (tx) => {
    const [club] = await tx.insert(clubs)
      .values({ name: input.name, slug: input.slug, status: 'active', createdBy: input.createdBy })
      .returning({ id: clubs.id });
    await tx.insert(memberships).values({ userId: owner.id, clubId: club.id, role: 'owner', status: 'approved' });
    await logAudit(tx, { actorUserId: input.createdBy, clubId: club.id, action: 'club.create', target: club.id, actingAsRole: 'admin' });
    return { ok: true, clubId: club.id };
  });
}

export type DecideClubRequestResult =
  | { ok: true; status: 'active' | 'rejected'; requesterId: string | null; clubName: string; clubSlug: string }
  | { ok: false; error: 'not_found' | 'not_pending' | 'note_required' };

/**
 * Decide a club REQUEST. Valid only on a row that is currently `pending`.
 *
 * Deliberately not `setClubStatus`: approving a new club and reinstating a
 * suspended one were indistinguishable to the audit trail when they shared one
 * function (spec §5.3). The note is required when rejecting so the requester's
 * email can say why, and optional when approving. That requirement cannot live in
 * the schema — `review_note` is nullable because an approval has none — so this
 * check is the only thing enforcing it.
 *
 * Returns the requester and club identity on success so the caller can send the
 * decision email AFTER the transaction commits — mail is best-effort and must
 * never roll back the decision (spec §5.4).
 */
export async function decideClubRequest(
  db: DB,
  input: { clubId: string; decision: 'approve' | 'reject'; note: string | null; actorId: string },
): Promise<DecideClubRequestResult> {
  const note = input.note?.trim() ? input.note.trim() : null;
  if (input.decision === 'reject' && !note) return { ok: false, error: 'note_required' };

  return db.transaction(async (tx) => {
    // `.for('update')` is load-bearing, not defensive. READ COMMITTED gives this
    // transaction a snapshot taken at each statement, so without the row lock two
    // admins clearing the queue in the same second both read `pending`, both pass the
    // guard below, and both write: the audit log then records the club as BOTH
    // approved and rejected, `reviewedBy`/`reviewNote` reflect whichever committed
    // last regardless of audit order, and the requester is emailed both decisions.
    // The lock makes the loser block until the winner commits, re-read `active` or
    // `rejected`, and refuse with `not_pending`.
    const [club] = await tx
      .select({ id: clubs.id, status: clubs.status, name: clubs.name, slug: clubs.slug, createdBy: clubs.createdBy })
      .from(clubs)
      .where(eq(clubs.id, input.clubId))
      .limit(1)
      .for('update');
    if (!club) return { ok: false, error: 'not_found' };
    if (club.status !== 'pending') return { ok: false, error: 'not_pending' };

    const status = input.decision === 'approve' ? ('active' as const) : ('rejected' as const);
    await tx.update(clubs)
      .set({ status, reviewedAt: new Date(), reviewedBy: input.actorId, reviewNote: note })
      .where(eq(clubs.id, club.id));
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: club.id,
      action: input.decision === 'approve' ? 'club.approve' : 'club.reject',
      target: club.id,
      actingAsRole: 'admin',
    });
    return { ok: true, status, requesterId: club.createdBy, clubName: club.name, clubSlug: club.slug };
  });
}

export type SetClubStatusResult =
  | { ok: true; status: 'active' | 'suspended' }
  | { ok: false; error: 'not_found' | 'not_decided' };

/**
 * Suspend or reinstate an ALREADY-DECIDED club. `pending` and `rejected` are
 * unreachable through here: a request is decided by `decideClubRequest`, and a
 * rejection is final. Reaching either through this function is a typed error,
 * not a silent write — that refusal is what stops the requests queue and the
 * clubs list from sharing one control again (spec §5.3).
 *
 * The `rejected` half is not merely tidy. Slug uniqueness is a PARTIAL index that
 * exempts rejected rows, so a live club may already hold a rejected club's slug;
 * walking that rejected row back to `active` would hit `clubs_slug_uq` at best,
 * and shadow a live club at worst.
 */
export async function setClubStatus(
  db: DB,
  input: { clubId: string; status: 'active' | 'suspended'; actorId: string },
): Promise<SetClubStatusResult> {
  return db.transaction(async (tx) => {
    // Same lock as `decideClubRequest`, for the same reason: a guard is only worth as
    // much as the read it guards, and an unlocked read under READ COMMITTED can be
    // stale by the time the UPDATE lands.
    //
    // Honest scope: today no verb can move a DECIDED club back to `pending` or
    // `rejected` — `decideClubRequest` only touches `pending` rows — so no currently
    // reachable interleaving makes this guard read the wrong status, and no test here
    // fails without this lock. It is defence in depth for the next writer (an archive
    // or delete verb), and it costs one clause. The alternative is that the two
    // decision paths in this file disagree about whether a status check needs a lock,
    // which is how the next one gets written without one.
    const [club] = await tx.select({ id: clubs.id, status: clubs.status })
      .from(clubs).where(eq(clubs.id, input.clubId)).limit(1).for('update');
    if (!club) return { ok: false, error: 'not_found' };
    if (club.status !== 'active' && club.status !== 'suspended') return { ok: false, error: 'not_decided' };

    await tx.update(clubs).set({ status: input.status }).where(eq(clubs.id, input.clubId));
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: input.status === 'active' ? 'club.activate' : 'club.suspend',
      target: input.clubId,
      actingAsRole: 'admin',
    });
    return { ok: true, status: input.status };
  });
}
