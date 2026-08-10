import { and, eq, inArray } from 'drizzle-orm';

import type { DB } from '@/db';
import { bookings, clubs, user } from '@/db/schema';

import { computeCalendar } from './calendar';

// A no-show is still shown: the owner needs to see the mark to undo it. The
// previous active-only filter made a marked booking vanish from the roster.
const VISIBLE = ['booked', 'waitlisted', 'no_show'] as const;

export type RosterMember = {
  bookingId: string;
  name: string;
  paymentType: 'regular' | 'multisport';
  queuePosition: number | null;
  status: 'booked' | 'waitlisted' | 'no_show';
};
export type RosterSession = {
  sessionId: string | null;
  windowId: string | null;
  startAt: Date;
  endAt: Date;
  boatTypeId: string;
  boatName: string;
  capacity: number;
  status: 'open' | 'closed' | 'cancelled';
  seated: RosterMember[];
  waitlisted: RosterMember[];
  freeSeats: number;
  waitlistCapacity: number | null;
};
export type RosterDay = { dateISO: string; closed: boolean; sessions: RosterSession[] };

/** Only the three fields the day's totals are counted from — so a caller can pass a
 *  session it has decorated (the bookings page adds penalty fields) and a test can build
 *  one without inventing a boat. */
export type CountableSession = Pick<RosterSession, 'seated' | 'waitlisted' | 'capacity'>;

/**
 * The day's three numbers, in ONE place: `/manage` renders them as `todaySummary` and
 * `/manage/bookings` renders them beside the date control, and two copies of this
 * arithmetic is how those two pages start disagreeing about how full the club is.
 *
 * The rule that matters is `status === 'booked'`. `seated` INCLUDES `no_show` rows — they
 * are kept visible so an owner can undo the mark (see `VISIBLE` above) — so
 * `s.seated.length` reports a session that had an absence as fuller than it is, and shows
 * seats as taken that `freeSeats` (same rule, line 78) is simultaneously offering to the
 * add form. `waitlisted` needs no such filter: `getDayRoster` puts only `waitlisted` rows
 * in that bucket.
 */
export function rosterDayTotals(sessions: readonly CountableSession[]): { seated: number; waitlisted: number; capacity: number } {
  let seated = 0;
  let waitlisted = 0;
  let capacity = 0;
  for (const s of sessions) {
    seated += s.seated.filter((m) => m.status === 'booked').length;
    waitlisted += s.waitlisted.length;
    capacity += s.capacity;
  }
  return { seated, waitlisted, capacity };
}

/** Owner-facing: the day's sessions (persisted + virtual), each with its booking roster. */
export async function getDayRoster(db: DB, { clubId, dateISO }: { clubId: string; dateISO: string }): Promise<RosterDay> {
  const [day] = await computeCalendar(db, clubId, { fromDateISO: dateISO, days: 1 });
  const [club] = await db.select({ waitlistCapacity: clubs.waitlistCapacity }).from(clubs).where(eq(clubs.id, clubId));

  const sessionIds: string[] = [];
  for (const slot of day.slots) for (const s of slot.sessions) if (s.sessionId) sessionIds.push(s.sessionId);

  const rows = sessionIds.length
    ? await db
        .select({ bookingId: bookings.id, sessionId: bookings.sessionId, status: bookings.status, paymentType: bookings.paymentType, queuePosition: bookings.queuePosition, effectiveAt: bookings.effectiveAt, name: user.name })
        .from(bookings)
        .innerJoin(user, eq(user.id, bookings.userId))
        .where(and(inArray(bookings.sessionId, sessionIds), inArray(bookings.status, [...VISIBLE])))
    : [];

  const bySession = new Map<string, { seated: RosterMember[]; waitlisted: RosterMember[] }>();
  const ordered = [...rows].sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
  for (const r of ordered) {
    const bucket = bySession.get(r.sessionId) ?? { seated: [], waitlisted: [] };
    const status = r.status as 'booked' | 'waitlisted' | 'no_show';
    const member: RosterMember = { bookingId: r.bookingId, name: r.name, paymentType: r.paymentType, queuePosition: r.queuePosition, status };
    if (status === 'waitlisted') bucket.waitlisted.push(member);
    else bucket.seated.push(member);
    bySession.set(r.sessionId, bucket);
  }
  for (const bucket of bySession.values()) bucket.waitlisted.sort((x, y) => (x.queuePosition ?? 0) - (y.queuePosition ?? 0));

  const sessions: RosterSession[] = [];
  for (const slot of day.slots) {
    for (const s of slot.sessions) {
      const roster = (s.sessionId ? bySession.get(s.sessionId) : undefined) ?? { seated: [], waitlisted: [] };
      sessions.push({
        sessionId: s.sessionId,
        windowId: slot.windowId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        boatTypeId: s.boatTypeId,
        boatName: s.boatName,
        capacity: s.capacity,
        status: s.status,
        seated: roster.seated,
        waitlisted: roster.waitlisted,
        freeSeats: Math.max(0, s.capacity - roster.seated.filter((m) => m.status === 'booked').length),
        waitlistCapacity: club?.waitlistCapacity ?? null,
      });
    }
  }
  return { dateISO: day.dateISO, closed: day.closed, sessions };
}
