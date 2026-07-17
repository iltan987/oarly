import { and, asc, eq, inArray } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, scheduleWindows, windowBoats } from '@/db/schema';

export type ScheduleWindow = typeof scheduleWindows.$inferSelect;
export type WindowError = 'end_before_start' | 'uneven_tiling' | 'overlap' | 'invalid_boats' | 'not_found';
export type WindowResult = { ok: true; id: string } | { ok: false; error: WindowError };

export interface WindowBoatInput {
  boatTypeId: string;
  quantity: number;
}
export interface WindowInput {
  weekday: number;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  defaultSessionMinutes: number;
  boats: WindowBoatInput[];
}
export interface WindowWithBoats extends ScheduleWindow {
  boats: { boatTypeId: string; boatName: string; quantity: number }[];
}

/** Parse a Postgres `time` value ("HH:MM" or "HH:MM:SS") into minutes-from-midnight. */
function toMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

export async function listWindowsWithBoats(db: DB, clubId: string): Promise<WindowWithBoats[]> {
  const windows = await db
    .select()
    .from(scheduleWindows)
    .where(eq(scheduleWindows.clubId, clubId))
    .orderBy(asc(scheduleWindows.weekday), asc(scheduleWindows.startTime));
  if (windows.length === 0) return [];
  const rows = await db
    .select({ windowId: windowBoats.windowId, boatTypeId: windowBoats.boatTypeId, quantity: windowBoats.quantity, boatName: boatTypes.name })
    .from(windowBoats)
    .innerJoin(boatTypes, eq(windowBoats.boatTypeId, boatTypes.id))
    .where(inArray(windowBoats.windowId, windows.map((w) => w.id)));
  return windows.map((w) => ({
    ...w,
    boats: rows.filter((r) => r.windowId === w.id).map((r) => ({ boatTypeId: r.boatTypeId, boatName: r.boatName, quantity: r.quantity })),
  }));
}

/**
 * Validate a window against the club's other windows and boats. Reads run on the
 * outer `db` connection (owner config is not a concurrency-sensitive path), so the
 * transaction that follows only performs writes.
 */
async function validate(db: DB, clubId: string, input: WindowInput, excludeWindowId: string | null): Promise<WindowError | null> {
  const start = toMinutes(input.startTime);
  const end = toMinutes(input.endTime);
  if (end <= start) return 'end_before_start';
  if (input.defaultSessionMinutes < 5 || (end - start) % input.defaultSessionMinutes !== 0) return 'uneven_tiling';

  if (input.boats.length === 0) return 'invalid_boats';
  const ids = input.boats.map((b) => b.boatTypeId);
  if (new Set(ids).size !== ids.length) return 'invalid_boats';
  if (input.boats.some((b) => b.quantity < 1)) return 'invalid_boats';
  const active = await db.select({ id: boatTypes.id }).from(boatTypes).where(and(eq(boatTypes.clubId, clubId), eq(boatTypes.active, true)));
  const activeIds = new Set(active.map((b) => b.id));
  if (ids.some((id) => !activeIds.has(id))) return 'invalid_boats';

  const sameDay = await db.select().from(scheduleWindows).where(and(eq(scheduleWindows.clubId, clubId), eq(scheduleWindows.weekday, input.weekday)));
  for (const w of sameDay) {
    if (excludeWindowId && w.id === excludeWindowId) continue;
    // strict overlap; touching boundaries (a.end === b.start) are allowed.
    if (start < toMinutes(w.endTime) && toMinutes(w.startTime) < end) return 'overlap';
  }
  return null;
}

export async function createWindow(db: DB, clubId: string, input: WindowInput): Promise<WindowResult> {
  const err = await validate(db, clubId, input, null);
  if (err) return { ok: false, error: err };
  return db.transaction(async (tx) => {
    const [w] = await tx
      .insert(scheduleWindows)
      .values({ clubId, weekday: input.weekday, startTime: input.startTime, endTime: input.endTime, defaultSessionMinutes: input.defaultSessionMinutes })
      .returning({ id: scheduleWindows.id });
    await tx.insert(windowBoats).values(input.boats.map((b) => ({ windowId: w.id, boatTypeId: b.boatTypeId, quantity: b.quantity })));
    return { ok: true, id: w.id };
  });
}

export async function updateWindow(db: DB, input: { clubId: string; windowId: string } & WindowInput): Promise<WindowResult> {
  const [existing] = await db
    .select({ id: scheduleWindows.id })
    .from(scheduleWindows)
    .where(and(eq(scheduleWindows.id, input.windowId), eq(scheduleWindows.clubId, input.clubId)))
    .limit(1);
  if (!existing) return { ok: false, error: 'not_found' };
  const err = await validate(db, input.clubId, input, input.windowId);
  if (err) return { ok: false, error: err };
  return db.transaction(async (tx) => {
    await tx
      .update(scheduleWindows)
      .set({ weekday: input.weekday, startTime: input.startTime, endTime: input.endTime, defaultSessionMinutes: input.defaultSessionMinutes })
      .where(and(eq(scheduleWindows.id, input.windowId), eq(scheduleWindows.clubId, input.clubId)));
    await tx.delete(windowBoats).where(eq(windowBoats.windowId, input.windowId));
    await tx.insert(windowBoats).values(input.boats.map((b) => ({ windowId: input.windowId, boatTypeId: b.boatTypeId, quantity: b.quantity })));
    return { ok: true, id: input.windowId };
  });
}

export async function deleteWindow(db: DB, input: { clubId: string; windowId: string }): Promise<boolean> {
  const res = await db
    .delete(scheduleWindows)
    .where(and(eq(scheduleWindows.id, input.windowId), eq(scheduleWindows.clubId, input.clubId)))
    .returning({ id: scheduleWindows.id });
  return res.length > 0;
}
