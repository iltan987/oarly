import { and, eq } from 'drizzle-orm';

import { memberships, skillLevels } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { DB } from '@/lib/membership';

/**
 * Approve or reject a join request. Wrapped in a transaction purely so the audit
 * row commits with the decision: a membership decision that left no trace is the
 * failure the audit log exists to prevent, and a statement plus an insert is a
 * trivial transaction (spec §4.3).
 */
export async function setMembershipStatus(
  db: DB,
  input: { membershipId: string; clubId: string; status: 'approved' | 'rejected'; actorId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const res = await tx.update(memberships)
      .set({ status: input.status })
      .where(and(eq(memberships.id, input.membershipId), eq(memberships.clubId, input.clubId)))
      .returning({ id: memberships.id });
    // No-op: the membership does not exist, or belongs to another club. Logging
    // here would be noise that makes the log less trustworthy, not more.
    if (res.length === 0) return false;
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

/** Set (or clear) a member's skill level. Transactional for the same reason as above. */
export async function assignSkillLevel(
  db: DB,
  input: { membershipId: string; clubId: string; skillLevelId: string | null; actorId: string },
): Promise<boolean> {
  if (input.skillLevelId) {
    const [lvl] = await db.select({ id: skillLevels.id }).from(skillLevels)
      .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId))).limit(1);
    if (!lvl) return false;
  }
  return db.transaction(async (tx) => {
    const res = await tx.update(memberships)
      .set({ skillLevelId: input.skillLevelId })
      .where(and(
        eq(memberships.id, input.membershipId),
        eq(memberships.clubId, input.clubId),
        eq(memberships.status, 'approved'),
      ))
      .returning({ id: memberships.id });
    if (res.length === 0) return false;
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
