import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { markNoShow, undoNoShow } from './attendance';
import { ownerAddBooking } from './booking';
import { utcToClubDate, zonedWallClockToUtc } from './date-tz';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
// Frozen clock: the missed session is in the past, "now" is the evening after it.
const MISSED_DAY = '2026-03-10';
const MISSED_START = zonedWallClockToUtc(MISSED_DAY, '07:00', TZ);
const NOW = zonedWallClockToUtc(MISSED_DAY, '20:00', TZ);

describe.skipIf(!url)('markNoShow', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  /** The owner every mutation below is attributed to — `audit_log.actor_user_id` is a real FK. */
  let ownerId: string;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
    ownerId = `att-owner-${Date.now()}`;
    await db.insert(schema.user).values({ id: ownerId, name: 'Owner', email: `${ownerId}@t.co` });
  });
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

  /**
   * Give the club a scheduleWindow matching the missed session's own weekday and
   * time block, so `ownerAddBooking`'s `findOrCreateSlotTx` targets the SAME slot
   * (and hence the same session) `seed` already created, instead of materializing
   * a fresh one.
   */
  async function seedWindow(ctx: Awaited<ReturnType<typeof seed>>) {
    const { weekday } = utcToClubDate(MISSED_START, TZ);
    const [w] = await db.insert(schema.scheduleWindows).values({ clubId: ctx.club.id, weekday, startTime: '07:00', endTime: '08:00', defaultSessionMinutes: 60 }).returning();
    await db.insert(schema.windowBoats).values({ windowId: w.id, boatTypeId: ctx.boat.id, quantity: 1 });
    return w.id;
  }

  /** A second approved member of the same club, for filling/re-seating a session. */
  async function seedMember(ctx: Awaited<ReturnType<typeof seed>>, tag: string) {
    const uid = `${tag}-${Date.now()}-${seq++}`;
    await db.insert(schema.user).values({ id: uid, name: uid, email: `${uid}@t.co` });
    await db.insert(schema.memberships).values({ userId: uid, clubId: ctx.club.id, status: 'approved' });
    return uid;
  }

  it('marks the booking, writes a penalty and bans until session start + policy', async () => {
    const ctx = await seed('1w');
    const result = await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
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
    const result = await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
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
    const result = await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
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

    const result = await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
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
    const result = await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cancelled).toEqual([]);
    const [kept] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, later.booking.id));
    expect(kept.status).toBe('booked');
  });

  it('cancels every future seat when the ban is permanent', async () => {
    const ctx = await seed('never');
    const far = await seedFutureSeat(ctx, '2027-01-05');
    const result = await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
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
    const result = await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: late });
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

    await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    const [kept] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, foreign.booking.id));
    expect(kept.status).toBe('booked');
  });

  it('rejects a session that has not started', async () => {
    const ctx = await seed('1w');
    const before = zonedWallClockToUtc(MISSED_DAY, '06:00', TZ);
    expect(await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: before })).toEqual({ ok: false, error: 'not_started' });
  });

  it('rejects a waitlisted booking — it never held a seat', async () => {
    const ctx = await seed('1w');
    await db.update(schema.bookings).set({ status: 'waitlisted', queuePosition: 1 }).where(eq(schema.bookings.id, ctx.booking.id));
    expect(await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW })).toEqual({ ok: false, error: 'not_booked' });
  });

  it('rejects a second mark on the same booking', async () => {
    const ctx = await seed('1w');
    await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW })).toEqual({ ok: false, error: 'already_marked' });
  });

  it('rejects a booking belonging to another club', async () => {
    const ctx = await seed('1w');
    const other = await seed('1w');
    expect(await markNoShow(db, { actorId: ownerId, clubId: other.club.id, bookingId: ctx.booking.id, now: NOW })).toEqual({ ok: false, error: 'not_found' });
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
    const firstResult = await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: second.booking.id, now: firstNow });
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) return;
    expect(firstResult.bannedUntil).toEqual(zonedWallClockToUtc('2026-03-19', '07:00', TZ));

    const later = zonedWallClockToUtc('2026-03-13', '20:00', TZ);
    const result = await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: later });
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

    const result = await markNoShow(db, { actorId: ownerId, clubId: club.id, bookingId: booking.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.permanent).toBe(true);

    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, membership.id));
    expect(m.status).toBe('rejected');
  });

  it('audits attendance.noshow and attendance.noshow_undo', async () => {
    const ctx = await seed('1w');

    const marked = await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(marked.ok).toBe(true);
    const afterMark = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, ctx.booking.id));
    expect(afterMark.map((a) => a.action)).toContain('attendance.noshow');
    expect(afterMark[0].actingAsRole).toBe('owner');
    expect(afterMark[0].actorUserId).toBe(ownerId);
    expect(afterMark[0].clubId).toBe(ctx.club.id);

    const undone = await undoNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id });
    expect(undone.ok).toBe(true);
    const afterUndo = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, ctx.booking.id));
    expect(afterUndo.map((a) => a.action).sort()).toEqual(['attendance.noshow', 'attendance.noshow_undo']);
  });

  it('rolls the absence back when the audit insert fails', async () => {
    const ctx = await seed('1w');
    await expect(markNoShow(db, { actorId: 'no-such-user', clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW }))
      .rejects.toThrow();
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, ctx.booking.id));
    expect(booking.status).toBe('booked');
    const penalties = await db.select().from(schema.penalties).where(eq(schema.penalties.bookingId, ctx.booking.id));
    expect(penalties).toHaveLength(0);
  });

  it('rolls the undo back when the audit insert fails', async () => {
    const ctx = await seed('1w');
    await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    await expect(undoNoShow(db, { actorId: 'no-such-user', clubId: ctx.club.id, bookingId: ctx.booking.id }))
      .rejects.toThrow();
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, ctx.booking.id));
    expect(booking.status).toBe('no_show');
    const penalties = await db.select().from(schema.penalties).where(eq(schema.penalties.bookingId, ctx.booking.id));
    expect(penalties).toHaveLength(1);
  });

  it('writes no audit row when the booking was already marked', async () => {
    const ctx = await seed('1w');
    await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    const before = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, ctx.booking.id));
    expect(await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW }))
      .toMatchObject({ ok: false, error: 'already_marked' });
    const after = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, ctx.booking.id));
    expect(after).toHaveLength(before.length);
  });

  describe.skipIf(!url)('undoNoShow', () => {
    it('restores the booking, deletes the penalty and lifts the ban', async () => {
      const ctx = await seed('1w');
      await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });

      const result = await undoNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id });
      expect(result).toEqual({ ok: true, bannedUntil: null, permanent: false });

      const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, ctx.booking.id));
      expect(booking.status).toBe('booked');
      const rows = await db.select().from(schema.penalties).where(eq(schema.penalties.bookingId, ctx.booking.id));
      expect(rows).toEqual([]);
      const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, ctx.membership.id));
      expect(m.bannedUntil).toBeNull();
    });

    it('keeps the ban alive when another absence still stands', async () => {
      const ctx = await seed('1w');
      await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
      const second = await seedFutureSeat(ctx, '2026-03-12');
      const later = zonedWallClockToUtc('2026-03-13', '20:00', TZ);
      await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: second.booking.id, now: later });

      // Undo the FIRST absence; the second still bans until 12 Mar + 7d = 19 Mar.
      const result = await undoNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.bannedUntil).toEqual(zonedWallClockToUtc('2026-03-19', '07:00', TZ));
    });

    it('lifts a permanent ban back to approved', async () => {
      const ctx = await seed('never');
      await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
      const result = await undoNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id });
      expect(result).toMatchObject({ ok: true, permanent: false });
      const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, ctx.membership.id));
      expect(m.status).toBe('approved');
    });

    it('does not restore the seats the cascade cancelled', async () => {
      const ctx = await seed('1w');
      const future = await seedFutureSeat(ctx, '2026-03-12');
      await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
      await undoNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id });

      const [still] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, future.booking.id));
      expect(still.status).toBe('cancelled');
    });

    it('rejects a booking that was never marked', async () => {
      const ctx = await seed('1w');
      expect(await undoNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id })).toEqual({ ok: false, error: 'not_marked' });
    });

    it('rejects a booking belonging to another club', async () => {
      const ctx = await seed('1w');
      const other = await seed('1w');
      await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
      expect(await undoNoShow(db, { actorId: ownerId, clubId: other.club.id, bookingId: ctx.booking.id })).toEqual({ ok: false, error: 'not_found' });
    });

    it('reports a restore conflict when a multisport seat was taken on the freed day', async () => {
      const ctx = await seed('1w');
      // The missed booking must be a MultiSport seat: only `multisport` rows are
      // covered by `bookings_multisport_day_uq`.
      await db.update(schema.bookings).set({ paymentType: 'multisport' }).where(eq(schema.bookings.id, ctx.booking.id));

      // Marking it absent flips status to `no_show`, which falls outside the
      // index's `status in ('booked', 'waitlisted')` predicate — the day is now
      // free again as far as the unique index is concerned.
      await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });

      // The member legitimately takes another MultiSport seat the SAME
      // club-local day, on a different session, while the first sits marked absent.
      const [slot2] = await db.insert(schema.slots).values({ clubId: ctx.club.id, date: MISSED_DAY, startAt: zonedWallClockToUtc(MISSED_DAY, '09:00', TZ), endAt: zonedWallClockToUtc(MISSED_DAY, '10:00', TZ) }).returning();
      const [session2] = await db.insert(schema.sessions).values({ slotId: slot2.id, clubId: ctx.club.id, boatTypeId: ctx.boat.id, capacity: 2 }).returning();
      await db.insert(schema.bookings).values({ sessionId: session2.id, clubId: ctx.club.id, userId: ctx.uid, paymentType: 'multisport', status: 'booked', effectiveAt: NOW, bookingDate: MISSED_DAY });

      // Undo tries to put the first booking back into the predicate — colliding
      // with the second, which now legitimately occupies that (user, day) key.
      const result = await undoNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id });
      expect(result).toEqual({ ok: false, error: 'restore_conflict' });
    });

    it('gates the restore when the owner has already seated someone else into the freed seat', async () => {
      // Capacity 2, A + B booked.
      const ctx = await seed('1w');
      const windowId = await seedWindow(ctx);
      const bUid = await seedMember(ctx, 'att-b');
      await db.insert(schema.bookings).values({ sessionId: ctx.session.id, clubId: ctx.club.id, userId: bUid, paymentType: 'regular', status: 'booked', effectiveAt: MISSED_START, bookingDate: MISSED_DAY });
      const cUid = await seedMember(ctx, 'att-c');

      // Mark A absent — the seat is now open (freeSeats counts only 'booked').
      await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });

      // Owner seats a walk-in (C) into the freed seat.
      const added = await ownerAddBooking(db, { actorId: ownerId, clubId: ctx.club.id, windowId, boatTypeId: ctx.boat.id, startAt: MISSED_START, userId: cUid, paymentType: 'regular', now: NOW });
      expect(added.ok).toBe(true);

      // Undoing A's absence must not push the session to 3 booked in a 2-seat boat.
      const result = await undoNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id });
      expect(result).toEqual({ ok: false, error: 'restore_conflict' });

      const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.sessionId, ctx.session.id));
      expect(rows.filter((r) => r.status === 'booked')).toHaveLength(2);
    });

    it('gates the restore, instead of throwing, when the owner re-seats the same member', async () => {
      // 'off' policy: no ban is imposed, so `ownerAddBooking`'s not-banned gate
      // does not itself stop the re-add — reproducing Finding 1's symptom B,
      // which is exactly the case a standing ban would otherwise mask.
      const ctx = await seed('off');
      const windowId = await seedWindow(ctx);

      // Mark A absent, then the owner re-seats A into a NEW row ("sorry, wrong row").
      // The one-booking-per-slot check in `ownerAddBooking` filters on active
      // statuses, so the `no_show` row does not block the re-add.
      await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
      const added = await ownerAddBooking(db, { actorId: ownerId, clubId: ctx.club.id, windowId, boatTypeId: ctx.boat.id, startAt: MISSED_START, userId: ctx.uid, paymentType: 'regular', now: NOW });
      expect(added.ok).toBe(true);

      // Undoing the original absence would collide with the new row on
      // `bookings_active_uq` — this must come back as a typed failure, not a throw.
      const result = await undoNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id });
      expect(result).toEqual({ ok: false, error: 'restore_conflict' });
    });

    it('still restores the seat when it has remained free (guard against over-correcting)', async () => {
      const ctx = await seed('1w');
      await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
      const result = await undoNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id });
      expect(result).toEqual({ ok: true, bannedUntil: null, permanent: false });
      const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, ctx.booking.id));
      expect(booking.status).toBe('booked');
    });

    it('restores a freed seat even when the session has a waitlist — capacity counts booked rows only', async () => {
      // Capacity 2, A + B booked, D waitlisted behind them.
      const ctx = await seed('1w');
      const bUid = await seedMember(ctx, 'att-b');
      await db.insert(schema.bookings).values({ sessionId: ctx.session.id, clubId: ctx.club.id, userId: bUid, paymentType: 'regular', status: 'booked', effectiveAt: MISSED_START, bookingDate: MISSED_DAY });
      const dUid = await seedMember(ctx, 'att-d');
      const [dBooking] = await db.insert(schema.bookings).values({ sessionId: ctx.session.id, clubId: ctx.club.id, userId: dUid, paymentType: 'regular', status: 'waitlisted', queuePosition: 1, effectiveAt: MISSED_START, bookingDate: MISSED_DAY }).returning();

      // Mark A absent. `markNoShow` never calls `applySeating` on the missed
      // session itself (only on the future sessions its cascade touches), so D
      // is NOT auto-promoted here — booked = {B}, waitlisted = {D}.
      await markNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });

      // The freed seat is genuinely open: `capacity` bounds booked rows only,
      // and D's waitlisted row is additional to capacity, not counted against
      // it. Undo must succeed.
      const result = await undoNoShow(db, { actorId: ownerId, clubId: ctx.club.id, bookingId: ctx.booking.id });
      expect(result).toEqual({ ok: true, bannedUntil: null, permanent: false });

      const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.sessionId, ctx.session.id));
      expect(rows.filter((r) => r.status === 'booked')).toHaveLength(2);
      const [d] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, dBooking.id));
      expect(d.status).toBe('waitlisted');
      expect(d.queuePosition).toBe(1);
    });
  });
});
