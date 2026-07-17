import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, memberships, skillLevels } from '@/db/schema';

export type SkillLevel = typeof skillLevels.$inferSelect;

export function listSkillLevels(db: DB, clubId: string): Promise<SkillLevel[]> {
  return db.select().from(skillLevels).where(eq(skillLevels.clubId, clubId)).orderBy(asc(skillLevels.rank));
}

export async function createSkillLevel(db: DB, input: { clubId: string; name: string }): Promise<SkillLevel> {
  const [agg] = await db.select({ maxRank: sql<number | null>`max(${skillLevels.rank})` }).from(skillLevels).where(eq(skillLevels.clubId, input.clubId));
  const nextRank = (agg?.maxRank ?? 0) + 1;
  const [row] = await db.insert(skillLevels).values({ clubId: input.clubId, name: input.name, rank: nextRank }).returning();
  return row;
}

export async function renameSkillLevel(db: DB, input: { clubId: string; skillLevelId: string; name: string }): Promise<boolean> {
  const res = await db.update(skillLevels).set({ name: input.name })
    .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId)))
    .returning({ id: skillLevels.id });
  return res.length > 0;
}

// Swap a level with its rank-neighbor. The unique index on (club_id, rank) is
// checked immediately (not deferrable), so we cannot set two rows to overlapping
// ranks mid-transaction. We park the moving row at a collision-free sentinel
// (-cur.rank; ranks are >= 1 and unique per club, so distinct rows map to
// distinct sentinels, and the row is locked for the duration of the tx).
export async function reorderSkillLevel(db: DB, input: { clubId: string; skillLevelId: string; direction: 'up' | 'down' }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(skillLevels)
      .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId))).limit(1);
    if (!cur) return false;
    const [neighbor] = input.direction === 'up'
      ? await tx.select().from(skillLevels)
          .where(and(eq(skillLevels.clubId, input.clubId), lt(skillLevels.rank, cur.rank)))
          .orderBy(desc(skillLevels.rank)).limit(1)
      : await tx.select().from(skillLevels)
          .where(and(eq(skillLevels.clubId, input.clubId), gt(skillLevels.rank, cur.rank)))
          .orderBy(asc(skillLevels.rank)).limit(1);
    if (!neighbor) return false;
    await tx.update(skillLevels).set({ rank: -cur.rank }).where(eq(skillLevels.id, cur.id));
    await tx.update(skillLevels).set({ rank: cur.rank }).where(eq(skillLevels.id, neighbor.id));
    await tx.update(skillLevels).set({ rank: neighbor.rank }).where(eq(skillLevels.id, cur.id));
    return true;
  });
}

export async function countSkillLevelRefs(db: DB, input: { clubId: string; skillLevelId: string }): Promise<{ members: number; boats: number }> {
  const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(memberships)
    .where(and(eq(memberships.clubId, input.clubId), eq(memberships.skillLevelId, input.skillLevelId)));
  const [b] = await db.select({ n: sql<number>`count(*)::int` }).from(boatTypes)
    .where(and(eq(boatTypes.clubId, input.clubId), eq(boatTypes.minSkillLevelId, input.skillLevelId)));
  return { members: m?.n ?? 0, boats: b?.n ?? 0 };
}

export async function deleteSkillLevel(db: DB, input: { clubId: string; skillLevelId: string }): Promise<boolean> {
  const res = await db.delete(skillLevels)
    .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId)))
    .returning({ id: skillLevels.id });
  return res.length > 0;
}
