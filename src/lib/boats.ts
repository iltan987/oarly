import { and, asc, eq } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, skillLevels } from '@/db/schema';

export type BoatType = typeof boatTypes.$inferSelect;
export type AllowedPayment = 'regular_only' | 'multisport_only' | 'both';

export interface BoatInput {
  name: string;
  seats: number;
  minSkillLevelId: string | null;
  allowedPayment: AllowedPayment;
  minAttendance: number | null;
}

export function listBoats(db: DB, clubId: string): Promise<BoatType[]> {
  return db.select().from(boatTypes).where(eq(boatTypes.clubId, clubId)).orderBy(asc(boatTypes.name));
}

async function skillBelongsToClub(db: DB, clubId: string, skillLevelId: string): Promise<boolean> {
  const [lvl] = await db.select({ id: skillLevels.id }).from(skillLevels)
    .where(and(eq(skillLevels.id, skillLevelId), eq(skillLevels.clubId, clubId))).limit(1);
  return Boolean(lvl);
}

export async function createBoat(db: DB, clubId: string, input: BoatInput): Promise<{ ok: true; id: string } | { ok: false; error: 'skill_not_in_club' }> {
  if (input.minSkillLevelId && !(await skillBelongsToClub(db, clubId, input.minSkillLevelId))) {
    return { ok: false, error: 'skill_not_in_club' };
  }
  const [row] = await db.insert(boatTypes).values({
    clubId, name: input.name, seats: input.seats, minSkillLevelId: input.minSkillLevelId,
    allowedPayment: input.allowedPayment, minAttendance: input.minAttendance,
  }).returning({ id: boatTypes.id });
  return { ok: true, id: row.id };
}

export async function updateBoat(db: DB, input: { clubId: string; boatId: string } & BoatInput): Promise<{ ok: true } | { ok: false; error: 'skill_not_in_club' | 'not_found' }> {
  if (input.minSkillLevelId && !(await skillBelongsToClub(db, input.clubId, input.minSkillLevelId))) {
    return { ok: false, error: 'skill_not_in_club' };
  }
  const res = await db.update(boatTypes).set({
    name: input.name, seats: input.seats, minSkillLevelId: input.minSkillLevelId,
    allowedPayment: input.allowedPayment, minAttendance: input.minAttendance,
  }).where(and(eq(boatTypes.id, input.boatId), eq(boatTypes.clubId, input.clubId)))
    .returning({ id: boatTypes.id });
  return res.length > 0 ? { ok: true } : { ok: false, error: 'not_found' };
}

export async function setBoatActive(db: DB, input: { clubId: string; boatId: string; active: boolean }): Promise<boolean> {
  const res = await db.update(boatTypes).set({ active: input.active })
    .where(and(eq(boatTypes.id, input.boatId), eq(boatTypes.clubId, input.clubId)))
    .returning({ id: boatTypes.id });
  return res.length > 0;
}
