import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email';

import { decideClubRequest } from './clubs-admin';
import { zonedWallClockToUtc } from './date-tz';
import { notifyBookingCancellation, notifyBookingConfirmation, notifyClubDecision, notifyOwnerRemoval, notifyPenaltyLift, notifyWaitlistPromotion } from './notify';

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
    // randomUUID, not a timestamp: both Date.now() and Math.floor(performance.now())
    // are millisecond-resolution, so two calls inside one millisecond produced an
    // identical id. It survived locally because each call awaits a round trip; CI is
    // fast enough to collide, and did — `duplicate key value violates user_pkey`.
    const id = `u-${randomUUID()}`;
    await db.insert(schema.user).values({ id, name: 'X', email: `${id}@t.co` });
    return { id, email: `${id}@t.co` };
  }

  // Seed a single booking + its session/slot/club/boat/user directly (no bookSeat needed).
  async function seedBooking(status: 'booked' | 'waitlisted' | 'cancelled', queuePosition: number | null = null) {
    const tag = `ntf-${randomUUID()}`;
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
      .values({ slug: `nd-${randomUUID()}`, name: 'Notify Club', status: 'rejected', createdBy: requester.id }).returning();
    await expect(notifyClubDecision(db, { clubId: club.id, decision: 'rejected', note: 'because' })).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: requester.email });
  });

  it('is a no-op when the club has no requester on record', async () => {
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `nr-${randomUUID()}`, name: 'Orphan', status: 'active', createdBy: null }).returning();
    await expect(notifyClubDecision(db, { clubId: club.id, decision: 'approved', note: null })).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('leaves a real decision committed and reports success even when the mailer fails', async () => {
    // Mirrors how Task 9's action calls these: decideClubRequest commits first,
    // notifyClubDecision runs after and must not be able to undo it.
    const admin = await mkUser();
    const requester = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `ndf-${randomUUID()}`, name: 'Flaky Mail Club', status: 'pending', createdBy: requester.id }).returning();

    const decided = await decideClubRequest(db, { clubId: club.id, decision: 'approve', note: null, actorId: admin.id });
    expect(decided).toMatchObject({ ok: true, status: 'active' });

    sendMock.mockRejectedValueOnce(new Error('resend down'));
    await expect(notifyClubDecision(db, { clubId: club.id, decision: 'approved', note: null })).resolves.toBeUndefined();

    const [row] = await db.select({ status: schema.clubs.status }).from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(row.status).toBe('active');
  });

  /**
   * The lift notice, which is keyed on a MEMBERSHIP rather than on a booking — the
   * suspension it reverses is a fact about the membership, and the session behind it may
   * be months gone. So this is the one notify helper `loadCtx` cannot serve, and these
   * tests exist to check the join it uses instead.
   */
  describe('notifyPenaltyLift', () => {
    async function seedMembership(locale?: string) {
      const t = `lift-${randomUUID()}`;
      const [club] = await db.insert(schema.clubs)
        .values({ slug: t, name: `Club ${t}`, status: 'active', timezone: TZ }).returning();
      const id = `${t}-u`;
      await db.insert(schema.user).values({ id, name: 'Rower', email: `${id}@t.co`, ...(locale ? { locale } : {}) });
      const [membership] = await db.insert(schema.memberships)
        .values({ userId: id, clubId: club.id, status: 'approved' }).returning();
      return { club, membership, email: `${id}@t.co` };
    }

    it('sends one email to the member, naming the club', async () => {
      const s = await seedMembership();
      await notifyPenaltyLift(db, { membershipId: s.membership.id });
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock.mock.calls[0][0]).toMatchObject({ to: s.email });
      // The club row is the only context this mail carries, so an unnamed club would
      // leave a member of two clubs unable to tell which one reinstated them.
      expect(sendMock.mock.calls[0][0].html).toContain(s.club.name);
    });

    /**
     * The member's OWN locale, read off the user row — not the club's and not a default.
     * Asserted on the rendered subject rather than on an argument, because the locale is
     * resolved inside `renderPenaltyLift` and a helper that read the wrong column would
     * still pass an "it was called with a string" check.
     */
    it('renders in the member\'s locale', async () => {
      const en = await seedMembership('en');
      await notifyPenaltyLift(db, { membershipId: en.membership.id });
      expect(sendMock.mock.calls[0][0].subject).toBe('Oarly — Your booking access has reopened');

      sendMock.mockReset();
      const tr = await seedMembership('tr');
      await notifyPenaltyLift(db, { membershipId: tr.membership.id });
      expect(sendMock.mock.calls[0][0].subject).toBe('Oarly — Rezervasyon erişiminiz yeniden açıldı');
    });

    it('is a no-op for a membership that no longer exists', async () => {
      await expect(notifyPenaltyLift(db, { membershipId: randomUUID() })).resolves.toBeUndefined();
      expect(sendMock).not.toHaveBeenCalled();
    });

    /**
     * Best-effort, like every other helper in this file: the lift has already COMMITTED by
     * the time the action calls this from `after()`, so a mailer outage must cost the
     * member their notice and never their reinstatement.
     */
    it('never throws when sendEmail fails', async () => {
      const s = await seedMembership();
      sendMock.mockRejectedValueOnce(new Error('resend down'));
      await expect(notifyPenaltyLift(db, { membershipId: s.membership.id })).resolves.toBeUndefined();
    });
  });
});
