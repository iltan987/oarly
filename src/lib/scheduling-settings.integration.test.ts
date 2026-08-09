import { randomUUID } from 'node:crypto';

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
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); actor = await newUser(); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  let actor: string;
  async function newUser() {
    const id = `sset-u-${Date.now()}-${seq++}`;
    await db.insert(schema.user).values({ id, name: 'O', email: `${id}@t.co` });
    return id;
  }
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

  it('persists and reads back all nine fields', async () => {
    const c = await newClub('set-rw');
    const r = await updateSchedulingSettings(db, c.id, { ...fullSettings, bookingOpenMode: 'lead', bookingOpenLeadDays: 3, selfCancelEnabled: false, cancelCutoffHours: 8, noshowPenalty: '1w', multisportMode: 'priority', multisportEnabled: true, openOnHolidays: true, waitlistCapacity: 5 }, actor);
    expect(r).toEqual({ ok: true, convertedBoats: 0 });
    expect(await getSchedulingSettings(db, c.id)).toEqual({ bookingOpenMode: 'lead', bookingOpenLeadDays: 3, selfCancelEnabled: false, cancelCutoffHours: 8, noshowPenalty: '1w', multisportMode: 'priority', multisportEnabled: true, openOnHolidays: true, waitlistCapacity: 5 });
  });

  it('rejects lead mode without a valid lead-days count', async () => {
    const c = await newClub('set-lead');
    expect(await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'lead', bookingOpenLeadDays: null, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', multisportEnabled: true, openOnHolidays: false, waitlistCapacity: null }, actor)).toEqual({ ok: false, error: 'invalid_lead' });
  });

  it('normalizes lead days to null under always mode', async () => {
    const c = await newClub('set-null');
    await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'always', bookingOpenLeadDays: 5, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', multisportEnabled: true, openOnHolidays: false, waitlistCapacity: null }, actor);
    expect((await getSchedulingSettings(db, c.id)).bookingOpenLeadDays).toBeNull();
  });

  it('scopes updates to the owning club', async () => {
    const c1 = await newClub('set-scope1');
    const c2 = await newClub('set-scope2');
    await updateSchedulingSettings(db, c1.id, { bookingOpenMode: 'always', bookingOpenLeadDays: null, selfCancelEnabled: false, cancelCutoffHours: null, noshowPenalty: '1m', multisportMode: 'equal', multisportEnabled: true, openOnHolidays: false, waitlistCapacity: null }, actor);
    // c2 is untouched — still its defaults
    const [row] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c2.id));
    expect(row.noshowPenalty).toBe('off');
    expect(row.selfCancelEnabled).toBe(true);
  });

  it('round-trips the waitlist capacity', async () => {
    const c = await newClub('set-waitlist');
    await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'always', bookingOpenLeadDays: null, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', multisportEnabled: true, openOnHolidays: false, waitlistCapacity: 4 }, actor);
    expect((await getSchedulingSettings(db, c.id)).waitlistCapacity).toBe(4);
    await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'always', bookingOpenLeadDays: null, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', multisportEnabled: true, openOnHolidays: false, waitlistCapacity: null }, actor);
    expect((await getSchedulingSettings(db, c.id)).waitlistCapacity).toBeNull();
  });

  it('audits club.policies_update against the club itself', async () => {
    const c = await newClub('set-audit');
    const owner = await newUser();
    expect(await updateSchedulingSettings(db, c.id, { ...fullSettings, multisportEnabled: true }, owner)).toEqual({ ok: true, convertedBoats: 0 });
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, c.id));
    expect(rows.map((a) => a.action)).toEqual(['club.policies_update']);
    expect(rows[0].target).toBe(c.id);
    expect(rows[0].actorUserId).toBe(owner);
    expect(rows[0].actingAsRole).toBe('owner');
  });

  it('writes no audit row when the input is rejected', async () => {
    const c = await newClub('set-audit-invalid');
    const owner = await newUser();
    expect(await updateSchedulingSettings(db, c.id, { ...fullSettings, multisportEnabled: true, bookingOpenMode: 'lead', bookingOpenLeadDays: null }, owner))
      .toEqual({ ok: false, error: 'invalid_lead' });
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, c.id))).toHaveLength(0);
  });

  // The probe is a genuine FK violation on audit_log.actor_user_id raised INSIDE the
  // transaction. Asserting the settings are unchanged (rather than merely that a row
  // exists) is what catches an audit insert that has drifted outside the transaction.
  it('rolls the settings change back when the audit insert fails', async () => {
    const c = await newClub('set-atomic');
    await expect(updateSchedulingSettings(db, c.id, { ...fullSettings, multisportEnabled: true, noshowPenalty: '1w' }, 'no-such-user'))
      .rejects.toThrow();
    const [row] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.id));
    expect(row.noshowPenalty).toBe('off');
  });

  // Pins the behaviour change the audit row introduced: before it, an unknown
  // clubId updated nothing and still returned { ok: true }. Now audit_log.club_id's
  // FK to clubs.id fails inside the transaction, so the call throws and writes
  // nothing. Unreachable via requireOwner, but a caller that reaches it should
  // learn this from the suite rather than from an unhandled rejection.
  it('throws, and writes no audit row, for a clubId that matches no club', async () => {
    const owner = await newUser();
    const ghost = randomUUID();
    // Matched on audit_log specifically: asserting only "it throws" would still pass
    // if it started failing for some unrelated reason, which would quietly stop
    // testing the FK that makes the rollback safe.
    await expect(updateSchedulingSettings(db, ghost, { ...fullSettings, multisportEnabled: true }, owner)).rejects.toThrow(/audit_log/);
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, ghost))).toHaveLength(0);
  });

  describe('disabling MultiSport repairs the boat invariant', () => {
    it('converts only the multisport_only boats, leaving both and regular_only alone', async () => {
      const c = await newClub('convert-a');
      const ms = await insertBoat(c.id, 'multisport_only', 'MS');
      const both = await insertBoat(c.id, 'both', 'Both');
      const reg = await insertBoat(c.id, 'regular_only', 'Reg');

      const r = await updateSchedulingSettings(db, c.id, { ...fullSettings, multisportEnabled: false }, actor);
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

      await updateSchedulingSettings(db, c1.id, { ...fullSettings, multisportEnabled: false }, actor);

      const byId = Object.fromEntries((await boatsFor(c2.id)).map((b) => [b.id, b.allowedPayment]));
      expect(byId[untouched.id]).toBe('multisport_only');
    });

    it('does not convert boats back on re-enabling', async () => {
      const c = await newClub('convert-c');
      const ms = await insertBoat(c.id, 'multisport_only', 'MS');

      await updateSchedulingSettings(db, c.id, { ...fullSettings, multisportEnabled: false }, actor);
      const r = await updateSchedulingSettings(db, c.id, { ...fullSettings, multisportEnabled: true }, actor);
      expect(r).toEqual({ ok: true, convertedBoats: 0 });

      const byId = Object.fromEntries((await boatsFor(c.id)).map((b) => [b.id, b.allowedPayment]));
      expect(byId[ms.id]).toBe('regular_only');
    });

    it('leaves a club with converted boats still bookable with cash', async () => {
      const c = await newClub('convert-d');
      const boat = await insertBoat(c.id, 'multisport_only', 'MS');
      await updateSchedulingSettings(db, c.id, { ...fullSettings, multisportEnabled: false }, actor);

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
