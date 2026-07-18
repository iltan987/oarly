import { addMinutes } from 'date-fns';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, clubHolidayOverrides, clubs, holidays, scheduleWindows, sessions, slots, windowBoats } from '@/db/schema';

import { resolveDateOpen } from './calendar-rules';
import { addDaysISO, eachDateISO, minutesToHHMM, toMinutes, utcToClubDate, weekdayOfDateISO, zonedWallClockToUtc } from './date-tz';

export type VirtualSession = {
  boatTypeId: string;
  boatName: string;
  capacity: number;
  minAttendance: number | null;
  occurrence: number;             // 0..quantity-1 (display/debug)
  status: 'open' | 'closed' | 'cancelled';
  persisted: boolean;
};
export type VirtualSlot = {
  dateISO: string;
  startAt: Date;
  endAt: Date;
  windowId: string | null;        // null when surfaced from a since-deleted window
  persisted: boolean;
  sessions: VirtualSession[];
};
export type CalendarDay = {
  dateISO: string;
  weekday: number;
  closed: boolean;
  closedReason: 'holiday' | 'override' | null;
  slots: VirtualSlot[];
};

type WindowBoat = { boatTypeId: string; boatName: string; seats: number; minAttendance: number | null; quantity: number };
type GroupedWindow = { windowId: string; weekday: number; startTime: string; endTime: string; minutes: number; boats: WindowBoat[] };

export async function computeCalendar(
  db: DB,
  clubId: string,
  opts: { fromDateISO: string; days: number; now?: Date },
): Promise<CalendarDay[]> {
  const { fromDateISO, days } = opts;
  const endISO = addDaysISO(fromDateISO, days); // exclusive
  const dateList = eachDateISO(fromDateISO, days);

  const [club] = await db.select({ timezone: clubs.timezone, openOnHolidays: clubs.openOnHolidays }).from(clubs).where(eq(clubs.id, clubId));
  if (!club) throw new Error(`club not found: ${clubId}`);

  // Active-boat windows for this club, grouped by window.
  const windowRows = await db
    .select({
      windowId: scheduleWindows.id, weekday: scheduleWindows.weekday, startTime: scheduleWindows.startTime, endTime: scheduleWindows.endTime, minutes: scheduleWindows.defaultSessionMinutes,
      boatTypeId: windowBoats.boatTypeId, quantity: windowBoats.quantity, boatName: boatTypes.name, seats: boatTypes.seats, boatMinAttendance: boatTypes.minAttendance,
    })
    .from(scheduleWindows)
    .innerJoin(windowBoats, eq(windowBoats.windowId, scheduleWindows.id))
    .innerJoin(boatTypes, eq(boatTypes.id, windowBoats.boatTypeId))
    .where(and(eq(scheduleWindows.clubId, clubId), eq(boatTypes.active, true)));

  const grouped = new Map<string, GroupedWindow>();
  for (const r of windowRows) {
    let g = grouped.get(r.windowId);
    if (!g) {
      g = { windowId: r.windowId, weekday: r.weekday, startTime: r.startTime, endTime: r.endTime, minutes: r.minutes, boats: [] };
      grouped.set(r.windowId, g);
    }
    g.boats.push({ boatTypeId: r.boatTypeId, boatName: r.boatName, seats: r.seats, minAttendance: r.boatMinAttendance, quantity: r.quantity });
  }
  const windowsByWeekday = new Map<number, GroupedWindow[]>();
  for (const g of grouped.values()) {
    const list = windowsByWeekday.get(g.weekday) ?? [];
    list.push(g);
    windowsByWeekday.set(g.weekday, list);
  }

  // Approved holidays + overrides in range.
  const holidayRows = await db.select({ date: holidays.date }).from(holidays).where(and(eq(holidays.status, 'approved'), gte(holidays.date, fromDateISO), lt(holidays.date, endISO)));
  const approvedHolidayDates = new Set(holidayRows.map((h) => h.date));
  const overrideRows = await db.select({ date: clubHolidayOverrides.date, isOpen: clubHolidayOverrides.isOpen }).from(clubHolidayOverrides).where(and(eq(clubHolidayOverrides.clubId, clubId), gte(clubHolidayOverrides.date, fromDateISO), lt(clubHolidayOverrides.date, endISO)));
  const overrides = new Map(overrideRows.map((o) => [o.date, o.isOpen]));

  // Persisted slots + sessions in the UTC range covering the local window.
  const startBound = zonedWallClockToUtc(fromDateISO, '00:00', club.timezone);
  const endBound = zonedWallClockToUtc(endISO, '00:00', club.timezone);
  const persistedSlots = await db.select({ id: slots.id, startAt: slots.startAt, endAt: slots.endAt, fromWindowId: slots.fromWindowId }).from(slots).where(and(eq(slots.clubId, clubId), gte(slots.startAt, startBound), lt(slots.startAt, endBound)));
  const persistedSessionRows = persistedSlots.length
    ? await db.select({ slotId: sessions.slotId, boatTypeId: sessions.boatTypeId, capacity: sessions.capacity, minAttendance: sessions.minAttendance, status: sessions.status, boatName: boatTypes.name })
        .from(sessions).innerJoin(boatTypes, eq(boatTypes.id, sessions.boatTypeId)).where(inArray(sessions.slotId, persistedSlots.map((s) => s.id)))
    : [];
  const sessionsBySlot = new Map<string, VirtualSession[]>();
  for (const s of persistedSessionRows) {
    const list = sessionsBySlot.get(s.slotId) ?? [];
    list.push({ boatTypeId: s.boatTypeId, boatName: s.boatName, capacity: s.capacity, minAttendance: s.minAttendance, occurrence: list.length, status: s.status, persisted: true });
    sessionsBySlot.set(s.slotId, list);
  }
  // Index persisted slots by their UTC start ISO; entries are consumed as matched.
  const persistedByStart = new Map<string, { id: string; startAt: Date; endAt: Date; fromWindowId: string | null }>();
  for (const s of persistedSlots) persistedByStart.set(s.startAt.toISOString(), s);

  const result: CalendarDay[] = [];
  for (const dateISO of dateList) {
    const weekday = weekdayOfDateISO(dateISO);
    const { open, reason } = resolveDateOpen({ dateISO, openOnHolidays: club.openOnHolidays, approvedHolidayDates, overrides });
    if (!open) {
      result.push({ dateISO, weekday, closed: true, closedReason: reason, slots: [] });
      continue;
    }
    const vslots: VirtualSlot[] = [];
    for (const w of windowsByWeekday.get(weekday) ?? []) {
      const startMin = toMinutes(w.startTime);
      const endMin = toMinutes(w.endTime);
      for (let m = startMin; m < endMin; m += w.minutes) {
        const startAt = zonedWallClockToUtc(dateISO, minutesToHHMM(m), club.timezone);
        const endAt = addMinutes(startAt, w.minutes);
        const key = startAt.toISOString();
        const persisted = persistedByStart.get(key);
        if (persisted) {
          persistedByStart.delete(key);
          vslots.push({ dateISO, startAt, endAt: persisted.endAt, windowId: w.windowId, persisted: true, sessions: sessionsBySlot.get(persisted.id) ?? [] });
        } else {
          const vsessions = w.boats.flatMap((b) =>
            Array.from({ length: b.quantity }, (_unused, i): VirtualSession => ({
              boatTypeId: b.boatTypeId, boatName: b.boatName, capacity: b.seats, minAttendance: b.minAttendance, occurrence: i, status: 'open', persisted: false,
            })),
          );
          vslots.push({ dateISO, startAt, endAt, windowId: w.windowId, persisted: false, sessions: vsessions });
        }
      }
    }
    result.push({ dateISO, weekday, closed: false, closedReason: null, slots: vslots });
  }

  // Surface any persisted slots not matched to a current window (e.g. its window was deleted),
  // bucketed onto the open day that contains them, so existing bookings never disappear.
  for (const [, s] of persistedByStart) {
    const { dateISO } = utcToClubDate(s.startAt, club.timezone);
    const day = result.find((d) => d.dateISO === dateISO);
    if (!day || day.closed) continue;
    day.slots.push({ dateISO, startAt: s.startAt, endAt: s.endAt, windowId: s.fromWindowId, persisted: true, sessions: sessionsBySlot.get(s.id) ?? [] });
  }

  for (const d of result) d.slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return result;
}
