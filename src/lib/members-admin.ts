import { and, eq } from 'drizzle-orm';

import { memberships, skillLevels } from '@/db/schema';
import type { DB } from '@/lib/membership';

export async function setMembershipStatus(
  db: DB,
  input: { membershipId: string; clubId: string; status: 'approved' | 'rejected' },
): Promise<boolean> {
  const res = await db.update(memberships)
    .set({ status: input.status })
    .where(and(eq(memberships.id, input.membershipId), eq(memberships.clubId, input.clubId)))
    .returning({ id: memberships.id });
  return res.length > 0;
}

export async function assignSkillLevel(
  db: DB,
  input: { membershipId: string; clubId: string; skillLevelId: string | null },
): Promise<boolean> {
  if (input.skillLevelId) {
    const [lvl] = await db.select({ id: skillLevels.id }).from(skillLevels)
      .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId))).limit(1);
    if (!lvl) return false;
  }
  const res = await db.update(memberships)
    .set({ skillLevelId: input.skillLevelId })
    .where(and(eq(memberships.id, input.membershipId), eq(memberships.clubId, input.clubId)))
    .returning({ id: memberships.id });
  return res.length > 0;
}
