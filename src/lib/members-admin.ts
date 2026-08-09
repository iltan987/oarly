import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';

import { memberships, skillLevels } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { DB } from '@/lib/membership';

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
