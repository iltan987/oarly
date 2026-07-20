import { and, eq, inArray } from 'drizzle-orm';

import type { DB } from '@/db';
import { bookings, user } from '@/db/schema';

import { computeCalendar } from './calendar';

const ACTIVE = ['booked', 'waitlisted'] as const;

export type RosterMember = { bookingId: string; name: string; paymentType: 'regular' | 'multisport'; queuePosition: number | null };
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
};
export type RosterDay = { dateISO: string; closed: boolean; sessions: RosterSession[] };

/** Owner-facing: the day's sessions (persisted + virtual), each with its booking roster. */
export async function getDayRoster(db: DB, { clubId, dateISO }: { clubId: string; dateISO: string }): Promise<RosterDay> {
  const [day] = await computeCalendar(db, clubId, { fromDateISO: dateISO, days: 1 });

  const sessionIds: string[] = [];
  for (const slot of day.slots) for (const s of slot.sessions) if (s.sessionId) sessionIds.push(s.sessionId);

  const rows = sessionIds.length
    ? await db
        .select({ bookingId: bookings.id, sessionId: bookings.sessionId, status: bookings.status, paymentType: bookings.paymentType, queuePosition: bookings.queuePosition, effectiveAt: bookings.effectiveAt, name: user.name })
        .from(bookings)
        .innerJoin(user, eq(user.id, bookings.userId))
        .where(and(inArray(bookings.sessionId, sessionIds), inArray(bookings.status, [...ACTIVE])))
    : [];

  const bySession = new Map<string, { seated: RosterMember[]; waitlisted: RosterMember[] }>();
  const ordered = [...rows].sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
  for (const r of ordered) {
    const bucket = bySession.get(r.sessionId) ?? { seated: [], waitlisted: [] };
    const member: RosterMember = { bookingId: r.bookingId, name: r.name, paymentType: r.paymentType, queuePosition: r.queuePosition };
    if (r.status === 'booked') bucket.seated.push(member);
    else bucket.waitlisted.push(member);
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
        freeSeats: Math.max(0, s.capacity - roster.seated.length),
      });
    }
  }
  return { dateISO: day.dateISO, closed: day.closed, sessions };
}
