import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email';

import { decideClubRequest } from './clubs-admin';
import { zonedWallClockToUtc } from './date-tz';
import { notifyBookingCancellation, notifyBookingConfirmation, notifyClubDecision, notifyOwnerRemoval, notifyWaitlistPromotion } from './notify';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));
const sendMock = vi.mocked(sendEmail);

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
const MON = '2026-07-20';
const START = zonedWallClockToUtc(MON, '08:00', TZ);
const END = zonedWallClockToUtc(MON, '09:00', TZ);

describe.skipIf(!url)('notify', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });
  beforeEach(() => { sendMock.mockReset(); });

  async function mkUser() {
    const id = `u-${Date.now()}-${Math.floor(performance.now())}`;
    await db.insert(schema.user).values({ id, name: 'X', email: `${id}@t.co` });
    return { id, email: `${id}@t.co` };
  }

  let seq = 0;
  // Seed a single booking + its session/slot/club/boat/user directly (no bookSeat needed).
  async function seedBooking(status: 'booked' | 'waitlisted' | 'cancelled', queuePosition: number | null = null) {
    const tag = `ntf-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: `Club ${tag}`, status: 'active', timezone: TZ }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 2, allowedPayment: 'both' }).returning();
    const [slot] = await db.insert(schema.slots).values({ clubId: club.id, date: MON, startAt: START, endAt: END }).returning();
    const [session] = await db.insert(schema.sessions).values({ slotId: slot.id, clubId: club.id, boatTypeId: boat.id, capacity: 2 }).returning();
    const uid = `${tag}-u`;
    await db.insert(schema.user).values({ id: uid, name: 'Rower', email: `${uid}@t.co` });
    const [booking] = await db.insert(schema.bookings).values({ sessionId: session.id, clubId: club.id, userId: uid, paymentType: 'regular', status, queuePosition, effectiveAt: START, bookingDate: MON }).returning();
    return { club, session, uid, booking, email: `${uid}@t.co` };
  }

  it('confirmation sends one email to the member and writes NO notifications row', async () => {
    const s = await seedBooking('booked');
    await notifyBookingConfirmation(db, { bookingId: s.booking.id });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: s.email });
    const logs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, s.uid));
    expect(logs).toHaveLength(0);
  });

  it('cancellation sends one email and writes NO notifications row', async () => {
    const s = await seedBooking('cancelled');
    await notifyBookingCancellation(db, { bookingId: s.booking.id });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const logs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, s.uid));
    expect(logs).toHaveLength(0);
  });

  it('owner-removal sends one email and writes NO notifications row', async () => {
    const s = await seedBooking('cancelled');
    await notifyOwnerRemoval(db, { bookingId: s.booking.id });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: s.email });
    const logs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, s.uid));
    expect(logs).toHaveLength(0);
  });

  it('promotion sends once and is idempotent (second call is a no-op)', async () => {
    const s = await seedBooking('booked');
    await notifyWaitlistPromotion(db, { userId: s.uid, sessionId: s.session.id });
    await notifyWaitlistPromotion(db, { userId: s.uid, sessionId: s.session.id });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const logs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, s.uid));
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe('waitlist_promotion');
  });

  it('never throws when sendEmail fails', async () => {
    const s = await seedBooking('booked');
    sendMock.mockRejectedValueOnce(new Error('resend down'));
    await expect(notifyBookingConfirmation(db, { bookingId: s.booking.id })).resolves.toBeUndefined();
  });

  it('sends the decision notice to the club requester and never throws', async () => {
    const requester = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `nd-${Date.now()}`, name: 'Notify Club', status: 'rejected', createdBy: requester.id }).returning();
    await expect(notifyClubDecision(db, { clubId: club.id, decision: 'rejected', note: 'because' })).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: requester.email });
  });

  it('is a no-op when the club has no requester on record', async () => {
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `nr-${Date.now()}`, name: 'Orphan', status: 'active', createdBy: null }).returning();
    await expect(notifyClubDecision(db, { clubId: club.id, decision: 'approved', note: null })).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('leaves a real decision committed and reports success even when the mailer fails', async () => {
    // Mirrors how Task 9's action calls these: decideClubRequest commits first,
    // notifyClubDecision runs after and must not be able to undo it.
    const admin = await mkUser();
    const requester = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `ndf-${Date.now()}`, name: 'Flaky Mail Club', status: 'pending', createdBy: requester.id }).returning();

    const decided = await decideClubRequest(db, { clubId: club.id, decision: 'approve', note: null, actorId: admin.id });
    expect(decided).toMatchObject({ ok: true, status: 'active' });

    sendMock.mockRejectedValueOnce(new Error('resend down'));
    await expect(notifyClubDecision(db, { clubId: club.id, decision: 'approved', note: null })).resolves.toBeUndefined();

    const [row] = await db.select({ status: schema.clubs.status }).from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(row.status).toBe('active');
  });
});
