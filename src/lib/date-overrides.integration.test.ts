import { randomUUID } from 'node:crypto';

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
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); actor = await newUser(); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  let actor: string;
  async function newUser() {
    const id = `ov-u-${Date.now()}-${seq++}`;
    await db.insert(schema.user).values({ id, name: 'O', email: `${id}@t.co` });
    return id;
  }
  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${randomUUID()}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('upserts an override (set then flip updates one row, not two)', async () => {
    const c = await newClub('ov-set');
    expect(await setDateOverride(db, c.id, { dateISO: '2026-07-20', isOpen: false }, actor)).toBe(true);
    expect(await setDateOverride(db, c.id, { dateISO: '2026-07-20', isOpen: true }, actor)).toBe(true);
    const rows = await db.select().from(schema.clubHolidayOverrides).where(eq(schema.clubHolidayOverrides.clubId, c.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].isOpen).toBe(true);
  });

  it('lists overrides within the range only', async () => {
    const c = await newClub('ov-list');
    await setDateOverride(db, c.id, { dateISO: '2026-07-20', isOpen: false }, actor);
    await setDateOverride(db, c.id, { dateISO: '2026-07-25', isOpen: false }, actor); // outside a 3-day window
    const inRange = await listOverrides(db, c.id, { fromDateISO: '2026-07-20', days: 3 });
    expect(inRange.map((o) => o.dateISO)).toEqual(['2026-07-20']);
  });

  it('clears an override, reverting to default', async () => {
    const c = await newClub('ov-clear');
    await setDateOverride(db, c.id, { dateISO: '2026-07-20', isOpen: false }, actor);
    expect(await clearDateOverride(db, c.id, '2026-07-20', actor)).toBe(true);
    expect(await clearDateOverride(db, c.id, '2026-07-20', actor)).toBe(false); // already gone
    const rows = await db.select().from(schema.clubHolidayOverrides).where(eq(schema.clubHolidayOverrides.clubId, c.id));
    expect(rows).toHaveLength(0);
  });

  it('is scoped by clubId (one club cannot change another’s override)', async () => {
    const c1 = await newClub('ov-c1');
    const c2 = await newClub('ov-c2');
    await setDateOverride(db, c1.id, { dateISO: '2026-07-20', isOpen: false }, actor);
    expect(await clearDateOverride(db, c2.id, '2026-07-20', actor)).toBe(false);
    const [row] = await db.select().from(schema.clubHolidayOverrides).where(and(eq(schema.clubHolidayOverrides.clubId, c1.id), eq(schema.clubHolidayOverrides.date, '2026-07-20')));
    expect(row).toBeDefined();
  });

  it('audits date_override.set and date_override.clear against the date', async () => {
    const owner = await newUser();
    const c = await newClub('ov-audit');
    expect(await setDateOverride(db, c.id, { dateISO: '2026-07-20', isOpen: false }, owner)).toBe(true);
    expect(await clearDateOverride(db, c.id, '2026-07-20', owner)).toBe(true);
    // The target is a date, which repeats across clubs — scope the read by club,
    // or this picks up every other club's overrides for the same day.
    const rows = await db.select().from(schema.auditLog)
      .where(and(eq(schema.auditLog.clubId, c.id), eq(schema.auditLog.target, '2026-07-20')));
    expect(rows.map((a) => a.action).sort()).toEqual(['date_override.clear', 'date_override.set']);
    expect(rows.every((a) => a.actingAsRole === 'owner' && a.actorUserId === owner)).toBe(true);
  });

  it('writes no audit row when clearing an override of another club', async () => {
    const owner = await newUser();
    const c1 = await newClub('ov-audit-x1');
    const c2 = await newClub('ov-audit-x2');
    await setDateOverride(db, c1.id, { dateISO: '2026-07-20', isOpen: false }, owner);
    expect(await clearDateOverride(db, c2.id, '2026-07-20', owner)).toBe(false);
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, c2.id))).toHaveLength(0);
  });

  it('rolls the clear back when the audit insert fails', async () => {
    const owner = await newUser();
    const c = await newClub('ov-atomic');
    await setDateOverride(db, c.id, { dateISO: '2026-07-20', isOpen: false }, owner);
    await expect(clearDateOverride(db, c.id, '2026-07-20', 'no-such-user')).rejects.toThrow();
    const rows = await db.select().from(schema.clubHolidayOverrides).where(eq(schema.clubHolidayOverrides.clubId, c.id));
    expect(rows).toHaveLength(1);
  });

  it('rolls the set back when the audit insert fails, on both the insert and the upsert branch', async () => {
    const owner = await newUser();
    const c = await newClub('ov-atomic-set');
    // Insert branch: nothing must survive.
    await expect(setDateOverride(db, c.id, { dateISO: '2026-07-21', isOpen: false }, 'no-such-user')).rejects.toThrow();
    expect(await db.select().from(schema.clubHolidayOverrides).where(eq(schema.clubHolidayOverrides.clubId, c.id))).toHaveLength(0);
    // onConflictDoUpdate branch: the existing value must not be flipped.
    await setDateOverride(db, c.id, { dateISO: '2026-07-21', isOpen: false }, owner);
    await expect(setDateOverride(db, c.id, { dateISO: '2026-07-21', isOpen: true }, 'no-such-user')).rejects.toThrow();
    const [row] = await db.select().from(schema.clubHolidayOverrides).where(eq(schema.clubHolidayOverrides.clubId, c.id));
    expect(row.isOpen).toBe(false);
  });
});
