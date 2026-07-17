import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { countSkillLevelRefs, createSkillLevel, deleteSkillLevel, listSkillLevels, renameSkillLevel, reorderSkillLevel } from './skill-levels';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('skill-levels', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('creates levels appending rank, lists them ordered', async () => {
    const c = await newClub('sl-create');
    const a = await createSkillLevel(db, { clubId: c.id, name: 'Novice' });
    const b = await createSkillLevel(db, { clubId: c.id, name: 'Intermediate' });
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
    const list = await listSkillLevels(db, c.id);
    expect(list.map((l) => l.name)).toEqual(['Novice', 'Intermediate']);
  });

  it('renames only within the same club', async () => {
    const c1 = await newClub('sl-ren1');
    const c2 = await newClub('sl-ren2');
    const lvl = await createSkillLevel(db, { clubId: c1.id, name: 'X' });
    expect(await renameSkillLevel(db, { clubId: c2.id, skillLevelId: lvl.id, name: 'Hacked' })).toBe(false);
    expect(await renameSkillLevel(db, { clubId: c1.id, skillLevelId: lvl.id, name: 'Y' })).toBe(true);
    const [after] = await listSkillLevels(db, c1.id);
    expect(after.name).toBe('Y');
  });

  it('reorders adjacent levels without violating the unique (club, rank) index', async () => {
    const c = await newClub('sl-order');
    const a = await createSkillLevel(db, { clubId: c.id, name: 'A' }); // rank 1
    const b = await createSkillLevel(db, { clubId: c.id, name: 'B' }); // rank 2
    await createSkillLevel(db, { clubId: c.id, name: 'C' }); // rank 3
    // move B up → swaps with A → B,A,C
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: b.id, direction: 'up' })).toBe(true);
    expect((await listSkillLevels(db, c.id)).map((l) => l.name)).toEqual(['B', 'A', 'C']);
    // move A down → A is at rank 2 now, swaps with C(3) → B,C,A
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: a.id, direction: 'down' })).toBe(true);
    expect((await listSkillLevels(db, c.id)).map((l) => l.name)).toEqual(['B', 'C', 'A']);
    // moving the top-most up is a no-op returning false
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: b.id, direction: 'up' })).toBe(false);
    // ranks are still the contiguous 1..3 with no duplicates
    const ranks = (await listSkillLevels(db, c.id)).map((l) => l.rank);
    expect(ranks).toEqual([1, 2, 3]);
  });

  it('counts references then deletes, nulling out referencing members and boats', async () => {
    const c = await newClub('sl-del');
    const lvl = await createSkillLevel(db, { clubId: c.id, name: 'Adv' });
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c.id, role: 'member', status: 'approved', skillLevelId: lvl.id }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: c.id, name: 'Quad', seats: 4, minSkillLevelId: lvl.id }).returning();
    expect(await countSkillLevelRefs(db, { clubId: c.id, skillLevelId: lvl.id })).toEqual({ members: 1, boats: 1 });
    expect(await deleteSkillLevel(db, { clubId: c.id, skillLevelId: lvl.id })).toBe(true);
    const [afterM] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    const [afterB] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.id, boat.id));
    expect(afterM.skillLevelId).toBeNull();
    expect(afterB.minSkillLevelId).toBeNull();
  });

  it('does not delete a level belonging to another club', async () => {
    const c1 = await newClub('sl-x1');
    const c2 = await newClub('sl-x2');
    const lvl = await createSkillLevel(db, { clubId: c1.id, name: 'Z' });
    expect(await deleteSkillLevel(db, { clubId: c2.id, skillLevelId: lvl.id })).toBe(false);
    expect(await listSkillLevels(db, c1.id)).toHaveLength(1);
  });

  it('does not reorder a level belonging to another club', async () => {
    const c1 = await newClub('sl-ro1');
    const c2 = await newClub('sl-ro2');
    const lvl = await createSkillLevel(db, { clubId: c1.id, name: 'Solo' });
    expect(await reorderSkillLevel(db, { clubId: c2.id, skillLevelId: lvl.id, direction: 'up' })).toBe(false);
    const [after] = await listSkillLevels(db, c1.id);
    expect(after.rank).toBe(lvl.rank);
  });

  it('moving the bottom-most level down is a no-op returning false', async () => {
    const c = await newClub('sl-bot');
    await createSkillLevel(db, { clubId: c.id, name: 'A' }); // rank 1
    const b = await createSkillLevel(db, { clubId: c.id, name: 'B' }); // rank 2
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: b.id, direction: 'down' })).toBe(false);
    expect((await listSkillLevels(db, c.id)).map((l) => l.name)).toEqual(['A', 'B']);
  });

  it('scopes countSkillLevelRefs to the given club, seeing no refs for another club\'s level', async () => {
    const c1 = await newClub('sl-cr1');
    const c2 = await newClub('sl-cr2');
    const lvl = await createSkillLevel(db, { clubId: c1.id, name: 'Ref' });
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'approved', skillLevelId: lvl.id }).returning();
    await db.insert(schema.boatTypes).values({ clubId: c1.id, name: 'Quad', seats: 4, minSkillLevelId: lvl.id }).returning();
    expect(await countSkillLevelRefs(db, { clubId: c1.id, skillLevelId: lvl.id })).toEqual({ members: 1, boats: 1 });
    expect(await countSkillLevelRefs(db, { clubId: c2.id, skillLevelId: lvl.id })).toEqual({ members: 0, boats: 0 });
  });
});
