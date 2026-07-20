import { addMinutes } from 'date-fns';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, bookings, clubHolidayOverrides, clubs, holidays, memberships, scheduleWindows, sessions, skillLevels, slots, windowBoats } from '@/db/schema';

import { isBookingOpen, resolveDateOpen } from './calendar-rules';
import { toMinutes, utcToClubDate, zonedWallClockToUtc } from './date-tz';
import { checkEligibility, type EligibilityReason } from './eligibility';
import { findOrCreateSlotTx, type MaterializeBoat } from './materialize';
import { resolveSeating } from './seating';

const HOUR_MS = 60 * 60 * 1000;
const ACTIVE = ['booked', 'waitlisted'] as const;

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Recompute a session's sticky seating after a mutation and return the user (if
 * any) promoted from waitlisted -> booked into a freed seat. Caller must hold the
 * per-slot advisory lock.
 */
async function applySeating(tx: Tx, sessionId: string, capacity: number, mode: 'equal' | 'priority'): Promise<{ promotedUserId: string | null }> {
  const active = await tx.select({ id: bookings.id, userId: bookings.userId, status: bookings.status, paymentType: bookings.paymentType, effectiveAt: bookings.effectiveAt }).from(bookings).where(and(eq(bookings.sessionId, sessionId), inArray(bookings.status, [...ACTIVE])));
  const prevStatus = new Map(active.map((a) => [a.id, a.status]));
  const assignments = resolveSeating(active.map((a) => ({ id: a.id, status: a.status as 'booked' | 'waitlisted', paymentType: a.paymentType, effectiveAt: a.effectiveAt })), capacity, mode);
  for (const a of assignments) await tx.update(bookings).set({ status: a.status, queuePosition: a.queuePosition }).where(eq(bookings.id, a.id));
  const promoted = assignments.find((a) => a.status === 'booked' && prevStatus.get(a.id) === 'waitlisted');
  return { promotedUserId: promoted ? (active.find((a) => a.id === promoted.id)?.userId ?? null) : null };
}

export type BookInput = {
  clubId: string;
  userId: string;
  windowId: string;
  boatTypeId: string;
  startAt: Date;
  paymentType: 'regular' | 'multisport';
  idempotencyKey: string;
  now?: Date;
};
export type BookResult =
  | { ok: true; bookingId: string; outcome: 'seated' | 'waitlisted'; queuePosition: number | null }
  | { ok: false; error: 'ineligible'; reason: EligibilityReason }
  | { ok: false; error: 'already_booked_this_slot' }
  | { ok: false; error: 'no_session' };

export type CancelInput = { clubId: string; userId: string; bookingId: string; now?: Date };
export type CancelResult =
  | { ok: true; promoted?: { userId: string; sessionId: string } }
  | { ok: false; error: 'not_found' | 'not_active' | 'cancel_disabled' | 'cutoff_passed' };

/** Book (or waitlist) a seat for one member in one boat at one time block. */
export async function bookSeat(db: DB, input: BookInput): Promise<BookResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // 1. Club + window, scoped to clubId.
    const [club] = await tx
      .select({ timezone: clubs.timezone, multisportMode: clubs.multisportMode, openOnHolidays: clubs.openOnHolidays, bookingOpenMode: clubs.bookingOpenMode, bookingOpenLeadDays: clubs.bookingOpenLeadDays })
      .from(clubs)
      .where(eq(clubs.id, input.clubId));
    if (!club) return { ok: false, error: 'no_session' };
    const [win] = await tx.select().from(scheduleWindows).where(and(eq(scheduleWindows.id, input.windowId), eq(scheduleWindows.clubId, input.clubId)));
    if (!win) return { ok: false, error: 'no_session' };

    // 2. Authoritative boats spec + the chosen boat.
    const wbRows = await tx
      .select({ boatTypeId: windowBoats.boatTypeId, quantity: windowBoats.quantity, capacity: boatTypes.seats, minAttendance: boatTypes.minAttendance, allowedPayment: boatTypes.allowedPayment, minSkillRank: skillLevels.rank })
      .from(windowBoats)
      .innerJoin(boatTypes, eq(boatTypes.id, windowBoats.boatTypeId))
      .leftJoin(skillLevels, eq(skillLevels.id, boatTypes.minSkillLevelId))
      .where(and(eq(windowBoats.windowId, input.windowId), eq(boatTypes.active, true)));
    const chosen = wbRows.find((b) => b.boatTypeId === input.boatTypeId);
    if (!chosen) return { ok: false, error: 'no_session' };
    const boatsSpec: MaterializeBoat[] = wbRows.map((b) => ({ boatTypeId: b.boatTypeId, capacity: b.capacity, minAttendance: b.minAttendance, quantity: b.quantity }));

    // 3. Validate startAt is a real block of this window on its club-local date.
    const { dateISO, weekday } = utcToClubDate(input.startAt, club.timezone);
    if (weekday !== win.weekday) return { ok: false, error: 'no_session' };
    const startMin = toMinutes(win.startTime);
    const endMin = toMinutes(win.endTime);
    let matched = false;
    for (let m = startMin; m < endMin; m += win.defaultSessionMinutes) {
      const blockStart = zonedWallClockToUtc(dateISO, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, club.timezone);
      if (blockStart.getTime() === input.startAt.getTime()) { matched = true; break; }
    }
    if (!matched) return { ok: false, error: 'no_session' };
    const endAt = addMinutes(input.startAt, win.defaultSessionMinutes);

    // 3b. Server-side authoritative closed-day / booking-open checks (defense-in-depth behind the UI).
    const holidayRows = await tx.select({ date: holidays.date }).from(holidays).where(and(eq(holidays.status, 'approved'), eq(holidays.date, dateISO)));
    const overrideRows = await tx.select({ date: clubHolidayOverrides.date, isOpen: clubHolidayOverrides.isOpen }).from(clubHolidayOverrides).where(and(eq(clubHolidayOverrides.clubId, input.clubId), eq(clubHolidayOverrides.date, dateISO)));
    const { open } = resolveDateOpen({ dateISO, openOnHolidays: club.openOnHolidays, approvedHolidayDates: new Set(holidayRows.map((h) => h.date)), overrides: new Map(overrideRows.map((o) => [o.date, o.isOpen])) });
    if (!open) return { ok: false, error: 'no_session' };
    if (!isBookingOpen({ now, startAt: input.startAt, bookingOpenMode: club.bookingOpenMode, bookingOpenLeadDays: club.bookingOpenLeadDays })) return { ok: false, error: 'no_session' };

    // 4. Find-or-create the slot + sessions under the per-slot advisory lock.
    const foc = await findOrCreateSlotTx(tx, { clubId: input.clubId, dateISO, startAt: input.startAt, endAt, windowId: input.windowId, boats: boatsSpec });

    // 5. Idempotency short-circuit.
    const [dup] = await tx.select({ id: bookings.id, status: bookings.status, queuePosition: bookings.queuePosition }).from(bookings).where(and(eq(bookings.userId, input.userId), eq(bookings.idempotencyKey, input.idempotencyKey)));
    if (dup) return { ok: true, bookingId: dup.id, outcome: dup.status === 'booked' ? 'seated' : 'waitlisted', queuePosition: dup.queuePosition };

    // 6. Eligibility.
    const [member] = await tx
      .select({ status: memberships.status, bannedUntil: memberships.bannedUntil, skillRank: skillLevels.rank })
      .from(memberships)
      .leftJoin(skillLevels, eq(skillLevels.id, memberships.skillLevelId))
      .where(and(eq(memberships.userId, input.userId), eq(memberships.clubId, input.clubId)));
    const elig = checkEligibility({
      membershipStatus: member?.status ?? null,
      bannedUntil: member?.bannedUntil ?? null,
      memberSkillRank: member?.skillRank ?? null,
      boatMinSkillRank: chosen.minSkillRank,
      boatAllowedPayment: chosen.allowedPayment,
      paymentType: input.paymentType,
      now,
    });
    if (!elig.ok) return { ok: false, error: 'ineligible', reason: elig.reason };

    // 7. One booking per slot: reject if the member is already active in any session of this slot.
    const slotSessionIds = foc.sessions.map((s) => s.id);
    if (slotSessionIds.length) {
      const [existingActive] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.userId, input.userId), inArray(bookings.sessionId, slotSessionIds), inArray(bookings.status, [...ACTIVE])));
      if (existingActive) return { ok: false, error: 'already_booked_this_slot' };
    }

    // 8. Choose the target session of the chosen boat: pack a boat (first free seat by id),
    //    else the one with the fewest active bookings (shortest waitlist), tie-break by id.
    const boatSessions = foc.sessions.filter((s) => s.boatTypeId === input.boatTypeId).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (boatSessions.length === 0) return { ok: false, error: 'no_session' };
    const activeRows = await tx.select({ sessionId: bookings.sessionId }).from(bookings).where(and(inArray(bookings.sessionId, boatSessions.map((s) => s.id)), inArray(bookings.status, [...ACTIVE])));
    const activeCount = new Map<string, number>();
    for (const r of activeRows) activeCount.set(r.sessionId, (activeCount.get(r.sessionId) ?? 0) + 1);
    const withFree = boatSessions.filter((s) => (activeCount.get(s.id) ?? 0) < s.capacity);
    const target = withFree.length > 0
      ? withFree[0]
      : [...boatSessions].sort((a, b) => (activeCount.get(a.id) ?? 0) - (activeCount.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1))[0];

    // 9. Insert the booking as waitlisted, then resolve seating for the target session.
    //    Sticky rule (resolveSeating): existing seated bookings are never demoted;
    //    the new booking takes a free seat if one exists, else joins the waitlist.
    const [inserted] = await tx.insert(bookings).values({ sessionId: target.id, clubId: input.clubId, userId: input.userId, paymentType: input.paymentType, status: 'waitlisted', effectiveAt: now, source: 'member', idempotencyKey: input.idempotencyKey }).returning({ id: bookings.id });
    const active = await tx.select({ id: bookings.id, status: bookings.status, paymentType: bookings.paymentType, effectiveAt: bookings.effectiveAt }).from(bookings).where(and(eq(bookings.sessionId, target.id), inArray(bookings.status, [...ACTIVE])));
    const assignments = resolveSeating(active.map((a) => ({ id: a.id, status: a.status as 'booked' | 'waitlisted', paymentType: a.paymentType, effectiveAt: a.effectiveAt })), target.capacity, club.multisportMode);
    for (const a of assignments) await tx.update(bookings).set({ status: a.status, queuePosition: a.queuePosition }).where(eq(bookings.id, a.id));
    const mine = assignments.find((a) => a.id === inserted.id)!;
    return { ok: true, bookingId: inserted.id, outcome: mine.status === 'booked' ? 'seated' : 'waitlisted', queuePosition: mine.queuePosition };
  });
}

/** Cancel a member's own booking and auto-promote the waitlist for that session. */
export async function cancelBooking(db: DB, input: CancelInput): Promise<CancelResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: bookings.id, userId: bookings.userId, clubId: bookings.clubId, status: bookings.status, sessionId: bookings.sessionId,
        capacity: sessions.capacity, slotStartAt: slots.startAt,
        multisportMode: clubs.multisportMode, selfCancelEnabled: clubs.selfCancelEnabled, cancelCutoffHours: clubs.cancelCutoffHours,
      })
      .from(bookings)
      .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
      .innerJoin(slots, eq(slots.id, sessions.slotId))
      .innerJoin(clubs, eq(clubs.id, bookings.clubId))
      .where(eq(bookings.id, input.bookingId));

    if (!row || row.clubId !== input.clubId || row.userId !== input.userId) return { ok: false, error: 'not_found' };
    if (!(ACTIVE as readonly string[]).includes(row.status)) return { ok: false, error: 'not_active' };
    if (!row.selfCancelEnabled) return { ok: false, error: 'cancel_disabled' };
    if (row.cancelCutoffHours != null && now.getTime() >= row.slotStartAt.getTime() - row.cancelCutoffHours * HOUR_MS) {
      return { ok: false, error: 'cutoff_passed' };
    }
    if (now.getTime() >= row.slotStartAt.getTime()) return { ok: false, error: 'cutoff_passed' };

    // Serialize with the session's bookings under the same per-slot lock bookSeat uses.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.clubId}), hashtext(${row.slotStartAt.toISOString()}))`);

    await tx.update(bookings).set({ status: 'cancelled', queuePosition: null }).where(eq(bookings.id, input.bookingId));

    const { promotedUserId } = await applySeating(tx, row.sessionId, row.capacity, row.multisportMode);
    return promotedUserId ? { ok: true, promoted: { userId: promotedUserId, sessionId: row.sessionId } } : { ok: true };
  });
}

export type OwnerRemoveResult =
  | { ok: true; promoted?: { userId: string; sessionId: string } }
  | { ok: false; error: 'not_found' | 'not_active' };

/** Owner force-removes any booking in their club, bypassing self-cancel/cutoff gates. */
export async function ownerRemoveBooking(db: DB, input: { clubId: string; bookingId: string }): Promise<OwnerRemoveResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ clubId: bookings.clubId, status: bookings.status, sessionId: bookings.sessionId, capacity: sessions.capacity, slotStartAt: slots.startAt, multisportMode: clubs.multisportMode })
      .from(bookings)
      .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
      .innerJoin(slots, eq(slots.id, sessions.slotId))
      .innerJoin(clubs, eq(clubs.id, bookings.clubId))
      .where(eq(bookings.id, input.bookingId));
    if (!row || row.clubId !== input.clubId) return { ok: false, error: 'not_found' };
    if (!(ACTIVE as readonly string[]).includes(row.status)) return { ok: false, error: 'not_active' };

    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.clubId}), hashtext(${row.slotStartAt.toISOString()}))`);
    await tx.update(bookings).set({ status: 'cancelled', queuePosition: null }).where(eq(bookings.id, input.bookingId));
    const { promotedUserId } = await applySeating(tx, row.sessionId, row.capacity, row.multisportMode);
    return promotedUserId ? { ok: true, promoted: { userId: promotedUserId, sessionId: row.sessionId } } : { ok: true };
  });
}

export type OwnerAddInput = { clubId: string; windowId: string; boatTypeId: string; startAt: Date; userId: string; paymentType: 'regular' | 'multisport'; now?: Date };
export type OwnerAddResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: 'no_session' | 'not_a_member' | 'already_booked_this_slot' | 'session_full' };

/**
 * Owner seats a member into a free seat of a block. Override: skips skill/payment
 * eligibility, but requires an approved, non-banned member; empty-seat-only.
 */
export async function ownerAddBooking(db: DB, input: OwnerAddInput): Promise<OwnerAddResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [club] = await tx.select({ timezone: clubs.timezone, multisportMode: clubs.multisportMode }).from(clubs).where(eq(clubs.id, input.clubId));
    if (!club) return { ok: false, error: 'no_session' };
    const [win] = await tx.select().from(scheduleWindows).where(and(eq(scheduleWindows.id, input.windowId), eq(scheduleWindows.clubId, input.clubId)));
    if (!win) return { ok: false, error: 'no_session' };

    const wbRows = await tx
      .select({ boatTypeId: windowBoats.boatTypeId, quantity: windowBoats.quantity, capacity: boatTypes.seats, minAttendance: boatTypes.minAttendance })
      .from(windowBoats)
      .innerJoin(boatTypes, eq(boatTypes.id, windowBoats.boatTypeId))
      .where(and(eq(windowBoats.windowId, input.windowId), eq(boatTypes.active, true)));
    const chosen = wbRows.find((b) => b.boatTypeId === input.boatTypeId);
    if (!chosen) return { ok: false, error: 'no_session' };
    const boatsSpec: MaterializeBoat[] = wbRows.map((b) => ({ boatTypeId: b.boatTypeId, capacity: b.capacity, minAttendance: b.minAttendance, quantity: b.quantity }));

    // Validate startAt is a real block of this window on its club-local date.
    const { dateISO, weekday } = utcToClubDate(input.startAt, club.timezone);
    if (weekday !== win.weekday) return { ok: false, error: 'no_session' };
    const startMin = toMinutes(win.startTime);
    const endMin = toMinutes(win.endTime);
    let matched = false;
    for (let m = startMin; m < endMin; m += win.defaultSessionMinutes) {
      const blockStart = zonedWallClockToUtc(dateISO, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, club.timezone);
      if (blockStart.getTime() === input.startAt.getTime()) { matched = true; break; }
    }
    if (!matched) return { ok: false, error: 'no_session' };
    const endAt = addMinutes(input.startAt, win.defaultSessionMinutes);

    // Owner override: require an approved, non-banned member (skip skill/payment eligibility).
    const [member] = await tx.select({ status: memberships.status, bannedUntil: memberships.bannedUntil }).from(memberships).where(and(eq(memberships.userId, input.userId), eq(memberships.clubId, input.clubId)));
    if (!member || member.status !== 'approved' || (member.bannedUntil != null && member.bannedUntil.getTime() > now.getTime())) return { ok: false, error: 'not_a_member' };

    const foc = await findOrCreateSlotTx(tx, { clubId: input.clubId, dateISO, startAt: input.startAt, endAt, windowId: input.windowId, boats: boatsSpec });

    // One booking per slot.
    const slotSessionIds = foc.sessions.map((s) => s.id);
    if (slotSessionIds.length) {
      const [existingActive] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.userId, input.userId), inArray(bookings.sessionId, slotSessionIds), inArray(bookings.status, [...ACTIVE])));
      if (existingActive) return { ok: false, error: 'already_booked_this_slot' };
    }

    // Target the chosen boat's session that has a free seat (empty-seat-only).
    const boatSessions = foc.sessions.filter((s) => s.boatTypeId === input.boatTypeId).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (boatSessions.length === 0) return { ok: false, error: 'no_session' };
    const activeRows = await tx.select({ sessionId: bookings.sessionId }).from(bookings).where(and(inArray(bookings.sessionId, boatSessions.map((s) => s.id)), inArray(bookings.status, [...ACTIVE])));
    const activeCount = new Map<string, number>();
    for (const r of activeRows) activeCount.set(r.sessionId, (activeCount.get(r.sessionId) ?? 0) + 1);
    const target = boatSessions.find((s) => (activeCount.get(s.id) ?? 0) < s.capacity);
    if (!target) return { ok: false, error: 'session_full' };

    const [inserted] = await tx.insert(bookings).values({ sessionId: target.id, clubId: input.clubId, userId: input.userId, paymentType: input.paymentType, status: 'booked', effectiveAt: now, source: 'owner' }).returning({ id: bookings.id });
    await applySeating(tx, target.id, target.capacity, club.multisportMode);
    return { ok: true, bookingId: inserted.id };
  });
}
