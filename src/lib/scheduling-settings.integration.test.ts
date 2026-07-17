import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { getSchedulingSettings, updateSchedulingSettings } from './scheduling-settings';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('scheduling-settings', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('persists and reads back all seven fields', async () => {
    const c = await newClub('set-rw');
    const r = await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'lead', bookingOpenLeadDays: 3, selfCancelEnabled: false, cancelCutoffHours: 8, noshowPenalty: '1w', multisportMode: 'priority', openOnHolidays: true });
    expect(r).toEqual({ ok: true });
    expect(await getSchedulingSettings(db, c.id)).toEqual({ bookingOpenMode: 'lead', bookingOpenLeadDays: 3, selfCancelEnabled: false, cancelCutoffHours: 8, noshowPenalty: '1w', multisportMode: 'priority', openOnHolidays: true });
  });

  it('rejects lead mode without a valid lead-days count', async () => {
    const c = await newClub('set-lead');
    expect(await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'lead', bookingOpenLeadDays: null, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', openOnHolidays: false })).toEqual({ ok: false, error: 'invalid_lead' });
  });

  it('normalizes lead days to null under always mode', async () => {
    const c = await newClub('set-null');
    await updateSchedulingSettings(db, c.id, { bookingOpenMode: 'always', bookingOpenLeadDays: 5, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', openOnHolidays: false });
    expect((await getSchedulingSettings(db, c.id)).bookingOpenLeadDays).toBeNull();
  });

  it('scopes updates to the owning club', async () => {
    const c1 = await newClub('set-scope1');
    const c2 = await newClub('set-scope2');
    await updateSchedulingSettings(db, c1.id, { bookingOpenMode: 'always', bookingOpenLeadDays: null, selfCancelEnabled: false, cancelCutoffHours: null, noshowPenalty: '1m', multisportMode: 'equal', openOnHolidays: false });
    // c2 is untouched — still its defaults
    const [row] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c2.id));
    expect(row.noshowPenalty).toBe('off');
    expect(row.selfCancelEnabled).toBe(true);
  });
});
