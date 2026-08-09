import { and, asc, eq, sql } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, skillLevels } from '@/db/schema';
import { logAudit } from '@/lib/audit';

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

/**
 * The three mutations below are each wrapped in a transaction purely so the audit
 * row commits with the change (spec §4.3). The logged `clubId` is the caller's,
 * which is safe because every write below is either scoped by `clubId` in its
 * `WHERE` (so a row from another club yields no update and no log) or inserts the
 * boat under that very `clubId` — the log can never attribute a boat to a club
 * the write did not touch.
 */
export async function createBoat(db: DB, clubId: string, input: BoatInput, actorId: string): Promise<{ ok: true; id: string } | { ok: false; error: 'skill_not_in_club' }> {
  if (input.minSkillLevelId && !(await skillBelongsToClub(db, clubId, input.minSkillLevelId))) {
    return { ok: false, error: 'skill_not_in_club' };
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(boatTypes).values({
      clubId, name: input.name, seats: input.seats, minSkillLevelId: input.minSkillLevelId,
      allowedPayment: input.allowedPayment, minAttendance: input.minAttendance,
    }).returning({ id: boatTypes.id });
    await logAudit(tx, { actorUserId: actorId, clubId, action: 'boat.create', target: row.id, actingAsRole: 'owner' });
    return { ok: true, id: row.id };
  });
}

export async function updateBoat(db: DB, input: { clubId: string; boatId: string; actorId: string } & BoatInput): Promise<{ ok: true } | { ok: false; error: 'skill_not_in_club' | 'not_found' }> {
  if (input.minSkillLevelId && !(await skillBelongsToClub(db, input.clubId, input.minSkillLevelId))) {
    return { ok: false, error: 'skill_not_in_club' };
  }
  return db.transaction(async (tx) => {
    const res = await tx.update(boatTypes).set({
      name: input.name, seats: input.seats, minSkillLevelId: input.minSkillLevelId,
      allowedPayment: input.allowedPayment, minAttendance: input.minAttendance,
    }).where(and(eq(boatTypes.id, input.boatId), eq(boatTypes.clubId, input.clubId)))
      .returning({ id: boatTypes.id });
    if (res.length === 0) return { ok: false, error: 'not_found' };
    await logAudit(tx, { actorUserId: input.actorId, clubId: input.clubId, action: 'boat.update', target: input.boatId, actingAsRole: 'owner' });
    return { ok: true };
  });
}

export async function setBoatActive(db: DB, input: { clubId: string; boatId: string; active: boolean; actorId: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const res = await tx.update(boatTypes).set({ active: input.active })
      .where(and(eq(boatTypes.id, input.boatId), eq(boatTypes.clubId, input.clubId)))
      .returning({ id: boatTypes.id });
    if (res.length === 0) return false;
    await logAudit(tx, { actorUserId: input.actorId, clubId: input.clubId, action: 'boat.set_active', target: input.boatId, actingAsRole: 'owner' });
    return true;
  });
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
