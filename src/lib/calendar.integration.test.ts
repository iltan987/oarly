import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { computeCalendar } from './calendar';
import { setDateOverride } from './date-overrides';
import { materializeSlot } from './materialize';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('computeCalendar', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string, openOnHolidays = false) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active', timezone: 'Europe/Istanbul', openOnHolidays }).returning();
    return c;
  }
  async function newBoat(clubId: string, name: string, seats: number, active = true) {
    const [b] = await db.insert(schema.boatTypes).values({ clubId, name, seats, active }).returning();
    return b;
  }
  // A Monday window 08:00-10:00 @ 60min → two blocks (08:00, 09:00).
  async function mondayWindow(clubId: string, boats: { boatTypeId: string; quantity: number }[]) {
    const [w] = await db.insert(schema.scheduleWindows).values({ clubId, weekday: 1, startTime: '08:00', endTime: '10:00', defaultSessionMinutes: 60 }).returning();
    await db.insert(schema.windowBoats).values(boats.map((b) => ({ windowId: w.id, boatTypeId: b.boatTypeId, quantity: b.quantity })));
    return w;
  }

  // 2026-07-20 is a Monday.
  it('tiles a window into blocks with correct UTC start/end and expands quantity', async () => {
    const c = await newClub('cal-a');
    const quad = await newBoat(c.id, 'Quad', 4);
    await mondayWindow(c.id, [{ boatTypeId: quad.id, quantity: 2 }]);
    const days = await computeCalendar(db, c.id, { fromDateISO: '2026-07-20', days: 1 });
    expect(days).toHaveLength(1);
    const day = days[0];
    expect(day.closed).toBe(false);
    expect(day.slots).toHaveLength(2); // 08:00 and 09:00 blocks
    expect(day.slots[0].startAt.toISOString()).toBe('2026-07-20T05:00:00.000Z'); // 08:00 Istanbul
    expect(day.slots[0].endAt.toISOString()).toBe('2026-07-20T06:00:00.000Z');
    expect(day.slots[0].sessions).toHaveLength(2); // quantity 2
    expect(day.slots[0].sessions[0].boatName).toBe('Quad');
    expect(day.slots[0].sessions[0].capacity).toBe(4);
  });

  it('excludes inactive boats from computed sessions', async () => {
    const c = await newClub('cal-inactive');
    const active = await newBoat(c.id, 'Quad', 4, true);
    const inactive = await newBoat(c.id, 'Old', 2, false);
    await mondayWindow(c.id, [{ boatTypeId: active.id, quantity: 1 }, { boatTypeId: inactive.id, quantity: 1 }]);
    const [day] = await computeCalendar(db, c.id, { fromDateISO: '2026-07-20', days: 1 });
    expect(day.slots[0].sessions.map((s) => s.boatName)).toEqual(['Quad']);
  });

  it('marks a date closed by an owner override with no slots', async () => {
    const c = await newClub('cal-override');
    const quad = await newBoat(c.id, 'Quad', 4);
    await mondayWindow(c.id, [{ boatTypeId: quad.id, quantity: 1 }]);
    await setDateOverride(db, c.id, { dateISO: '2026-07-20', isOpen: false });
    const [day] = await computeCalendar(db, c.id, { fromDateISO: '2026-07-20', days: 1 });
    expect(day.closed).toBe(true);
    expect(day.closedReason).toBe('override');
    expect(day.slots).toHaveLength(0);
  });

  it('marks a date closed by an approved holiday (club not open on holidays)', async () => {
    const c = await newClub('cal-holiday', false);
    const quad = await newBoat(c.id, 'Quad', 4);
    await mondayWindow(c.id, [{ boatTypeId: quad.id, quantity: 1 }]);
    const [holiday] = await db.insert(schema.holidays).values({ date: '2026-07-20', name: `Test Holiday ${c.id}`, source: 'manual', status: 'approved', year: 2026 }).returning();
    try {
      const [day] = await computeCalendar(db, c.id, { fromDateISO: '2026-07-20', days: 1 });
      expect(day.closed).toBe(true);
      expect(day.closedReason).toBe('holiday');
    } finally {
      // holidays is a global (non-club-scoped) table and every test in this file shares the
      // same Monday date — clean up so later tests aren't spuriously closed by this holiday.
      await db.delete(schema.holidays).where(eq(schema.holidays.id, holiday.id));
    }
  });

  it('overlays a materialized slot instead of duplicating it', async () => {
    const c = await newClub('cal-overlay');
    const quad = await newBoat(c.id, 'Quad', 4);
    const w = await mondayWindow(c.id, [{ boatTypeId: quad.id, quantity: 1 }]);
    // Materialize the 08:00 block ahead of computing.
    await materializeSlot(db, {
      clubId: c.id, dateISO: '2026-07-20', startAt: new Date('2026-07-20T05:00:00.000Z'), endAt: new Date('2026-07-20T06:00:00.000Z'),
      windowId: w.id, boats: [{ boatTypeId: quad.id, capacity: 4, minAttendance: null, quantity: 1 }],
    });
    const [day] = await computeCalendar(db, c.id, { fromDateISO: '2026-07-20', days: 1 });
    // Still two blocks (08:00 overlaid + 09:00 virtual), not three.
    expect(day.slots).toHaveLength(2);
    const eight = day.slots.find((s) => s.startAt.toISOString() === '2026-07-20T05:00:00.000Z')!;
    expect(eight.persisted).toBe(true);
    expect(eight.sessions[0].persisted).toBe(true);
  });

  it('surfaces a persisted slot whose window was deleted so bookings never vanish', async () => {
    const c = await newClub('cal-orphan');
    const quad = await newBoat(c.id, 'Quad', 4);
    const w = await mondayWindow(c.id, [{ boatTypeId: quad.id, quantity: 1 }]);
    await materializeSlot(db, {
      clubId: c.id, dateISO: '2026-07-20', startAt: new Date('2026-07-20T05:00:00.000Z'), endAt: new Date('2026-07-20T06:00:00.000Z'),
      windowId: w.id, boats: [{ boatTypeId: quad.id, capacity: 4, minAttendance: null, quantity: 1 }],
    });
    // Delete the window (cascades window_boats; slot.from_window_id → null).
    await db.delete(schema.scheduleWindows).where(eq(schema.scheduleWindows.id, w.id));
    const [day] = await computeCalendar(db, c.id, { fromDateISO: '2026-07-20', days: 1 });
    const persisted = day.slots.filter((s) => s.persisted);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].startAt.toISOString()).toBe('2026-07-20T05:00:00.000Z');
  });
});
