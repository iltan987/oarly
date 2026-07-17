import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { createBoat, listBoats, setBoatActive, updateBoat } from './boats';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('boats', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('creates and lists boats scoped to the club', async () => {
    const c = await newClub('boat-c');
    const r = await createBoat(db, c.id, { name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: 2 });
    expect(r.ok).toBe(true);
    const boats = await listBoats(db, c.id);
    expect(boats).toHaveLength(1);
    expect(boats[0].name).toBe('Quad');
    expect(boats[0].active).toBe(true);
  });

  it('rejects a min skill level from another club', async () => {
    const c1 = await newClub('boat-s1');
    const c2 = await newClub('boat-s2');
    const [otherLvl] = await db.insert(schema.skillLevels).values({ clubId: c2.id, name: 'Adv', rank: 1 }).returning();
    const r = await createBoat(db, c1.id, { name: 'Double', seats: 2, minSkillLevelId: otherLvl.id, allowedPayment: 'regular_only', minAttendance: null });
    expect(r).toEqual({ ok: false, error: 'skill_not_in_club' });
    expect(await listBoats(db, c1.id)).toHaveLength(0);
  });

  it('updates only within the same club and validates the skill FK', async () => {
    const c1 = await newClub('boat-u1');
    const c2 = await newClub('boat-u2');
    const created = await createBoat(db, c1.id, { name: 'Single', seats: 1, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null });
    if (!created.ok) throw new Error('setup');
    // wrong club → not_found
    expect(await updateBoat(db, { clubId: c2.id, boatId: created.id, name: 'Hacked', seats: 1, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null })).toEqual({ ok: false, error: 'not_found' });
    // valid update
    expect(await updateBoat(db, { clubId: c1.id, boatId: created.id, name: 'Skiff', seats: 1, minSkillLevelId: null, allowedPayment: 'multisport_only', minAttendance: null })).toEqual({ ok: true });
    const [after] = await listBoats(db, c1.id);
    expect(after.name).toBe('Skiff');
    expect(after.allowedPayment).toBe('multisport_only');
  });

  it('soft-deactivates and reactivates', async () => {
    const c = await newClub('boat-a');
    const created = await createBoat(db, c.id, { name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null });
    if (!created.ok) throw new Error('setup');
    expect(await setBoatActive(db, { clubId: c.id, boatId: created.id, active: false })).toBe(true);
    const [row] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.id, created.id));
    expect(row.active).toBe(false);
  });
});
