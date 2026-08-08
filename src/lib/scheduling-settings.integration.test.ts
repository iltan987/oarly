import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { bookSeat } from './booking';
import { zonedWallClockToUtc } from './date-tz';
import { getSchedulingSettings, updateSchedulingSettings } from './scheduling-settings';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
// 2026-07-27 is a Monday; window is Monday 08:00-09:00 local.
const MON = '2026-07-27';
const START = zonedWallClockToUtc(MON, '08:00', TZ);
const NOW = new Date(START.getTime() - 24 * 60 * 60 * 1000);

const fullSettings = {
  bookingOpenMode: 'always' as const,
  bookingOpenLeadDays: null,
  selfCancelEnabled: true,
  cancelCutoffHours: null,
  noshowPenalty: 'off' as const,
  multisportMode: 'equal' as const,
  openOnHolidays: false,
  waitlistCapacity: null,
};

describe.skipIf(!url)('scheduling-settings', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}-${seq++}`, name: tag, status: 'active' }).returning();
    return c;
  }

  async function boatsFor(clubId: string) {
    return db.select({ id: schema.boatTypes.id, name: schema.boatTypes.name, allowedPayment: schema.boatTypes.allowedPayment })
      .from(schema.boatTypes)
      .where(eq(schema.boatTypes.clubId, clubId));
  }

  async function insertBoat(clubId: string, allowedPayment: 'regular_only' | 'multisport_only' | 'both', name = 'Boat') {
    const [b] = await db.insert(schema.boatTypes).values({ clubId, name, seats: 4, allowedPayment }).returning();
    return b;
  }

  it('persists and reads back all seven fields', async () => {
    const c = await newClub('set-rw');
    const r = await updateSchedulingSettings(db, c.id, { ...fullSettings, bookingOpenMode: 'lead', bookingOpenLeadDays: 3, selfCancelEnabled: false, cancelCutoffHours: 8, noshowPenalty: '1w', multisportMode: 'priority', multisportEnabled: true, openOnHolidays: true, waitlistCapacity: 5 });
    expect(r).toEqual({ ok: true, convertedBoats: 0 });
    expect(await getSchedulingSettings(db, c.id)).toEqual({ bookingOpenMode: 'lead', bookingOpenLeadDays: 3, selfCancelEnabled: false, cancelCutoffHours: 8, noshowPenalty: '1w', multisportMode: 'priority', multisportEnabled: true, openOnHolidays: true, waitlistCapacity: 5 });
  });

  it('rejects lead mode without a valid lead-days count', async () => {
    const c = await newClub('set-lead');
    expect(await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'lead', bookingOpenLeadDays: null, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', multisportEnabled: true, openOnHolidays: false, waitlistCapacity: null })).toEqual({ ok: false, error: 'invalid_lead' });
  });

  it('normalizes lead days to null under always mode', async () => {
    const c = await newClub('set-null');
    await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'always', bookingOpenLeadDays: 5, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', multisportEnabled: true, openOnHolidays: false, waitlistCapacity: null });
    expect((await getSchedulingSettings(db, c.id)).bookingOpenLeadDays).toBeNull();
  });

  it('scopes updates to the owning club', async () => {
    const c1 = await newClub('set-scope1');
    const c2 = await newClub('set-scope2');
    await updateSchedulingSettings(db, c1.id, { bookingOpenMode: 'always', bookingOpenLeadDays: null, selfCancelEnabled: false, cancelCutoffHours: null, noshowPenalty: '1m', multisportMode: 'equal', multisportEnabled: true, openOnHolidays: false, waitlistCapacity: null });
    // c2 is untouched — still its defaults
    const [row] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c2.id));
    expect(row.noshowPenalty).toBe('off');
    expect(row.selfCancelEnabled).toBe(true);
  });

  it('round-trips the waitlist capacity', async () => {
    const c = await newClub('set-waitlist');
    await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'always', bookingOpenLeadDays: null, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', multisportEnabled: true, openOnHolidays: false, waitlistCapacity: 4 });
    expect((await getSchedulingSettings(db, c.id)).waitlistCapacity).toBe(4);
    await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'always', bookingOpenLeadDays: null, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', multisportEnabled: true, openOnHolidays: false, waitlistCapacity: null });
    expect((await getSchedulingSettings(db, c.id)).waitlistCapacity).toBeNull();
  });

  describe('disabling MultiSport repairs the boat invariant', () => {
    it('converts only the multisport_only boats, leaving both and regular_only alone', async () => {
      const c = await newClub('convert-a');
      const ms = await insertBoat(c.id, 'multisport_only', 'MS');
      const both = await insertBoat(c.id, 'both', 'Both');
      const reg = await insertBoat(c.id, 'regular_only', 'Reg');

      const r = await updateSchedulingSettings(db, c.id, { ...fullSettings, multisportEnabled: false });
      expect(r).toEqual({ ok: true, convertedBoats: 1 });

      const byId = Object.fromEntries((await boatsFor(c.id)).map((b) => [b.id, b.allowedPayment]));
      expect(byId[ms.id]).toBe('regular_only');
      expect(byId[both.id]).toBe('both');
      expect(byId[reg.id]).toBe('regular_only');
    });

    it('does not touch another club\'s multisport_only boats', async () => {
      const c1 = await newClub('convert-b1');
      const c2 = await newClub('convert-b2');
      const untouched = await insertBoat(c2.id, 'multisport_only', 'MS');
      await insertBoat(c1.id, 'multisport_only', 'MS');

      await updateSchedulingSettings(db, c1.id, { ...fullSettings, multisportEnabled: false });

      const byId = Object.fromEntries((await boatsFor(c2.id)).map((b) => [b.id, b.allowedPayment]));
      expect(byId[untouched.id]).toBe('multisport_only');
    });

    it('does not convert boats back on re-enabling', async () => {
      const c = await newClub('convert-c');
      const ms = await insertBoat(c.id, 'multisport_only', 'MS');

      await updateSchedulingSettings(db, c.id, { ...fullSettings, multisportEnabled: false });
      const r = await updateSchedulingSettings(db, c.id, { ...fullSettings, multisportEnabled: true });
      expect(r).toEqual({ ok: true, convertedBoats: 0 });

      const byId = Object.fromEntries((await boatsFor(c.id)).map((b) => [b.id, b.allowedPayment]));
      expect(byId[ms.id]).toBe('regular_only');
    });

    it('leaves a club with converted boats still bookable with cash', async () => {
      const c = await newClub('convert-d');
      const boat = await insertBoat(c.id, 'multisport_only', 'MS');
      await updateSchedulingSettings(db, c.id, { ...fullSettings, multisportEnabled: false });

      const [w] = await db.insert(schema.scheduleWindows).values({ clubId: c.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60 }).returning();
      await db.insert(schema.windowBoats).values({ windowId: w.id, boatTypeId: boat.id, quantity: 1 });
      const uid = `convert-d-${Date.now()}-${seq++}`;
      await db.insert(schema.user).values({ id: uid, name: uid, email: `${uid}@t.co` });
      await db.insert(schema.memberships).values({ userId: uid, clubId: c.id, role: 'member', status: 'approved' });

      const result = await bookSeat(db, {
        clubId: c.id, userId: uid, windowId: w.id, boatTypeId: boat.id, startAt: START,
        paymentType: 'regular', idempotencyKey: `convert-d-key-${Date.now()}-${seq++}`, now: NOW,
      });
      expect(result).toMatchObject({ ok: true, outcome: 'seated' });
    });
  });
});
