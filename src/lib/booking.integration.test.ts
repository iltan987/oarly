import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { bookSeat, cancelBooking } from './booking';
import { zonedWallClockToUtc } from './date-tz';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
// 2026-07-27 is a Monday; window is Monday 08:00–09:00 local ⇒ block start 05:00Z.
const MON = '2026-07-27';
const START = zonedWallClockToUtc(MON, '08:00', TZ);

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
    const r1 = await bookSeat(db, { ...common, userId: u1, idempotencyKey: key() });
    const r2 = await bookSeat(db, { ...common, userId: u2, idempotencyKey: key() });
    const r3 = await bookSeat(db, { ...common, userId: u3, idempotencyKey: key() });
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
    const first = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: k });
    const again = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: k });
    expect(first.ok && again.ok && first.bookingId === again.bookingId).toBe(true);
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u));
    expect(rows).toHaveLength(1);
  });

  it('guarantees exactly capacity under a concurrent rush', async () => {
    const s = await scenario({ seats: 3 });
    const uids = await Promise.all(Array.from({ length: 12 }, (_v, i) => newMember(s.club.id, `rush${i}`)));
    const results = await Promise.all(uids.map((uid) => bookSeat(db, { clubId: s.club.id, userId: uid, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() })));
    expect(results.every((r) => r.ok)).toBe(true);
    const sessionRows = await db.select().from(schema.sessions).where(eq(schema.sessions.clubId, s.club.id));
    const seated = await db.select().from(schema.bookings).where(and(inArray(schema.bookings.sessionId, sessionRows.map((x) => x.id)), eq(schema.bookings.status, 'booked')));
    expect(seated).toHaveLength(3);
  });

  it('rejects an ineligible member (skill too low) with no booking written', async () => {
    const s = await scenario({ seats: 2, minSkillRank: 5 });
    const u = await newMember(s.club.id, 'low', null);
    const r = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    expect(r).toEqual({ ok: false, error: 'ineligible', reason: 'skill_too_low' });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u));
    expect(rows).toHaveLength(0);
  });

  it('rejects a second boat in the same slot', async () => {
    const s = await scenario({ seats: 2, quantity: 2 });
    const u = await newMember(s.club.id, 'dbl');
    const first = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    const second = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: 'already_booked_this_slot' });
  });

  it('priority mode: a later regular does not displace an earlier seated multisport (sticky)', async () => {
    const s = await scenario({ seats: 1, mode: 'priority' });
    const um = await newMember(s.club.id, 'ms');
    const ur = await newMember(s.club.id, 'reg');
    const rm = await bookSeat(db, { clubId: s.club.id, userId: um, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'multisport', idempotencyKey: key() });
    const rr = await bookSeat(db, { clubId: s.club.id, userId: ur, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    expect(rm).toMatchObject({ ok: true, outcome: 'seated' });
    expect(rr).toMatchObject({ ok: true, outcome: 'waitlisted' });
    const msBooking = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, um));
    expect(msBooking[0].status).toBe('booked');
  });

  it('cancellation auto-promotes the head of the waitlist', async () => {
    const s = await scenario({ seats: 1 });
    const u1 = await newMember(s.club.id, 'c1');
    const u2 = await newMember(s.club.id, 'c2');
    const r1 = await bookSeat(db, { clubId: s.club.id, userId: u1, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    await bookSeat(db, { clubId: s.club.id, userId: u2, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    expect(r1.ok).toBe(true);
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u1, bookingId: (r1 as { bookingId: string }).bookingId, now: new Date('2026-07-01T00:00:00Z') });
    expect(cancel).toMatchObject({ ok: true });
    const promoted = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u2));
    expect(promoted[0].status).toBe('booked');
  });

  it('blocks self-cancel after the cutoff', async () => {
    const s = await scenario({ seats: 2, cutoffHours: 8 });
    const u = await newMember(s.club.id, 'cut');
    const r = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    // now = 2h before start (< 8h cutoff)
    const late = new Date(START.getTime() - 2 * 60 * 60 * 1000);
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u, bookingId: (r as { bookingId: string }).bookingId, now: late });
    expect(cancel).toEqual({ ok: false, error: 'cutoff_passed' });
  });

  it('rejects booking on a club-force-closed day with no booking written', async () => {
    const s = await scenario({ seats: 2 });
    await db.insert(schema.clubHolidayOverrides).values({ clubId: s.club.id, date: MON, isOpen: false });
    const u = await newMember(s.club.id, 'closed');
    const r = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
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
    const r = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
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
    const r1 = await bookSeat(db, { ...common, userId: u1, paymentType: 'multisport', idempotencyKey: key() });
    const r2 = await bookSeat(db, { ...common, userId: u2, paymentType: 'regular', idempotencyKey: key() });
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
    const r1 = await bookSeat(db, { ...common, userId: u1, idempotencyKey: key() });
    await bookSeat(db, { ...common, userId: u2, idempotencyKey: key() });
    if (!r1.ok) throw new Error('setup');
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u1, bookingId: r1.bookingId });
    expect(cancel).toMatchObject({ ok: true, promoted: { userId: u2, sessionId: expect.any(String) } });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
    expect(rows.find((r) => r.userId === u2)!.status).toBe('booked');
  });

  it('cancelling a waitlisted booking promotes nobody', async () => {
    const s = await scenario({ seats: 1 });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular' as const };
    await bookSeat(db, { ...common, userId: u1, idempotencyKey: key() });
    const r2 = await bookSeat(db, { ...common, userId: u2, idempotencyKey: key() });
    if (!r2.ok) throw new Error('setup');
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u2, bookingId: r2.bookingId });
    expect(cancel).toEqual({ ok: true });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
    expect(rows.find((r) => r.userId === u1)!.status).toBe('booked');
  });
});
