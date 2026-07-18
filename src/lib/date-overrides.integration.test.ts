import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { clearDateOverride, listOverrides, setDateOverride } from './date-overrides';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('date-overrides', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('upserts an override (set then flip updates one row, not two)', async () => {
    const c = await newClub('ov-set');
    expect(await setDateOverride(db, c.id, { dateISO: '2026-07-20', isOpen: false })).toBe(true);
    expect(await setDateOverride(db, c.id, { dateISO: '2026-07-20', isOpen: true })).toBe(true);
    const rows = await db.select().from(schema.clubHolidayOverrides).where(eq(schema.clubHolidayOverrides.clubId, c.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].isOpen).toBe(true);
  });

  it('lists overrides within the range only', async () => {
    const c = await newClub('ov-list');
    await setDateOverride(db, c.id, { dateISO: '2026-07-20', isOpen: false });
    await setDateOverride(db, c.id, { dateISO: '2026-07-25', isOpen: false }); // outside a 3-day window
    const inRange = await listOverrides(db, c.id, { fromDateISO: '2026-07-20', days: 3 });
    expect(inRange.map((o) => o.dateISO)).toEqual(['2026-07-20']);
  });

  it('clears an override, reverting to default', async () => {
    const c = await newClub('ov-clear');
    await setDateOverride(db, c.id, { dateISO: '2026-07-20', isOpen: false });
    expect(await clearDateOverride(db, c.id, '2026-07-20')).toBe(true);
    expect(await clearDateOverride(db, c.id, '2026-07-20')).toBe(false); // already gone
    const rows = await db.select().from(schema.clubHolidayOverrides).where(eq(schema.clubHolidayOverrides.clubId, c.id));
    expect(rows).toHaveLength(0);
  });

  it('is scoped by clubId (one club cannot change another’s override)', async () => {
    const c1 = await newClub('ov-c1');
    const c2 = await newClub('ov-c2');
    await setDateOverride(db, c1.id, { dateISO: '2026-07-20', isOpen: false });
    expect(await clearDateOverride(db, c2.id, '2026-07-20')).toBe(false);
    const [row] = await db.select().from(schema.clubHolidayOverrides).where(and(eq(schema.clubHolidayOverrides.clubId, c1.id), eq(schema.clubHolidayOverrides.date, '2026-07-20')));
    expect(row).toBeDefined();
  });
});
