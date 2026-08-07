import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { bookSeat, cancelBooking, ownerAddBooking, ownerRemoveBooking } from './booking';
import { zonedWallClockToUtc } from './date-tz';
import { isUniqueViolation } from './pg-errors';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
// 2026-07-27 is a Monday; window is Monday 08:00–09:00 local ⇒ block start 05:00Z.
const MON = '2026-07-27';
const START = zonedWallClockToUtc(MON, '08:00', TZ);
// Frozen clock, one day before START. Every `now`-sensitive gate here (isBookingOpen
// rejects a past startAt; cancel rejects once the session has started) is relative to
// START, so the suite must never read the real clock — a fixed past MON would otherwise
// silently rot the whole file the moment that date slipped into the past.
const NOW = new Date(START.getTime() - 24 * 60 * 60 * 1000);

describe.skipIf(!url)('bookSeat / cancelBooking', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  async function scenario(opts: { seats: number; quantity?: number; mode?: 'equal' | 'priority'; allowedPayment?: 'regular_only' | 'multisport_only' | 'both'; minSkillRank?: number; selfCancel?: boolean; cutoffHours?: number | null; bookingOpenMode?: 'always' | 'lead'; bookingOpenLeadDays?: number | null }) {
    const tag = `bk-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ, multisportMode: opts.mode ?? 'equal', selfCancelEnabled: opts.selfCancel ?? true, cancelCutoffHours: opts.cutoffHours ?? null, bookingOpenMode: opts.bookingOpenMode ?? 'always', bookingOpenLeadDays: opts.bookingOpenLeadDays ?? null }).returning();
    let lvl: typeof schema.skillLevels.$inferSelect | undefined;
    if (opts.minSkillRank != null) [lvl] = await db.insert(schema.skillLevels).values({ clubId: club.id, name: `L${opts.minSkillRank}`, rank: opts.minSkillRank }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: opts.seats, allowedPayment: opts.allowedPayment ?? 'both', minSkillLevelId: lvl?.id ?? null }).returning();
    const [w] = await db.insert(schema.scheduleWindows).values({ clubId: club.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60 }).returning();
    await db.insert(schema.windowBoats).values({ windowId: w.id, boatTypeId: boat.id, quantity: opts.quantity ?? 1 });
    return { club, boat, w, lvl };
  }
  async function newMember(clubId: string, tag: string, skillLevelId?: string | null, status: 'approved' | 'pending' | 'banned' = 'approved', bannedUntil: Date | null = null) {
    const uid = `${tag}-${Date.now()}-${seq++}`;
    await db.insert(schema.user).values({ id: uid, name: tag, email: `${uid}@t.co` });
    await db.insert(schema.memberships).values({ userId: uid, clubId, role: 'member', status, skillLevelId: skillLevelId ?? null, bannedUntil });
    return uid;
  }
  const key = () => `idem-${Date.now()}-${seq++}`;

  it('seats up to capacity and waitlists the rest; materializes the slot once', async () => {
    const s = await scenario({ seats: 2 });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    const u3 = await newMember(s.club.id, 'u3');
    const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular' as const };
    const r1 = await bookSeat(db, { ...common, userId: u1, idempotencyKey: key(), now: NOW });
    const r2 = await bookSeat(db, { ...common, userId: u2, idempotencyKey: key(), now: NOW });
    const r3 = await bookSeat(db, { ...common, userId: u3, idempotencyKey: key(), now: NOW });
    expect(r1).toMatchObject({ ok: true, outcome: 'seated' });
    expect(r2).toMatchObject({ ok: true, outcome: 'seated' });
    expect(r3).toMatchObject({ ok: true, outcome: 'waitlisted', queuePosition: 1 });
    const slotsForClub = await db.select().from(schema.slots).where(eq(schema.slots.clubId, s.club.id));
    expect(slotsForClub).toHaveLength(1);
  });

  it('is idempotent under a repeated idempotency key', async () => {
    const s = await scenario({ seats: 2 });
    const u = await newMember(s.club.id, 'u');
    const k = key();
    const first = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: k, now: NOW });
    const again = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: k, now: NOW });
    expect(first.ok && again.ok && first.bookingId === again.bookingId).toBe(true);
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u));
    expect(rows).toHaveLength(1);
  });

  it('guarantees exactly capacity under a concurrent rush', async () => {
    const s = await scenario({ seats: 3 });
    const uids = await Promise.all(Array.from({ length: 12 }, (_v, i) => newMember(s.club.id, `rush${i}`)));
    const results = await Promise.all(uids.map((uid) => bookSeat(db, { clubId: s.club.id, userId: uid, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: NOW })));
    expect(results.every((r) => r.ok)).toBe(true);
    const sessionRows = await db.select().from(schema.sessions).where(eq(schema.sessions.clubId, s.club.id));
    const seated = await db.select().from(schema.bookings).where(and(inArray(schema.bookings.sessionId, sessionRows.map((x) => x.id)), eq(schema.bookings.status, 'booked')));
    expect(seated).toHaveLength(3);
  });

  it('rejects an ineligible member (skill too low) with no booking written', async () => {
    const s = await scenario({ seats: 2, minSkillRank: 5 });
    const u = await newMember(s.club.id, 'low', null);
    const r = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: NOW });
    expect(r).toEqual({ ok: false, error: 'ineligible', reason: 'skill_too_low' });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u));
    expect(rows).toHaveLength(0);
  });

  it('rejects a second boat in the same slot', async () => {
    const s = await scenario({ seats: 2, quantity: 2 });
    const u = await newMember(s.club.id, 'dbl');
    const first = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: NOW });
    const second = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: NOW });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: 'already_booked_this_slot' });
  });

  it('priority mode: a later regular does not displace an earlier seated multisport (sticky)', async () => {
    const s = await scenario({ seats: 1, mode: 'priority' });
    const um = await newMember(s.club.id, 'ms');
    const ur = await newMember(s.club.id, 'reg');
    const rm = await bookSeat(db, { clubId: s.club.id, userId: um, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'multisport', idempotencyKey: key(), now: NOW });
    const rr = await bookSeat(db, { clubId: s.club.id, userId: ur, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: NOW });
    expect(rm).toMatchObject({ ok: true, outcome: 'seated' });
    expect(rr).toMatchObject({ ok: true, outcome: 'waitlisted' });
    const msBooking = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, um));
    expect(msBooking[0].status).toBe('booked');
  });

  it('cancellation auto-promotes the head of the waitlist', async () => {
    const s = await scenario({ seats: 1 });
    const u1 = await newMember(s.club.id, 'c1');
    const u2 = await newMember(s.club.id, 'c2');
    const r1 = await bookSeat(db, { clubId: s.club.id, userId: u1, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: NOW });
    await bookSeat(db, { clubId: s.club.id, userId: u2, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: NOW });
    expect(r1.ok).toBe(true);
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u1, bookingId: (r1 as { bookingId: string }).bookingId, now: NOW });
    expect(cancel).toMatchObject({ ok: true });
    const promoted = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u2));
    expect(promoted[0].status).toBe('booked');
  });

  it('blocks self-cancel after the cutoff', async () => {
    const s = await scenario({ seats: 2, cutoffHours: 8 });
    const u = await newMember(s.club.id, 'cut');
    const r = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: NOW });
    // now = 2h before start (< 8h cutoff)
    const late = new Date(START.getTime() - 2 * 60 * 60 * 1000);
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u, bookingId: (r as { bookingId: string }).bookingId, now: late });
    expect(cancel).toEqual({ ok: false, error: 'cutoff_passed' });
  });

  it('rejects booking on a club-force-closed day with no booking written', async () => {
    const s = await scenario({ seats: 2 });
    await db.insert(schema.clubHolidayOverrides).values({ clubId: s.club.id, date: MON, isOpen: false });
    const u = await newMember(s.club.id, 'closed');
    const r = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: NOW });
    expect(r).toEqual({ ok: false, error: 'no_session' });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u));
    expect(rows).toHaveLength(0);
  });

  it('rejects booking before the booking-open lead window; allows it once the window opens', async () => {
    const s = await scenario({ seats: 2, bookingOpenMode: 'lead', bookingOpenLeadDays: 3 });
    const uTooEarly = await newMember(s.club.id, 'early');
    const tooEarly = new Date(START.getTime() - 4 * 24 * 60 * 60 * 1000); // 4 days before START
    const early = await bookSeat(db, { clubId: s.club.id, userId: uTooEarly, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: tooEarly });
    expect(early).toEqual({ ok: false, error: 'no_session' });
    const earlyRows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, uTooEarly));
    expect(earlyRows).toHaveLength(0);

    const uInWindow = await newMember(s.club.id, 'inwindow');
    const inWindow = new Date(START.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days before START (< 3-day lead)
    const opened = await bookSeat(db, { clubId: s.club.id, userId: uInWindow, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: inWindow });
    expect(opened).toMatchObject({ ok: true, outcome: 'seated' });
  });

  it('rejects cancelling once the session has already started, even with no cutoff configured', async () => {
    const s = await scenario({ seats: 2, cutoffHours: null });
    const u = await newMember(s.club.id, 'started');
    const r = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: NOW });
    expect(r.ok).toBe(true);
    const afterStart = new Date(START.getTime() + 60 * 60 * 1000); // 1h after START
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u, bookingId: (r as { bookingId: string }).bookingId, now: afterStart });
    expect(cancel).toEqual({ ok: false, error: 'cutoff_passed' });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u));
    expect(rows[0].status).toBe('booked');
  });

  it('a later booking never displaces a seated member (priority mode)', async () => {
    const s = await scenario({ seats: 1, mode: 'priority', allowedPayment: 'both' });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START };
    const r1 = await bookSeat(db, { ...common, userId: u1, paymentType: 'multisport', idempotencyKey: key(), now: NOW });
    const r2 = await bookSeat(db, { ...common, userId: u2, paymentType: 'regular', idempotencyKey: key(), now: NOW });
    expect(r1).toMatchObject({ ok: true, outcome: 'seated' });
    expect(r2).toMatchObject({ ok: true, outcome: 'waitlisted' });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
    expect(rows.find((r) => r.userId === u1)!.status).toBe('booked');
    expect(rows.find((r) => r.userId === u2)!.status).toBe('waitlisted');
  });

  it('cancelling a seated booking promotes the head of the waitlist and reports it', async () => {
    const s = await scenario({ seats: 1 });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular' as const };
    const r1 = await bookSeat(db, { ...common, userId: u1, idempotencyKey: key(), now: NOW });
    await bookSeat(db, { ...common, userId: u2, idempotencyKey: key(), now: NOW });
    if (!r1.ok) throw new Error('setup');
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u1, bookingId: r1.bookingId, now: NOW });
    expect(cancel).toMatchObject({ ok: true, promoted: { userId: u2, sessionId: expect.any(String) } });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
    expect(rows.find((r) => r.userId === u2)!.status).toBe('booked');
  });

  it('cancelling a waitlisted booking promotes nobody', async () => {
    const s = await scenario({ seats: 1 });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular' as const };
    await bookSeat(db, { ...common, userId: u1, idempotencyKey: key(), now: NOW });
    const r2 = await bookSeat(db, { ...common, userId: u2, idempotencyKey: key(), now: NOW });
    if (!r2.ok) throw new Error('setup');
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u2, bookingId: r2.bookingId, now: NOW });
    expect(cancel).toEqual({ ok: true });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
    expect(rows.find((r) => r.userId === u1)!.status).toBe('booked');
  });

  it('owner removes a booking even past the self-cancel cutoff, and promotes the waitlist', async () => {
    const s = await scenario({ seats: 1, cutoffHours: 9999 });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular' as const };
    const r1 = await bookSeat(db, { ...common, userId: u1, idempotencyKey: key(), now: NOW });
    await bookSeat(db, { ...common, userId: u2, idempotencyKey: key(), now: NOW });
    if (!r1.ok) throw new Error('setup');
    const selfBlocked = await cancelBooking(db, { clubId: s.club.id, userId: u1, bookingId: r1.bookingId, now: NOW });
    expect(selfBlocked).toEqual({ ok: false, error: 'cutoff_passed' });
    const removed = await ownerRemoveBooking(db, { clubId: s.club.id, bookingId: r1.bookingId });
    expect(removed).toMatchObject({ ok: true, promoted: { userId: u2 } });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
    expect(rows.find((r) => r.userId === u2)!.status).toBe('booked');
  });

  it('owner seats a member into a free seat, tagged source=owner', async () => {
    const s = await scenario({ seats: 2, allowedPayment: 'both' });
    const u1 = await newMember(s.club.id, 'u1');
    const res = await ownerAddBooking(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u1, paymentType: 'regular', now: NOW });
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) throw new Error('add failed');
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, res.bookingId));
    expect(row.status).toBe('booked');
    expect(row.source).toBe('owner');
  });

  it('owner-add rejects a full session', async () => {
    const s = await scenario({ seats: 1, allowedPayment: 'both' });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    await ownerAddBooking(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u1, paymentType: 'regular', now: NOW });
    const res = await ownerAddBooking(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u2, paymentType: 'regular', now: NOW });
    expect(res).toEqual({ ok: false, error: 'session_full' });
  });

  it('owner-add rejects a non-approved member', async () => {
    const s = await scenario({ seats: 2, allowedPayment: 'both' });
    const pend = await newMember(s.club.id, 'p', null, 'pending');
    const res = await ownerAddBooking(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: pend, paymentType: 'regular', now: NOW });
    expect(res).toEqual({ ok: false, error: 'not_a_member' });
  });

  // Nothing sets sessions.status today (per-session cancel is a later cycle), so these
  // materialize the slot first and then close the session by hand — the point is that the
  // seating paths honour the column the moment something starts writing it.
  describe.each(['closed', 'cancelled'] as const)('a %s session', (status) => {
    async function closedSession() {
      const s = await scenario({ seats: 2 });
      const seeder = await newMember(s.club.id, 'seed');
      // First booking materializes the slot + its sessions.
      await bookSeat(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: seeder, paymentType: 'regular', idempotencyKey: key(), now: NOW });
      await db.update(schema.sessions).set({ status }).where(eq(schema.sessions.clubId, s.club.id));
      return s;
    }

    it('takes no new member booking', async () => {
      const s = await closedSession();
      const u = await newMember(s.club.id, 'late');
      const res = await bookSeat(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u, paymentType: 'regular', idempotencyKey: key(), now: NOW });
      expect(res).toEqual({ ok: false, error: 'no_session' });
    });

    it('takes no owner-added booking either', async () => {
      const s = await closedSession();
      const u = await newMember(s.club.id, 'late');
      const res = await ownerAddBooking(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u, paymentType: 'regular', now: NOW });
      expect(res).toEqual({ ok: false, error: 'no_session' });
    });

    it('keeps the booking that was already on it', async () => {
      const s = await closedSession();
      const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('booked');
    });
  });

  describe('multisport daily limit', () => {
    // Two independent clubs, same timezone and weekday/date, so their blocks
    // land on the same club-local date and collide on the MultiSport index.
    async function seedClub(opts: { allowedPayment?: 'regular_only' | 'multisport_only' | 'both' }) {
      const tag = `ms-${Date.now()}-${seq++}`;
      const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ, multisportMode: 'equal', selfCancelEnabled: true, cancelCutoffHours: null, bookingOpenMode: 'always', bookingOpenLeadDays: null }).returning();
      const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 2, allowedPayment: opts.allowedPayment ?? 'both' }).returning();
      const [w] = await db.insert(schema.scheduleWindows).values({ clubId: club.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60 }).returning();
      await db.insert(schema.windowBoats).values({ windowId: w.id, boatTypeId: boat.id, quantity: 1 });
      return { clubId: club.id, windowId: w.id, boatTypeId: boat.id, startAt: START };
    }
    async function seedUserInBoth(a: { clubId: string }, b: { clubId: string }) {
      const uid = `msu-${Date.now()}-${seq++}`;
      await db.insert(schema.user).values({ id: uid, name: uid, email: `${uid}@t.co` });
      await db.insert(schema.memberships).values({ userId: uid, clubId: a.clubId, role: 'member', status: 'approved' });
      await db.insert(schema.memberships).values({ userId: uid, clubId: b.clubId, role: 'member', status: 'approved' });
      return uid;
    }

    it('rejects a second multisport seat on the same day in another club', async () => {
      // Two independent clubs, one member in both, same club-local date.
      const a = await seedClub({ allowedPayment: 'both' });
      const b = await seedClub({ allowedPayment: 'both' });
      const uid = await seedUserInBoth(a, b);

      const first = await bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'k-a', now: NOW });
      expect(first.ok).toBe(true);

      const second = await bookSeat(db, { clubId: b.clubId, userId: uid, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, paymentType: 'multisport', idempotencyKey: 'k-b', now: NOW });
      expect(second).toEqual({ ok: false, error: 'multisport_day_taken' });
    });

    it('still allows a regular seat the same day', async () => {
      const a = await seedClub({ allowedPayment: 'both' });
      const b = await seedClub({ allowedPayment: 'both' });
      const uid = await seedUserInBoth(a, b);
      await bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'k-a', now: NOW });
      const second = await bookSeat(db, { clubId: b.clubId, userId: uid, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, paymentType: 'regular', idempotencyKey: 'k-b', now: NOW });
      expect(second.ok).toBe(true);
    });

    it('frees the day again once the multisport seat is cancelled', async () => {
      const a = await seedClub({ allowedPayment: 'both' });
      const b = await seedClub({ allowedPayment: 'both' });
      const uid = await seedUserInBoth(a, b);
      const first = await bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'k-a', now: NOW });
      if (!first.ok) throw new Error('setup failed');
      await cancelBooking(db, { clubId: a.clubId, userId: uid, bookingId: first.bookingId, now: NOW });
      const second = await bookSeat(db, { clubId: b.clubId, userId: uid, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, paymentType: 'multisport', idempotencyKey: 'k-b', now: NOW });
      expect(second.ok).toBe(true);
    });

    it('the DATABASE refuses a duplicate, not just the guard', async () => {
      // Bypasses bookSeat entirely: proves the partial unique index exists and
      // covers the right predicate, which the guard-level tests above cannot.
      // Targets a *different* session (a filler booking in club b, same day) than
      // the member's own first booking — reusing the same session/user would also
      // trip `bookings_active_uq`, which would make this test pass for the wrong
      // reason.
      const a = await seedClub({ allowedPayment: 'both' });
      const b = await seedClub({ allowedPayment: 'both' });
      const uid = await seedUserInBoth(a, b);
      const first = await bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'k-a', now: NOW });
      if (!first.ok) throw new Error('setup failed');
      const [row] = await db.select({ sessionId: schema.bookings.sessionId, bookingDate: schema.bookings.bookingDate }).from(schema.bookings).where(eq(schema.bookings.id, first.bookingId));

      const fillerUid = await newMember(b.clubId, 'filler');
      const filler = await bookSeat(db, { clubId: b.clubId, userId: fillerUid, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, paymentType: 'regular', idempotencyKey: 'k-filler', now: NOW });
      if (!filler.ok) throw new Error('setup failed');
      const [bRow] = await db.select({ sessionId: schema.bookings.sessionId, bookingDate: schema.bookings.bookingDate }).from(schema.bookings).where(eq(schema.bookings.id, filler.bookingId));
      expect(bRow.bookingDate).toBe(row.bookingDate);

      await expect(
        db.insert(schema.bookings).values({
          sessionId: bRow.sessionId, clubId: b.clubId, userId: uid, paymentType: 'multisport',
          status: 'waitlisted', effectiveAt: NOW, bookingDate: bRow.bookingDate,
        }),
      ).rejects.toSatisfy((err: unknown) => isUniqueViolation(err, 'bookings_multisport_day_uq'));
    });

    it('lets exactly one of two concurrent bookings win', async () => {
      const a = await seedClub({ allowedPayment: 'both' });
      const b = await seedClub({ allowedPayment: 'both' });
      const uid = await seedUserInBoth(a, b);
      const [ra, rb] = await Promise.all([
        bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'c-a', now: NOW }),
        bookSeat(db, { clubId: b.clubId, userId: uid, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, paymentType: 'multisport', idempotencyKey: 'c-b', now: NOW }),
      ]);
      const wins = [ra, rb].filter((r) => r.ok).length;
      expect(wins).toBe(1);
      const loser = [ra, rb].find((r) => !r.ok);
      expect(loser).toEqual({ ok: false, error: 'multisport_day_taken' });
    });
  });
});
