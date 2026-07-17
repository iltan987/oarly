import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { createWindow, deleteWindow, listWindowsWithBoats, updateWindow } from './schedule';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('schedule', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }
  async function newBoat(clubId: string, name: string, active = true) {
    const [b] = await db.insert(schema.boatTypes).values({ clubId, name, seats: 4, allowedPayment: 'both', active }).returning();
    return b;
  }

  it('creates a window with boats and lists it with joined boat names', async () => {
    const c = await newClub('sch-create');
    const quad = await newBoat(c.id, 'Quad');
    const dbl = await newBoat(c.id, 'Double');
    const r = await createWindow(db, c.id, { weekday: 1, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: quad.id, quantity: 1 }, { boatTypeId: dbl.id, quantity: 2 }] });
    expect(r.ok).toBe(true);
    const list = await listWindowsWithBoats(db, c.id);
    expect(list).toHaveLength(1);
    expect(list[0].weekday).toBe(1);
    expect(list[0].startTime.slice(0, 5)).toBe('08:00');
    expect(list[0].boats.map((b) => `${b.boatName}x${b.quantity}`).sort()).toEqual(['Doublex2', 'Quadx1']);
  });

  it('rejects an uneven tiling', async () => {
    const c = await newClub('sch-tile');
    const boat = await newBoat(c.id, 'Quad');
    const r = await createWindow(db, c.id, { weekday: 2, startTime: '08:00', endTime: '11:30', defaultSessionMinutes: 60, boats: [{ boatTypeId: boat.id, quantity: 1 }] });
    expect(r).toEqual({ ok: false, error: 'uneven_tiling' });
    expect(await listWindowsWithBoats(db, c.id)).toHaveLength(0);
  });

  it('rejects end before start', async () => {
    const c = await newClub('sch-order');
    const boat = await newBoat(c.id, 'Quad');
    const r = await createWindow(db, c.id, { weekday: 2, startTime: '11:00', endTime: '08:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: boat.id, quantity: 1 }] });
    expect(r).toEqual({ ok: false, error: 'end_before_start' });
  });

  it('rejects an overlapping window but allows touching and other-weekday windows', async () => {
    const c = await newClub('sch-overlap');
    const boat = await newBoat(c.id, 'Quad');
    const b = { boatTypeId: boat.id, quantity: 1 };
    expect((await createWindow(db, c.id, { weekday: 3, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [b] })).ok).toBe(true);
    expect(await createWindow(db, c.id, { weekday: 3, startTime: '10:00', endTime: '12:00', defaultSessionMinutes: 60, boats: [b] })).toEqual({ ok: false, error: 'overlap' });
    expect((await createWindow(db, c.id, { weekday: 3, startTime: '11:00', endTime: '14:00', defaultSessionMinutes: 60, boats: [b] })).ok).toBe(true); // touching
    expect((await createWindow(db, c.id, { weekday: 4, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [b] })).ok).toBe(true); // other day
  });

  it('rejects invalid boats: empty, foreign-club, inactive, duplicate', async () => {
    const c = await newClub('sch-boats');
    const other = await newClub('sch-boats-other');
    const good = await newBoat(c.id, 'Quad');
    const inactive = await newBoat(c.id, 'Old', false);
    const foreign = await newBoat(other.id, 'Foreign');
    const mk = (boats: { boatTypeId: string; quantity: number }[]) => createWindow(db, c.id, { weekday: 5, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60, boats });
    expect(await mk([])).toEqual({ ok: false, error: 'invalid_boats' });
    expect(await mk([{ boatTypeId: foreign.id, quantity: 1 }])).toEqual({ ok: false, error: 'invalid_boats' });
    expect(await mk([{ boatTypeId: inactive.id, quantity: 1 }])).toEqual({ ok: false, error: 'invalid_boats' });
    expect(await mk([{ boatTypeId: good.id, quantity: 1 }, { boatTypeId: good.id, quantity: 1 }])).toEqual({ ok: false, error: 'invalid_boats' });
  });

  it('update replaces the boats set and updates window fields', async () => {
    const c = await newClub('sch-update');
    const quad = await newBoat(c.id, 'Quad');
    const dbl = await newBoat(c.id, 'Double');
    const created = await createWindow(db, c.id, { weekday: 1, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: quad.id, quantity: 1 }] });
    if (!created.ok) throw new Error('setup failed');
    const upd = await updateWindow(db, { clubId: c.id, windowId: created.id, weekday: 1, startTime: '09:00', endTime: '11:00', defaultSessionMinutes: 120, boats: [{ boatTypeId: dbl.id, quantity: 3 }] });
    expect(upd.ok).toBe(true);
    const list = await listWindowsWithBoats(db, c.id);
    expect(list[0].startTime.slice(0, 5)).toBe('09:00');
    expect(list[0].defaultSessionMinutes).toBe(120);
    expect(list[0].boats).toEqual([{ boatTypeId: dbl.id, boatName: 'Double', quantity: 3 }]);
  });

  it('scopes update and delete to the owning club', async () => {
    const c1 = await newClub('sch-scope1');
    const c2 = await newClub('sch-scope2');
    const boat = await newBoat(c1.id, 'Quad');
    const created = await createWindow(db, c1.id, { weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: boat.id, quantity: 1 }] });
    if (!created.ok) throw new Error('setup failed');
    // c2 cannot update or delete c1's window
    expect(await updateWindow(db, { clubId: c2.id, windowId: created.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: boat.id, quantity: 1 }] })).toEqual({ ok: false, error: 'not_found' });
    expect(await deleteWindow(db, { clubId: c2.id, windowId: created.id })).toBe(false);
    expect(await listWindowsWithBoats(db, c1.id)).toHaveLength(1);
    // c1 can delete its own
    expect(await deleteWindow(db, { clubId: c1.id, windowId: created.id })).toBe(true);
    const [orphan] = await db.select().from(schema.windowBoats).where(eq(schema.windowBoats.windowId, created.id));
    expect(orphan).toBeUndefined(); // window_boats cascade-deleted
  });
});
