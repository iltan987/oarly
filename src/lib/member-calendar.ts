import { and, eq, inArray } from 'drizzle-orm';

import type { DB } from '@/db';
import { bookings, clubs } from '@/db/schema';

import { type AllowedPayment, type CalendarDay, computeCalendar, type VirtualSession, type VirtualSlot } from './calendar';
import { bookingOpensAt, isBookingOpen } from './calendar-rules';
import { checkEligibility, type EligibilityResult } from './eligibility';

export type PaymentType = 'regular' | 'multisport';
export type MemberContext = {
  userId: string;
  membershipStatus: 'pending' | 'approved' | 'rejected' | 'banned' | null;
  bannedUntil: Date | null;
  skillRank: number | null;
  paymentType: PaymentType;
};
export type MemberVirtualSession = VirtualSession & {
  seatsLeft: number;
  bookingOpen: boolean;
  eligibility: EligibilityResult;
  defaultPayment: PaymentType;
  paymentChoices: PaymentType[];
  myStatus: 'none' | 'booked' | 'waitlisted';
  myQueuePosition: number | null;
  bookingOpensAt: Date | null;
  /** The member already holds an active MultiSport seat that day, in ANY club. */
  multisportDayTaken: boolean;
  /** Remaining room in the queue behind a full session. null = unlimited. */
  waitlistLeft: number | null;
};
export type MemberVirtualSlot = Omit<VirtualSlot, 'sessions'> & { sessions: MemberVirtualSession[] };
export type MemberCalendarDay = Omit<CalendarDay, 'slots'> & { slots: MemberVirtualSlot[] };

function paymentChoicesFor(allowed: AllowedPayment): PaymentType[] {
  if (allowed === 'regular_only') return ['regular'];
  if (allowed === 'multisport_only') return ['multisport'];
  return ['regular', 'multisport'];
}
function defaultPaymentFor(allowed: AllowedPayment, pref: PaymentType): PaymentType {
  if (allowed === 'regular_only') return 'regular';
  if (allowed === 'multisport_only') return 'multisport';
  return pref;
}

/**
 * The 5B calendar enriched for one member: per session it adds seatsLeft (capacity − seated),
 * bookingOpen (club policy), eligibility (skill + membership; payment is a choice, so the check
 * uses the payment the form will default to and never blocks on payment), the payment picker
 * options, and the member's own status. Booking-agnostic computeCalendar stays untouched.
 */
export async function computeMemberCalendar(
  db: DB,
  clubId: string,
  member: MemberContext,
  opts: { fromDateISO: string; days: number; now?: Date },
): Promise<MemberCalendarDay[]> {
  const now = opts.now ?? new Date();
  const days = await computeCalendar(db, clubId, opts);

  const [club] = await db.select({ bookingOpenMode: clubs.bookingOpenMode, bookingOpenLeadDays: clubs.bookingOpenLeadDays, waitlistCapacity: clubs.waitlistCapacity, multisportEnabled: clubs.multisportEnabled }).from(clubs).where(eq(clubs.id, clubId));
  if (!club) throw new Error(`club not found: ${clubId}`);

  const persistedIds = days.flatMap((d) => d.slots).flatMap((s) => s.sessions).filter((x) => x.persisted && x.sessionId).map((x) => x.sessionId!) as string[];

  // Seated counts per persisted session + this member's own active bookings.
  const seated = new Map<string, number>();
  const mine = new Map<string, { status: 'booked' | 'waitlisted'; queuePosition: number | null }>();
  const active = new Map<string, number>();
  if (persistedIds.length) {
    const seatedRows = await db.select({ sessionId: bookings.sessionId }).from(bookings).where(and(inArray(bookings.sessionId, persistedIds), eq(bookings.status, 'booked')));
    for (const r of seatedRows) seated.set(r.sessionId, (seated.get(r.sessionId) ?? 0) + 1);
    const myRows = await db.select({ sessionId: bookings.sessionId, status: bookings.status, queuePosition: bookings.queuePosition }).from(bookings).where(and(eq(bookings.userId, member.userId), inArray(bookings.sessionId, persistedIds), inArray(bookings.status, ['booked', 'waitlisted'])));
    for (const r of myRows) mine.set(r.sessionId, { status: r.status as 'booked' | 'waitlisted', queuePosition: r.queuePosition });
    const activeRows = await db.select({ sessionId: bookings.sessionId }).from(bookings).where(and(inArray(bookings.sessionId, persistedIds), inArray(bookings.status, ['booked', 'waitlisted'])));
    for (const r of activeRows) active.set(r.sessionId, (active.get(r.sessionId) ?? 0) + 1);
  }

  // The MultiSport daily limit is a property of the CARD, so this query is
  // deliberately not club-scoped — the one cross-tenant read in the codebase.
  // It returns dates only, about the requesting user, so it discloses nothing
  // about any other club.
  const windowDates = days.map((d) => d.dateISO);
  const multisportDays = new Set<string>();
  if (windowDates.length) {
    const rows = await db
      .select({ bookingDate: bookings.bookingDate })
      .from(bookings)
      .where(and(
        eq(bookings.userId, member.userId),
        eq(bookings.paymentType, 'multisport'),
        inArray(bookings.status, ['booked', 'waitlisted']),
        inArray(bookings.bookingDate, windowDates),
      ));
    for (const r of rows) multisportDays.add(r.bookingDate);
  }

  return days.map((day) => ({
    ...day,
    slots: day.slots.map((slot) => ({
      ...slot,
      sessions: slot.sessions.map((s): MemberVirtualSession => {
        const seatedCount = s.sessionId ? (seated.get(s.sessionId) ?? 0) : 0;
        const my = s.sessionId ? mine.get(s.sessionId) : undefined;
        const defaultPayment = defaultPaymentFor(s.allowedPayment, member.paymentType);
        return {
          ...s,
          seatsLeft: Math.max(0, s.capacity - seatedCount),
          bookingOpen: isBookingOpen({ now, startAt: slot.startAt, bookingOpenMode: club.bookingOpenMode, bookingOpenLeadDays: club.bookingOpenLeadDays }),
          bookingOpensAt: bookingOpensAt({ startAt: slot.startAt, bookingOpenMode: club.bookingOpenMode, bookingOpenLeadDays: club.bookingOpenLeadDays }),
          eligibility: checkEligibility({ membershipStatus: member.membershipStatus, bannedUntil: member.bannedUntil, memberSkillRank: member.skillRank, boatMinSkillRank: s.minSkillRank, boatAllowedPayment: s.allowedPayment, paymentType: defaultPayment, clubMultisportEnabled: club.multisportEnabled, now }),
          defaultPayment,
          paymentChoices: paymentChoicesFor(s.allowedPayment),
          myStatus: my?.status ?? 'none',
          myQueuePosition: my?.queuePosition ?? null,
          multisportDayTaken: multisportDays.has(day.dateISO),
          waitlistLeft: club.waitlistCapacity == null
            ? null
            : Math.max(0, s.capacity + club.waitlistCapacity - (s.sessionId ? (active.get(s.sessionId) ?? 0) : 0)),
        };
      }),
    })),
  }));
}
