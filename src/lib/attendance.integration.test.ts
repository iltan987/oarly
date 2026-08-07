import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { markNoShow } from './attendance';
import { zonedWallClockToUtc } from './date-tz';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
// Frozen clock: the missed session is in the past, "now" is the evening after it.
const MISSED_DAY = '2026-03-10';
const MISSED_START = zonedWallClockToUtc(MISSED_DAY, '07:00', TZ);
const NOW = zonedWallClockToUtc(MISSED_DAY, '20:00', TZ);

describe.skipIf(!url)('markNoShow', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  /** One club, one member, one seated booking on the missed session. */
  async function seed(policy: 'off' | '2d' | '1w' | '2w' | '1m' | 'never' = '1w') {
    const tag = `att-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ, noshowPenalty: policy }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 2, allowedPayment: 'both' }).returning();
    const uid = `${tag}-u`;
    await db.insert(schema.user).values({ id: uid, name: 'Ali', email: `${uid}@t.co` });
    const [membership] = await db.insert(schema.memberships).values({ userId: uid, clubId: club.id, status: 'approved' }).returning();

    const [slot] = await db.insert(schema.slots).values({ clubId: club.id, date: MISSED_DAY, startAt: MISSED_START, endAt: zonedWallClockToUtc(MISSED_DAY, '08:00', TZ) }).returning();
    const [session] = await db.insert(schema.sessions).values({ slotId: slot.id, clubId: club.id, boatTypeId: boat.id, capacity: 2 }).returning();
    const [booking] = await db.insert(schema.bookings).values({ sessionId: session.id, clubId: club.id, userId: uid, paymentType: 'regular', status: 'booked', effectiveAt: MISSED_START, bookingDate: MISSED_DAY }).returning();
    return { club, boat, uid, membership, session, booking };
  }

  /** Add a future seat for the same member on `dateISO` at 07:00. */
  async function seedFutureSeat(ctx: Awaited<ReturnType<typeof seed>>, dateISO: string) {
    const [slot] = await db.insert(schema.slots).values({ clubId: ctx.club.id, date: dateISO, startAt: zonedWallClockToUtc(dateISO, '07:00', TZ), endAt: zonedWallClockToUtc(dateISO, '08:00', TZ) }).returning();
    const [session] = await db.insert(schema.sessions).values({ slotId: slot.id, clubId: ctx.club.id, boatTypeId: ctx.boat.id, capacity: 2 }).returning();
    const [booking] = await db.insert(schema.bookings).values({ sessionId: session.id, clubId: ctx.club.id, userId: ctx.uid, paymentType: 'regular', status: 'booked', effectiveAt: NOW, bookingDate: dateISO }).returning();
    return { session, booking };
  }

  it('marks the booking, writes a penalty and bans until session start + policy', async () => {
    const ctx = await seed('1w');
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.permanent).toBe(false);
    expect(result.bannedUntil).toEqual(zonedWallClockToUtc('2026-03-17', '07:00', TZ));

    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, ctx.booking.id));
    expect(booking.status).toBe('no_show');
    const [penalty] = await db.select().from(schema.penalties).where(eq(schema.penalties.bookingId, ctx.booking.id));
    expect(penalty.reason).toBe('no_show');
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, ctx.membership.id));
    expect(m.bannedUntil).toEqual(zonedWallClockToUtc('2026-03-17', '07:00', TZ));
  });

  it('records the absence but imposes no ban when the policy is off', async () => {
    const ctx = await seed('off');
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result).toMatchObject({ ok: true, bannedUntil: null, permanent: false });
    const [penalty] = await db.select().from(schema.penalties).where(eq(schema.penalties.bookingId, ctx.booking.id));
    expect(penalty).toBeDefined();
    expect(penalty.bannedUntil).toBeNull();
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, ctx.membership.id));
    expect(m.bannedUntil).toBeNull();
    expect(m.status).toBe('approved');
  });

  it('sets the membership to banned for a never policy', async () => {
    const ctx = await seed('never');
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result).toMatchObject({ ok: true, permanent: true });
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, ctx.membership.id));
    expect(m.status).toBe('banned');
  });

  it('cancels a future seat inside the ban window and promotes the waitlist', async () => {
    const ctx = await seed('1w');
    const future = await seedFutureSeat(ctx, '2026-03-12');   // inside 10 Mar + 7d
    // Someone waiting for that seat.
    const other = `${ctx.uid}-b`;
    await db.insert(schema.user).values({ id: other, name: 'Bora', email: `${other}@t.co` });
    await db.insert(schema.memberships).values({ userId: other, clubId: ctx.club.id, status: 'approved' });
    await db.insert(schema.bookings).values({ sessionId: future.session.id, clubId: ctx.club.id, userId: other, paymentType: 'regular', status: 'waitlisted', queuePosition: 1, effectiveAt: NOW, bookingDate: '2026-03-12' });
    // Fill the remaining seat so the waitlister is genuinely waiting.
    const filler = `${ctx.uid}-c`;
    await db.insert(schema.user).values({ id: filler, name: 'Cem', email: `${filler}@t.co` });
    await db.insert(schema.memberships).values({ userId: filler, clubId: ctx.club.id, status: 'approved' });
    await db.insert(schema.bookings).values({ sessionId: future.session.id, clubId: ctx.club.id, userId: filler, paymentType: 'regular', status: 'booked', effectiveAt: NOW, bookingDate: '2026-03-12' });

    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cancelled.map((c) => c.bookingId)).toEqual([future.booking.id]);
    expect(result.promoted).toEqual([{ userId: other, sessionId: future.session.id }]);

    const [cancelled] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, future.booking.id));
    expect(cancelled.status).toBe('cancelled');
  });

  it('leaves a seat that falls after the ban ends', async () => {
    const ctx = await seed('1w');
    const later = await seedFutureSeat(ctx, '2026-03-25');    // beyond 10 Mar + 7d
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cancelled).toEqual([]);
    const [kept] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, later.booking.id));
    expect(kept.status).toBe('booked');
  });

  it('cancels every future seat when the ban is permanent', async () => {
    const ctx = await seed('never');
    const far = await seedFutureSeat(ctx, '2027-01-05');
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cancelled.map((c) => c.bookingId)).toEqual([far.booking.id]);
  });

  it('reports a ban that was born expired', async () => {
    const ctx = await seed('2d');
    // A seat that would fall inside a *live* 2-day ban but is nowhere near the
    // window this already-lapsed ban would have had — it must survive, and
    // must survive because the ban is over, not merely because no future seat
    // was seeded (that would make the assertion vacuous).
    const survivor = await seedFutureSeat(ctx, '2026-04-01');
    const late = zonedWallClockToUtc('2026-03-30', '20:00', TZ);   // marked long after
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: late });
    expect(result).toMatchObject({ ok: true, alreadyLapsed: true });
    if (!result.ok) return;
    expect(result.bannedUntil!.getTime()).toBeLessThan(late.getTime());
    expect(result.cancelled).toEqual([]);
    const [kept] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, survivor.booking.id));
    expect(kept.status).toBe('booked');
  });

  it('never touches the member bookings of another club', async () => {
    const ctx = await seed('1w');
    const otherClub = await seed('1w');
    // Same person, seated in the other club inside the ban window.
    await db.insert(schema.memberships).values({ userId: ctx.uid, clubId: otherClub.club.id, status: 'approved' });
    const foreign = await seedFutureSeat({ ...otherClub, uid: ctx.uid }, '2026-03-12');

    await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    const [kept] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, foreign.booking.id));
    expect(kept.status).toBe('booked');
  });

  it('rejects a session that has not started', async () => {
    const ctx = await seed('1w');
    const before = zonedWallClockToUtc(MISSED_DAY, '06:00', TZ);
    expect(await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: before })).toEqual({ ok: false, error: 'not_started' });
  });

  it('rejects a waitlisted booking — it never held a seat', async () => {
    const ctx = await seed('1w');
    await db.update(schema.bookings).set({ status: 'waitlisted', queuePosition: 1 }).where(eq(schema.bookings.id, ctx.booking.id));
    expect(await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW })).toEqual({ ok: false, error: 'not_booked' });
  });

  it('rejects a second mark on the same booking', async () => {
    const ctx = await seed('1w');
    await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW })).toEqual({ ok: false, error: 'already_marked' });
  });

  it('rejects a booking belonging to another club', async () => {
    const ctx = await seed('1w');
    const other = await seed('1w');
    expect(await markNoShow(db, { clubId: other.club.id, bookingId: ctx.booking.id, now: NOW })).toEqual({ ok: false, error: 'not_found' });
  });

  it('takes the later end date when a second absence is marked during a ban', async () => {
    const ctx = await seed('1w');
    // Mark the LATER session (12 Mar) first, so its own end date (19 Mar) is
    // already the standing ban. Then mark the EARLIER session (10 Mar), whose
    // own end date (17 Mar) is less than the standing ban. If recomputeBan
    // used only the newly-marked penalty's own end date instead of folding
    // over every row, this would regress to 17 Mar.
    const second = await seedFutureSeat(ctx, '2026-03-12');
    const firstNow = zonedWallClockToUtc('2026-03-12', '20:00', TZ);
    const firstResult = await markNoShow(db, { clubId: ctx.club.id, bookingId: second.booking.id, now: firstNow });
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) return;
    expect(firstResult.bannedUntil).toEqual(zonedWallClockToUtc('2026-03-19', '07:00', TZ));

    const later = zonedWallClockToUtc('2026-03-13', '20:00', TZ);
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: later });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // max(10 Mar + 7d = 17 Mar, standing ban 19 Mar) = 19 Mar — the standing
    // ban must survive even though the just-marked penalty's own end is earlier.
    expect(result.bannedUntil).toEqual(zonedWallClockToUtc('2026-03-19', '07:00', TZ));
  });

  it('leaves a rejected membership rejected — a ban never resurrects it to approved, and a never-policy absence never bans it', async () => {
    const tag = `att-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ, noshowPenalty: 'never' }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 2, allowedPayment: 'both' }).returning();
    const uid = `${tag}-u`;
    await db.insert(schema.user).values({ id: uid, name: 'Ali', email: `${uid}@t.co` });
    const [membership] = await db.insert(schema.memberships).values({ userId: uid, clubId: club.id, status: 'rejected' }).returning();
    const [slot] = await db.insert(schema.slots).values({ clubId: club.id, date: MISSED_DAY, startAt: MISSED_START, endAt: zonedWallClockToUtc(MISSED_DAY, '08:00', TZ) }).returning();
    const [session] = await db.insert(schema.sessions).values({ slotId: slot.id, clubId: club.id, boatTypeId: boat.id, capacity: 2 }).returning();
    const [booking] = await db.insert(schema.bookings).values({ sessionId: session.id, clubId: club.id, userId: uid, paymentType: 'regular', status: 'booked', effectiveAt: MISSED_START, bookingDate: MISSED_DAY }).returning();

    const result = await markNoShow(db, { clubId: club.id, bookingId: booking.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.permanent).toBe(true);

    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, membership.id));
    expect(m.status).toBe('rejected');
  });
});
