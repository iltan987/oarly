import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { markNoShow } from './attendance';
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
  /** The owner every owner-override call below is attributed to — `audit_log.actor_user_id` is a real FK. */
  let ownerId: string;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
    ownerId = `bk-owner-${randomUUID()}`;
    await db.insert(schema.user).values({ id: ownerId, name: 'Owner', email: `${ownerId}@t.co` });
  });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  async function scenario(opts: { seats: number; quantity?: number; mode?: 'equal' | 'priority'; allowedPayment?: 'regular_only' | 'multisport_only' | 'both'; minSkillRank?: number; selfCancel?: boolean; cutoffHours?: number | null; bookingOpenMode?: 'always' | 'lead'; bookingOpenLeadDays?: number | null; multisportEnabled?: boolean }) {
    const tag = `bk-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ, multisportMode: opts.mode ?? 'equal', multisportEnabled: opts.multisportEnabled ?? true, selfCancelEnabled: opts.selfCancel ?? true, cancelCutoffHours: opts.cutoffHours ?? null, bookingOpenMode: opts.bookingOpenMode ?? 'always', bookingOpenLeadDays: opts.bookingOpenLeadDays ?? null }).returning();
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
    const removed = await ownerRemoveBooking(db, { actorId: ownerId, clubId: s.club.id, bookingId: r1.bookingId });
    expect(removed).toMatchObject({ ok: true, promoted: { userId: u2 } });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
    expect(rows.find((r) => r.userId === u2)!.status).toBe('booked');
  });

  /**
   * `status = 'cancelled'` is true of all three cancellation paths and was true before
   * `cancelledReason` existed, so asserting it proves nothing about the new column. Each
   * test below reads the column back from the database and names the value.
   *
   * Both are deliberately set up so that `source` disagrees with `cancelledReason`: an
   * implementation that copied `source` — the obvious wrong answer, since the two columns
   * hold the same three-ish words — passes neither.
   */
  describe('cancelledReason records who ENDED the booking, not who created it', () => {
    it("writes 'member' when the member cancels — even a seat the OWNER put them in", async () => {
      const s = await scenario({ seats: 2 });
      const u1 = await newMember(s.club.id, 'u1');
      const added = await ownerAddBooking(db, { actorId: ownerId, clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u1, paymentType: 'regular', now: NOW });
      if (!added.ok) throw new Error('setup');

      const [before] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, added.bookingId));
      // Asserted, not assumed: this is what makes the expectation below discriminating.
      expect(before.source).toBe('owner');
      expect(before.cancelledReason).toBeNull();

      expect(await cancelBooking(db, { clubId: s.club.id, userId: u1, bookingId: added.bookingId, now: NOW })).toMatchObject({ ok: true });

      const [after] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, added.bookingId));
      expect(after.status).toBe('cancelled');
      expect(after.cancelledReason).toBe('member');
    });

    it("writes 'owner' when the owner removes a seat the MEMBER booked", async () => {
      const s = await scenario({ seats: 2 });
      const u1 = await newMember(s.club.id, 'u1');
      const r = await bookSeat(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', userId: u1, idempotencyKey: key(), now: NOW });
      if (!r.ok) throw new Error('setup');

      const [before] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, r.bookingId));
      expect(before.source).toBe('member');
      expect(before.cancelledReason).toBeNull();

      expect(await ownerRemoveBooking(db, { actorId: ownerId, clubId: s.club.id, bookingId: r.bookingId })).toMatchObject({ ok: true });

      const [after] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, r.bookingId));
      expect(after.status).toBe('cancelled');
      expect(after.cancelledReason).toBe('owner');
    });

    it('puts no reason on the waitlister it promotes into the freed seat', async () => {
      const s = await scenario({ seats: 1 });
      const u1 = await newMember(s.club.id, 'u1');
      const u2 = await newMember(s.club.id, 'u2');
      const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular' as const };
      const r1 = await bookSeat(db, { ...common, userId: u1, idempotencyKey: key(), now: NOW });
      await bookSeat(db, { ...common, userId: u2, idempotencyKey: key(), now: NOW });
      if (!r1.ok) throw new Error('setup');

      await cancelBooking(db, { clubId: s.club.id, userId: u1, bookingId: r1.bookingId, now: NOW });

      const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
      const promoted = rows.find((r) => r.userId === u2)!;
      // `applySeating` rewrote this row (waitlisted -> booked), asserted first so the null
      // below is not vacuously true of a row nothing ever touched.
      expect(promoted.status).toBe('booked');
      expect(promoted.cancelledReason).toBeNull();
    });
  });

  it('owner seats a member into a free seat, tagged source=owner', async () => {
    const s = await scenario({ seats: 2, allowedPayment: 'both' });
    const u1 = await newMember(s.club.id, 'u1');
    const res = await ownerAddBooking(db, { actorId: ownerId, clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u1, paymentType: 'regular', now: NOW });
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
    await ownerAddBooking(db, { actorId: ownerId, clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u1, paymentType: 'regular', now: NOW });
    const res = await ownerAddBooking(db, { actorId: ownerId, clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u2, paymentType: 'regular', now: NOW });
    expect(res).toEqual({ ok: false, error: 'session_full' });
  });

  /**
   * The seat-counting disagreement between `getDayRoster` and `ownerAddBooking`.
   *
   * `markNoShow` never calls `applySeating` on the session it marks (only on the future
   * sessions its ban cascade touches — see `attendance.ts`), so a session can sit at
   * `booked = capacity - 1` WITH a waitlisted row behind it. `roster.ts` counts `booked`
   * only and offers the owner an add form for that seat; `ownerAddBooking` used to count
   * `booked` + `waitlisted` and refuse it.
   *
   * Every test here drives the state through the real product calls — `bookSeat` then
   * `markNoShow` — rather than inserting a hand-made row, so it cannot pass against a
   * state the app can never actually be in.
   */
  describe('owner-add counts seated members, not the queue behind them', () => {
    const AFTER_START = new Date(START.getTime() + 60 * 60 * 1000);

    /**
     * A full boat with a queue behind it, plus one unbooked walk-in. Strictly increasing
     * `now` per booker so `resolveSeating`'s (effectiveAt, id) tie-break is deterministic
     * and the queue comes out in the order they were seeded.
     */
    async function fullBoatWithQueue(seats: number, waiters = 1) {
      const s = await scenario({ seats });
      const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular' as const };
      const seated = [];
      for (let i = 0; i < seats; i++) {
        const uid = await newMember(s.club.id, `seat${i}`);
        const r = await bookSeat(db, { ...common, userId: uid, idempotencyKey: key(), now: new Date(NOW.getTime() + i) });
        if (!r.ok || r.outcome !== 'seated') throw new Error('setup: expected a seat');
        seated.push({ uid, bookingId: r.bookingId });
      }
      const waiting = [];
      for (let i = 0; i < waiters; i++) {
        const uid = await newMember(s.club.id, `wait${i}`);
        const r = await bookSeat(db, { ...common, userId: uid, idempotencyKey: key(), now: new Date(NOW.getTime() + seats + i) });
        if (!r.ok || r.outcome !== 'waitlisted' || r.queuePosition !== i + 1) throw new Error('setup: expected a waitlist place');
        waiting.push({ uid, bookingId: r.bookingId });
      }
      const walkInId = await newMember(s.club.id, 'walkin');
      const sessionId = (await db.select().from(schema.bookings).where(eq(schema.bookings.id, seated[0].bookingId)))[0].sessionId;
      return { s, seated, waiting, waiterId: waiting[0].uid, waiterBookingId: waiting[0].bookingId, walkInId, sessionId };
    }

    /** The session's rows by status, for asserting a whole shape rather than one row. */
    async function shapeOf(sessionId: string) {
      const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.sessionId, sessionId));
      return {
        booked: rows.filter((r) => r.status === 'booked').length,
        waitlisted: rows.filter((r) => r.status === 'waitlisted').length,
        no_show: rows.filter((r) => r.status === 'no_show').length,
      };
    }

    it('seats the walk-in into a seat an absence freed, with someone still on the waitlist', async () => {
      const f = await fullBoatWithQueue(4);
      // The absence. 'off' is this club's default no-show policy, so no ban and no
      // cascade — the only thing that changes is one row: booked 4 -> 3.
      const marked = await markNoShow(db, { actorId: ownerId, clubId: f.s.club.id, bookingId: f.seated[0].bookingId, now: AFTER_START });
      expect(marked).toMatchObject({ ok: true });

      // The state the owner is looking at on /manage/bookings: 3 seated, 1 free seat,
      // 1 waiting. Asserted, not assumed — it is the whole premise of this test.
      expect(await shapeOf(f.sessionId)).toEqual({ booked: 3, waitlisted: 1, no_show: 1 });

      const added = await ownerAddBooking(db, { actorId: ownerId, clubId: f.s.club.id, windowId: f.s.w.id, boatTypeId: f.s.boat.id, startAt: START, userId: f.walkInId, paymentType: 'regular', now: AFTER_START });
      expect(added).toMatchObject({ ok: true });
      if (!added.ok) return;
      const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, added.bookingId));
      expect(row.status).toBe('booked');
    });

    it('leaves the waitlisted member waiting and the absence mark untouched', async () => {
      const f = await fullBoatWithQueue(4);
      await markNoShow(db, { actorId: ownerId, clubId: f.s.club.id, bookingId: f.seated[0].bookingId, now: AFTER_START });
      const added = await ownerAddBooking(db, { actorId: ownerId, clubId: f.s.club.id, windowId: f.s.w.id, boatTypeId: f.s.boat.id, startAt: START, userId: f.walkInId, paymentType: 'regular', now: AFTER_START });
      expect(added).toMatchObject({ ok: true });

      // `applySeating` runs on the very next line after the insert. With booked back at
      // capacity it must promote nobody — and it must not touch the no_show row, which
      // falls outside the ('booked','waitlisted') set it reads.
      const [waiter] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.waiterBookingId));
      expect(waiter.status).toBe('waitlisted');
      expect(waiter.queuePosition).toBe(1);
      const [missed] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.seated[0].bookingId));
      expect(missed.status).toBe('no_show');
      expect(missed.queuePosition).toBeNull();
      expect(missed.cancelledReason).toBeNull();

      expect(await shapeOf(f.sessionId)).toEqual({ booked: 4, waitlisted: 1, no_show: 1 });
    });

    /**
     * TWO absences and TWO waiting — the shape where the seat the owner fills is not the
     * last free one. An owner add seats ONE named member and moves nobody else: this
     * session has already started (`markNoShow` requires `startAt <= now`, and it is the
     * only thing in the codebase that can leave a free seat with a live queue behind it),
     * so a promotion here hands a seat to somebody who cannot possibly take it — and
     * `ownerAddBooking` reports no promotion, so nothing would ever tell them.
     *
     * This is the test the single-absence pair above cannot give: with `booked` one short
     * of capacity, `applySeating` has no free seat left after the insert and is a no-op
     * either way, so it passes with the promotion left in.
     */
    it('seats only the member the owner named, promoting nobody, when two seats were freed', async () => {
      const f = await fullBoatWithQueue(4, 2);
      for (const i of [0, 1]) {
        expect(await markNoShow(db, { actorId: ownerId, clubId: f.s.club.id, bookingId: f.seated[i].bookingId, now: AFTER_START })).toMatchObject({ ok: true });
      }
      expect(await shapeOf(f.sessionId)).toEqual({ booked: 2, waitlisted: 2, no_show: 2 });

      const added = await ownerAddBooking(db, { actorId: ownerId, clubId: f.s.club.id, windowId: f.s.w.id, boatTypeId: f.s.boat.id, startAt: START, userId: f.walkInId, paymentType: 'regular', now: AFTER_START });
      expect(added).toMatchObject({ ok: true });

      // One row moved: the walk-in's. The second freed seat stays open for the owner to
      // fill with whoever actually turned up.
      expect(await shapeOf(f.sessionId)).toEqual({ booked: 3, waitlisted: 2, no_show: 2 });
      const queue = await db.select().from(schema.bookings).where(inArray(schema.bookings.id, f.waiting.map((w) => w.bookingId)));
      expect(queue.map((r) => r.status)).toEqual(['waitlisted', 'waitlisted']);
      expect([...queue].sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0)).map((r) => r.queuePosition)).toEqual([1, 2]);
    });

    // The guard that must not regress, and the one the pre-existing 'rejects a full
    // session' test cannot give: a waitlist behind a genuinely full boat. Counting
    // nothing at all, or counting only the queue, both pass that older test.
    it('still refuses when the boat is full on booked rows alone, waitlist or not', async () => {
      const f = await fullBoatWithQueue(2);
      const res = await ownerAddBooking(db, { actorId: ownerId, clubId: f.s.club.id, windowId: f.s.w.id, boatTypeId: f.s.boat.id, startAt: START, userId: f.walkInId, paymentType: 'regular', now: AFTER_START });
      expect(res).toEqual({ ok: false, error: 'session_full' });
      const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, f.walkInId));
      expect(rows).toHaveLength(0);
      const [waiter] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.waiterBookingId));
      expect(waiter.status).toBe('waitlisted');
    });

    /**
     * `booked < capacity` alongside a waitlisted row is otherwise UNREACHABLE: every
     * seat-freeing path calls `applySeating`, which promotes into the seat it just freed
     * within the same transaction. Rather than assert on a state the product cannot
     * produce, these drive the two paths that free a seat and pin that each closes the
     * gap — which is what makes the absence path above the single exception this fix is
     * for.
     */
    it('leaves no free seat behind a waitlist when a member cancels', async () => {
      const f = await fullBoatWithQueue(2);
      const cancelled = await cancelBooking(db, { clubId: f.s.club.id, userId: f.seated[0].uid, bookingId: f.seated[0].bookingId, now: NOW });
      expect(cancelled).toMatchObject({ ok: true, promoted: { userId: f.waiterId } });
      const [waiter] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.waiterBookingId));
      expect(waiter.status).toBe('booked');
      const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.sessionId, waiter.sessionId));
      expect(rows.filter((r) => r.status === 'booked')).toHaveLength(2);
      expect(rows.filter((r) => r.status === 'waitlisted')).toHaveLength(0);
    });

    it('leaves no free seat behind a waitlist when the owner removes a member', async () => {
      const f = await fullBoatWithQueue(2);
      const removed = await ownerRemoveBooking(db, { actorId: ownerId, clubId: f.s.club.id, bookingId: f.seated[0].bookingId });
      expect(removed).toMatchObject({ ok: true, promoted: { userId: f.waiterId } });
      const [waiter] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.waiterBookingId));
      expect(waiter.status).toBe('booked');
      const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.sessionId, waiter.sessionId));
      expect(rows.filter((r) => r.status === 'booked')).toHaveLength(2);
      expect(rows.filter((r) => r.status === 'waitlisted')).toHaveLength(0);
    });
  });

  it('owner-add rejects a non-approved member', async () => {
    const s = await scenario({ seats: 2, allowedPayment: 'both' });
    const pend = await newMember(s.club.id, 'p', null, 'pending');
    const res = await ownerAddBooking(db, { actorId: ownerId, clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: pend, paymentType: 'regular', now: NOW });
    expect(res).toEqual({ ok: false, error: 'not_a_member' });
  });

  it('owner-add rejects MultiSport at a club that has MultiSport disabled', async () => {
    const s = await scenario({ seats: 2, allowedPayment: 'both', multisportEnabled: false });
    const u1 = await newMember(s.club.id, 'u1');
    const res = await ownerAddBooking(db, { actorId: ownerId, clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u1, paymentType: 'multisport', now: NOW });
    expect(res).toEqual({ ok: false, error: 'multisport_disabled' });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u1));
    expect(rows).toHaveLength(0);
  });

  it('owner-add still accepts regular at a club that has MultiSport disabled', async () => {
    const s = await scenario({ seats: 2, allowedPayment: 'both', multisportEnabled: false });
    const u1 = await newMember(s.club.id, 'u1');
    const res = await ownerAddBooking(db, { actorId: ownerId, clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u1, paymentType: 'regular', now: NOW });
    expect(res).toMatchObject({ ok: true });
  });

  /** One club, one seated member — the booking an owner then removes. */
  async function seedOwnerBooking() {
    const s = await scenario({ seats: 2 });
    const uid = await newMember(s.club.id, 'own');
    const r = await bookSeat(db, { clubId: s.club.id, userId: uid, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key(), now: NOW });
    if (!r.ok) throw new Error('setup');
    return { clubId: s.club.id, bookingId: r.bookingId };
  }

  it('audits booking.owner_remove', async () => {
    const f = await seedOwnerBooking();
    expect(await ownerRemoveBooking(db, { actorId: ownerId, clubId: f.clubId, bookingId: f.bookingId }))
      .toMatchObject({ ok: true });
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, f.bookingId));
    expect(rows.map((a) => a.action)).toContain('booking.owner_remove');
    expect(rows[0].actingAsRole).toBe('owner');
    expect(rows[0].actorUserId).toBe(ownerId);
    expect(rows[0].clubId).toBe(f.clubId);
  });

  it('rolls the removal back when the audit insert fails', async () => {
    const f = await seedOwnerBooking();
    await expect(ownerRemoveBooking(db, { actorId: 'no-such-user', clubId: f.clubId, bookingId: f.bookingId }))
      .rejects.toThrow();
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.bookingId));
    expect(booking.status).toBe('booked');
  });

  it('writes no audit row when the booking is not active', async () => {
    const f = await seedOwnerBooking();
    await ownerRemoveBooking(db, { actorId: ownerId, clubId: f.clubId, bookingId: f.bookingId });
    const before = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, f.bookingId));
    expect(await ownerRemoveBooking(db, { actorId: ownerId, clubId: f.clubId, bookingId: f.bookingId }))
      .toEqual({ ok: false, error: 'not_active' });
    const after = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, f.bookingId));
    expect(after).toHaveLength(before.length);
  });

  it('audits booking.owner_add against the created booking', async () => {
    const s = await scenario({ seats: 2 });
    const uid = await newMember(s.club.id, 'add');
    const res = await ownerAddBooking(db, { actorId: ownerId, clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: uid, paymentType: 'regular', now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, res.bookingId));
    expect(rows.map((a) => a.action)).toContain('booking.owner_add');
    expect(rows[0].actingAsRole).toBe('owner');
    expect(rows[0].actorUserId).toBe(ownerId);
  });

  it('rolls the owner-add back when the audit insert fails', async () => {
    const s = await scenario({ seats: 2 });
    const uid = await newMember(s.club.id, 'addfail');
    await expect(ownerAddBooking(db, { actorId: 'no-such-user', clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: uid, paymentType: 'regular', now: NOW }))
      .rejects.toThrow();
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, uid));
    expect(rows).toHaveLength(0);
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
      const res = await ownerAddBooking(db, { actorId: ownerId, clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u, paymentType: 'regular', now: NOW });
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

    it('rejects a second multisport seat via the owner override too — the card, not the club, sets this rule', async () => {
      const a = await seedClub({ allowedPayment: 'both' });
      const b = await seedClub({ allowedPayment: 'both' });
      const uid = await seedUserInBoth(a, b);

      const first = await bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'k-a', now: NOW });
      expect(first.ok).toBe(true);

      const second = await ownerAddBooking(db, { actorId: ownerId, clubId: b.clubId, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, userId: uid, paymentType: 'multisport', now: NOW });
      expect(second).toEqual({ ok: false, error: 'multisport_day_taken' });
    });

    it('still allows a regular seat the same day', async () => {
      const a = await seedClub({ allowedPayment: 'both' });
      const b = await seedClub({ allowedPayment: 'both' });
      const uid = await seedUserInBoth(a, b);
      const first = await bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'k-a', now: NOW });
      expect(first.ok).toBe(true);
      const second = await bookSeat(db, { clubId: b.clubId, userId: uid, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, paymentType: 'regular', idempotencyKey: 'k-b', now: NOW });
      expect(second.ok).toBe(true);
    });

    it('allows a multisport seat the same day after an earlier regular booking', async () => {
      // The reverse of the case above: an over-broad guard that forgot to require
      // the *existing* row to be multisport would wrongly block this.
      const a = await seedClub({ allowedPayment: 'both' });
      const b = await seedClub({ allowedPayment: 'both' });
      const uid = await seedUserInBoth(a, b);
      const first = await bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'regular', idempotencyKey: 'k-a', now: NOW });
      expect(first.ok).toBe(true);
      const second = await bookSeat(db, { clubId: b.clubId, userId: uid, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, paymentType: 'multisport', idempotencyKey: 'k-b', now: NOW });
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

  describe('waitlist capacity', () => {
    async function seedClubWithCapacity(opts: { seats: number; waitlistCapacity: number | null; quantity?: number }) {
      const tag = `wl-${Date.now()}-${seq++}`;
      const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ, multisportMode: 'equal', selfCancelEnabled: true, cancelCutoffHours: null, bookingOpenMode: 'always', bookingOpenLeadDays: null, waitlistCapacity: opts.waitlistCapacity }).returning();
      const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: opts.seats, allowedPayment: 'both' }).returning();
      const [w] = await db.insert(schema.scheduleWindows).values({ clubId: club.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60 }).returning();
      await db.insert(schema.windowBoats).values({ windowId: w.id, boatTypeId: boat.id, quantity: opts.quantity ?? 1 });
      return { clubId: club.id, windowId: w.id, boatTypeId: boat.id, startAt: START };
    }
    async function seedMembers(c: { clubId: string }, n: number) {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const uid = `wlu-${Date.now()}-${seq++}`;
        await db.insert(schema.user).values({ id: uid, name: uid, email: `${uid}@t.co` });
        await db.insert(schema.memberships).values({ userId: uid, clubId: c.clubId, role: 'member', status: 'approved' });
        ids.push(uid);
      }
      return ids;
    }

    it('turns away bookers once the seats and the queue are both full', async () => {
      // The brief: 4 seats, 4 queue slots, 15 hopefuls. 8 get in, 7 are told no.
      const c = await seedClubWithCapacity({ seats: 4, waitlistCapacity: 4 });
      const users = await seedMembers(c, 15);

      const results = [];
      // Strictly increasing `now` per booker (still frozen, still deterministic —
      // never the real clock) to model that these 15 arrive one after another.
      // resolveSeating's waitlist tie-break is (effectiveAt, id); with a single
      // bit-identical NOW for every caller, ties fall to a random-per-row UUID,
      // so the position handed back to an EARLIER caller can collide with one
      // handed back to a LATER caller before the session's queue settles — an
      // id-ordering artifact orthogonal to the cap being tested here.
      for (let i = 0; i < users.length; i++) {
        results.push(await bookSeat(db, { clubId: c.clubId, userId: users[i], windowId: c.windowId, boatTypeId: c.boatTypeId, startAt: c.startAt, paymentType: 'regular', idempotencyKey: `w-${users[i]}`, now: new Date(NOW.getTime() + i) }));
      }

      expect(results.filter((r) => r.ok && r.outcome === 'seated')).toHaveLength(4);
      expect(results.filter((r) => r.ok && r.outcome === 'waitlisted')).toHaveLength(4);
      expect(results.filter((r) => !r.ok && r.error === 'waitlist_full')).toHaveLength(7);

      const queued = results.filter((r) => r.ok && r.outcome === 'waitlisted').map((r) => (r.ok ? r.queuePosition : null));
      expect([...queued].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4]);
    });

    it('holds the line under a concurrent rush', async () => {
      // Same shape, but all 15 at once — the per-slot advisory lock is what makes
      // the count reliable between the check and the insert.
      const c = await seedClubWithCapacity({ seats: 4, waitlistCapacity: 4 });
      const users = await seedMembers(c, 15);

      const results = await Promise.all(users.map((uid) =>
        bookSeat(db, { clubId: c.clubId, userId: uid, windowId: c.windowId, boatTypeId: c.boatTypeId, startAt: c.startAt, paymentType: 'regular', idempotencyKey: `r-${uid}`, now: NOW })));

      expect(results.filter((r) => r.ok)).toHaveLength(8);
      expect(results.filter((r) => !r.ok && r.error === 'waitlist_full')).toHaveLength(7);

      const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, c.clubId));
      expect(rows.filter((r) => r.status === 'booked')).toHaveLength(4);
      expect(rows.filter((r) => r.status === 'waitlisted')).toHaveLength(4);
    });

    it('admits everyone when no cap is set', async () => {
      const c = await seedClubWithCapacity({ seats: 2, waitlistCapacity: null });
      const users = await seedMembers(c, 9);
      const results = [];
      for (const uid of users) {
        results.push(await bookSeat(db, { clubId: c.clubId, userId: uid, windowId: c.windowId, boatTypeId: c.boatTypeId, startAt: c.startAt, paymentType: 'regular', idempotencyKey: `u-${uid}`, now: NOW }));
      }
      expect(results.every((r) => r.ok)).toBe(true);
      expect(results.filter((r) => r.ok && r.outcome === 'waitlisted')).toHaveLength(7);
    });

    it('turns away everyone once the seats are full when the cap is 0 — no queue at all', async () => {
      // waitlistCapacity: 0 is semantically distinct from null (unlimited): it
      // means no queue may form behind a full session.
      const c = await seedClubWithCapacity({ seats: 2, waitlistCapacity: 0 });
      const users = await seedMembers(c, 4);
      const results = [];
      for (const uid of users) {
        results.push(await bookSeat(db, { clubId: c.clubId, userId: uid, windowId: c.windowId, boatTypeId: c.boatTypeId, startAt: c.startAt, paymentType: 'regular', idempotencyKey: `z-${uid}`, now: NOW }));
      }
      expect(results.filter((r) => r.ok && r.outcome === 'seated')).toHaveLength(2);
      expect(results.filter((r) => !r.ok && r.error === 'waitlist_full')).toHaveLength(2);
    });

    it('packs free seats first, then fills each session to its own cap, then rejects', async () => {
      // A boat with quantity 2 materializes two sessions of this block, each with
      // its own 2 seats + 1 queue slot: 4 free seats total, then 2 queue slots
      // total, then everyone else is turned away.
      const c = await seedClubWithCapacity({ seats: 2, waitlistCapacity: 1, quantity: 2 });
      const users = await seedMembers(c, 8);
      const results = [];
      for (const uid of users) {
        results.push(await bookSeat(db, { clubId: c.clubId, userId: uid, windowId: c.windowId, boatTypeId: c.boatTypeId, startAt: c.startAt, paymentType: 'regular', idempotencyKey: `m-${uid}`, now: NOW }));
      }
      expect(results.filter((r) => r.ok && r.outcome === 'seated')).toHaveLength(4);
      expect(results.filter((r) => r.ok && r.outcome === 'waitlisted')).toHaveLength(2);
      expect(results.filter((r) => !r.ok && r.error === 'waitlist_full')).toHaveLength(2);
    });

    it('reopens a queue slot when someone cancels', async () => {
      const c = await seedClubWithCapacity({ seats: 1, waitlistCapacity: 1 });
      const users = await seedMembers(c, 3);
      const first = await bookSeat(db, { clubId: c.clubId, userId: users[0], windowId: c.windowId, boatTypeId: c.boatTypeId, startAt: c.startAt, paymentType: 'regular', idempotencyKey: 'q-1', now: NOW });
      const second = await bookSeat(db, { clubId: c.clubId, userId: users[1], windowId: c.windowId, boatTypeId: c.boatTypeId, startAt: c.startAt, paymentType: 'regular', idempotencyKey: 'q-2', now: NOW });
      const third = await bookSeat(db, { clubId: c.clubId, userId: users[2], windowId: c.windowId, boatTypeId: c.boatTypeId, startAt: c.startAt, paymentType: 'regular', idempotencyKey: 'q-3', now: NOW });
      expect(third).toEqual({ ok: false, error: 'waitlist_full' });
      if (!second.ok) throw new Error('setup failed');

      await cancelBooking(db, { clubId: c.clubId, userId: users[1], bookingId: second.bookingId, now: NOW });
      const retry = await bookSeat(db, { clubId: c.clubId, userId: users[2], windowId: c.windowId, boatTypeId: c.boatTypeId, startAt: c.startAt, paymentType: 'regular', idempotencyKey: 'q-4', now: NOW });
      // The freed slot is the QUEUE slot, not the seat itself (the seat is still
      // held by `first`) — pin outcome + position so this can't pass on a seat
      // opening up instead.
      expect(retry).toMatchObject({ ok: true, outcome: 'waitlisted', queuePosition: 1 });
      if (!first.ok) throw new Error('setup failed');
    });
  });
});
