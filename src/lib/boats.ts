import { and, asc, eq, sql } from 'drizzle-orm';

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

/**
 * Spec §5.2's invariant, defended on the write path: no boat may advertise
 * MultiSport at a club that has MultiSport off, or it becomes unbookable. The
 * editor hides the payment field when the flag is off, but `allowedPayment`
 * still arrives from FormData, so a crafted POST could otherwise re-create
 * exactly the stranded boat disabling the flag exists to prevent.
 *
 * `both` is deliberately untouched — it already permits cash, so it is not
 * stranded, and rewriting it would destroy a setting the owner never saw.
 */
export function clampAllowedPayment<T extends { allowedPayment: AllowedPayment }>(input: T, clubMultisportEnabled: boolean): T {
  if (clubMultisportEnabled || input.allowedPayment !== 'multisport_only') return input;
  return { ...input, allowedPayment: 'regular_only' };
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

/**
 * How many of this club's boats are currently MultiSport-only — the count the
 * policies page's disable-confirmation reports, since that many would be
 * converted to cash-only (see `updateSchedulingSettings`'s `convertedBoats`).
 * A plain read, so it does not itself change anything.
 */
export async function countMultisportOnlyBoats(db: DB, clubId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(boatTypes)
    .where(and(eq(boatTypes.clubId, clubId), eq(boatTypes.allowedPayment, 'multisport_only')));
  return row?.n ?? 0;
}
