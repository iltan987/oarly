import { and, asc, eq, ne, type SQL, sql } from 'drizzle-orm';

import type { DbOrTx } from '@/db';
import { boatTypes, clubs, memberships, scheduleWindows, user } from '@/db/schema';
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

export type TransferOwnershipResult =
  | { ok: true; fromUserId: string | null }
  | { ok: false; error: 'club_not_found' | 'target_not_member' | 'already_owner' };

/**
 * Move ownership of a club to an existing approved member.
 *
 * A TRANSFER, not an invitation: the target must already be an approved member of
 * this club. Promoting a stranger is the invitation flow, which is deferred
 * (spec §7). Until now `memberships.role` was only ever written at INSERT time —
 * there is no `setRole` anywhere — so a club whose owner walked away could not be
 * reassigned by anyone, including a platform admin (spec §6.3).
 *
 * Demote-then-promote in ONE transaction, so the club is never observed ownerless
 * and never observed with two owners; this cycle does not introduce multiple owners.
 */
export async function transferOwnership(
  db: DB,
  input: { clubId: string; toUserId: string; actorId: string },
): Promise<TransferOwnershipResult> {
  return db.transaction(async (tx) => {
    // `.for('update')` on the CLUB row is what serialises two concurrent transfers,
    // and it is load-bearing rather than defensive. This function reads the
    // memberships, decides, and then writes two of them — the same check-then-act
    // shape that let two concurrent `decideClubRequest` calls both win. Without the
    // lock, under READ COMMITTED: both transactions read their own target as an
    // eligible member; the first demotes the owner and promotes its target; the
    // second's demote (`WHERE role = 'owner'`) blocks, then re-evaluates against the
    // committed row, finds it is now `member`, matches NOTHING, and promotes a
    // SECOND owner. The club ends with two. Locking the club row instead of the
    // membership rows is deliberate: the two racers target DIFFERENT membership
    // rows, so a lock on those would not make them meet.
    const [club] = await tx.select({ id: clubs.id }).from(clubs)
      .where(eq(clubs.id, input.clubId)).limit(1).for('update');
    if (!club) return { ok: false, error: 'club_not_found' };

    // Scoped by clubId AND userId: a membership in some other club is not a
    // membership in this one, and matching on the user alone would let any approved
    // member anywhere be handed this club.
    //
    // Also locked, for a different race than the one above: a concurrent
    // member-rejection or ban on this exact row would otherwise land between this
    // read and the promote, and hand the club to someone the club just removed.
    const [target] = await tx
      .select({ id: memberships.id, role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.clubId, input.clubId), eq(memberships.userId, input.toUserId)))
      .limit(1)
      .for('update');
    if (!target || target.status !== 'approved') return { ok: false, error: 'target_not_member' };
    // Refused BEFORE the demote, not merely as a courtesy: the demote below matches
    // every `owner` row of this club, so falling through with an already-owner target
    // would demote the target and then re-promote it — or, if the two statements ever
    // drift apart, leave the club with no owner at all.
    if (target.role === 'owner') return { ok: false, error: 'already_owner' };

    // Demote first, promote second. The reverse order would momentarily match the
    // freshly promoted row with `WHERE role = 'owner'` and undo itself.
    const demoted = await tx.update(memberships).set({ role: 'member' })
      .where(and(eq(memberships.clubId, input.clubId), eq(memberships.role, 'owner')))
      .returning({ userId: memberships.userId });
    await tx.update(memberships).set({ role: 'owner' }).where(eq(memberships.id, target.id));

    // Inside the transaction, on `tx`: a role change that committed without its audit
    // row is precisely what an audit log exists to make impossible.
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: 'club.transfer_owner',
      target: input.toUserId,
      actingAsRole: 'admin',
    });
    // `null` when the club had no owner to begin with — the exact situation this
    // function was added to repair, so it is a normal outcome, not an error.
    return { ok: true, fromUserId: demoted[0]?.userId ?? null };
  });
}

/**
 * How many owners and transfer candidates `/admin/clubs/[id]` will load.
 *
 * Neither list is paginated, so both are capped rather than unbounded: a club with
 * a thousand approved members must not turn one admin page view into a thousand-row
 * fetch feeding a thousand-option `<select>`. A club has exactly one owner, so
 * `OWNER_LIMIT` only ever matters for pre-existing data.
 */
const OWNER_LIMIT = 10;
export const TRANSFER_CANDIDATE_LIMIT = 200;

export type ClubAdminDetail = {
  club: typeof clubs.$inferSelect;
  reviewedByName: string | null;
  owners: { userId: string; name: string; email: string }[];
  memberCounts: { pending: number; approved: number; rejected: number; banned: number };
  transferCandidates: { userId: string; name: string; email: string }[];
  boatCount: number;
  windowCount: number;
};

/** Everything `/admin/clubs/[id]` renders, in one place, keyed by id (spec §6.1). */
export async function getClubAdminDetail(db: DbOrTx, clubId: string): Promise<ClubAdminDetail | null> {
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId)).limit(1);
  if (!club) return null;

  // A FUNCTION, not a shared builder: drizzle's `.where()`/`.limit()` mutate the
  // query object and return `this`, so reusing one builder for both lists below
  // would have the second call overwrite the first's WHERE clause.
  const people = (where: SQL | undefined, limit: number) => db
    .select({ userId: memberships.userId, name: user.name, email: user.email })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(where)
    // `user.id` breaks the tie so the order is total: names are not unique, and a
    // list that reshuffles between renders is a list an admin cannot click safely.
    .orderBy(asc(user.name), asc(user.id))
    .limit(limit);

  const [owners, transferCandidates, counts, boats, windows] = await Promise.all([
    people(and(eq(memberships.clubId, clubId), eq(memberships.role, 'owner')), OWNER_LIMIT),
    // Approved non-owners only — `transferOwnership` refuses everyone else, so
    // offering them here would only ever produce a guaranteed error toast.
    people(
      and(
        eq(memberships.clubId, clubId),
        ne(memberships.role, 'owner'),
        eq(memberships.status, 'approved'),
      ),
      TRANSFER_CANDIDATE_LIMIT,
    ),
    // Grouped, not four round trips and not a full roster in memory: the result is
    // bounded by the four values of `membership_status`.
    db.select({ status: memberships.status, n: sql<number>`count(*)::int` })
      .from(memberships).where(eq(memberships.clubId, clubId)).groupBy(memberships.status),
    db.select({ n: sql<number>`count(*)::int` }).from(boatTypes).where(eq(boatTypes.clubId, clubId)),
    db.select({ n: sql<number>`count(*)::int` }).from(scheduleWindows).where(eq(scheduleWindows.clubId, clubId)),
  ]);

  const memberCounts = { pending: 0, approved: 0, rejected: 0, banned: 0 };
  for (const row of counts) memberCounts[row.status] = row.n;

  let reviewedByName: string | null = null;
  if (club.reviewedBy) {
    // `reviewed_by` is `on delete set null` on the column but the reviewer may still
    // have been deleted between the decision and now, so a missing row is normal.
    const [reviewer] = await db.select({ name: user.name }).from(user).where(eq(user.id, club.reviewedBy)).limit(1);
    reviewedByName = reviewer?.name ?? null;
  }

  return {
    club,
    reviewedByName,
    owners,
    memberCounts,
    transferCandidates,
    boatCount: boats[0]?.n ?? 0,
    windowCount: windows[0]?.n ?? 0,
  };
}
