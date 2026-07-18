import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { materializeSlot } from './materialize';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('materializeSlot', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }
  async function newBoat(clubId: string, name: string, seats: number) {
    const [b] = await db.insert(schema.boatTypes).values({ clubId, name, seats }).returning();
    return b;
  }
  async function newWindow(clubId: string) {
    const [w] = await db.insert(schema.scheduleWindows).values({ clubId, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60 }).returning();
    return w;
  }

  it('creates a slot with the full session set, expanding quantity', async () => {
    const c = await newClub('mat-a');
    const boat = await newBoat(c.id, 'Quad', 4);
    const w = await newWindow(c.id);
    const startAt = new Date('2026-07-20T05:00:00.000Z');
    const endAt = new Date('2026-07-20T06:00:00.000Z');
    const r = await materializeSlot(db, {
      clubId: c.id, dateISO: '2026-07-20', startAt, endAt, windowId: w.id,
      boats: [{ boatTypeId: boat.id, capacity: 4, minAttendance: null, quantity: 2 }],
    });
    expect(r.sessions).toHaveLength(2);
    const dbSessions = await db.select().from(schema.sessions).where(eq(schema.sessions.slotId, r.slotId));
    expect(dbSessions).toHaveLength(2);
    expect(dbSessions.every((s) => s.capacity === 4)).toBe(true);
  });

  it('is idempotent: a second call for the same block returns the same slot with no duplicate sessions', async () => {
    const c = await newClub('mat-b');
    const boat = await newBoat(c.id, 'Double', 2);
    const w = await newWindow(c.id);
    const startAt = new Date('2026-07-20T05:00:00.000Z');
    const endAt = new Date('2026-07-20T06:00:00.000Z');
    const input = { clubId: c.id, dateISO: '2026-07-20', startAt, endAt, windowId: w.id, boats: [{ boatTypeId: boat.id, capacity: 2, minAttendance: null, quantity: 1 }] };
    const first = await materializeSlot(db, input);
    const second = await materializeSlot(db, input);
    expect(second.slotId).toBe(first.slotId);
    const slotsForClub = await db.select().from(schema.slots).where(eq(schema.slots.clubId, c.id));
    expect(slotsForClub).toHaveLength(1);
    const dbSessions = await db.select().from(schema.sessions).where(eq(schema.sessions.slotId, first.slotId));
    expect(dbSessions).toHaveLength(1);
  });

  it('scopes the created slot to the given clubId', async () => {
    const c = await newClub('mat-c');
    const boat = await newBoat(c.id, 'Single', 1);
    const w = await newWindow(c.id);
    const startAt = new Date('2026-07-21T05:00:00.000Z');
    const r = await materializeSlot(db, { clubId: c.id, dateISO: '2026-07-21', startAt, endAt: new Date('2026-07-21T06:00:00.000Z'), windowId: w.id, boats: [{ boatTypeId: boat.id, capacity: 1, minAttendance: null, quantity: 1 }] });
    const [slot] = await db.select().from(schema.slots).where(eq(schema.slots.id, r.slotId));
    expect(slot.clubId).toBe(c.id);
  });
});
