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
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); actor = await newUser(); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  let actor: string;
  async function newUser() {
    const id = `sl-u-${Date.now()}-${seq++}`;
    await db.insert(schema.user).values({ id, name: 'O', email: `${id}@t.co` });
    return id;
  }
  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('creates levels appending rank, lists them ordered', async () => {
    const c = await newClub('sl-create');
    const a = await createSkillLevel(db, { clubId: c.id, name: 'Novice', actorId: actor });
    const b = await createSkillLevel(db, { clubId: c.id, name: 'Intermediate', actorId: actor });
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
    const list = await listSkillLevels(db, c.id);
    expect(list.map((l) => l.name)).toEqual(['Novice', 'Intermediate']);
  });

  it('renames only within the same club', async () => {
    const c1 = await newClub('sl-ren1');
    const c2 = await newClub('sl-ren2');
    const lvl = await createSkillLevel(db, { clubId: c1.id, name: 'X', actorId: actor });
    expect(await renameSkillLevel(db, { clubId: c2.id, skillLevelId: lvl.id, name: 'Hacked', actorId: actor })).toBe(false);
    expect(await renameSkillLevel(db, { clubId: c1.id, skillLevelId: lvl.id, name: 'Y', actorId: actor })).toBe(true);
    const [after] = await listSkillLevels(db, c1.id);
    expect(after.name).toBe('Y');
  });

  it('reorders adjacent levels without violating the unique (club, rank) index', async () => {
    const c = await newClub('sl-order');
    const a = await createSkillLevel(db, { clubId: c.id, name: 'A', actorId: actor }); // rank 1
    const b = await createSkillLevel(db, { clubId: c.id, name: 'B', actorId: actor }); // rank 2
    await createSkillLevel(db, { clubId: c.id, name: 'C', actorId: actor }); // rank 3
    // move B up → swaps with A → B,A,C
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: b.id, direction: 'up', actorId: actor })).toBe(true);
    expect((await listSkillLevels(db, c.id)).map((l) => l.name)).toEqual(['B', 'A', 'C']);
    // move A down → A is at rank 2 now, swaps with C(3) → B,C,A
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: a.id, direction: 'down', actorId: actor })).toBe(true);
    expect((await listSkillLevels(db, c.id)).map((l) => l.name)).toEqual(['B', 'C', 'A']);
    // moving the top-most up is a no-op returning false
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: b.id, direction: 'up', actorId: actor })).toBe(false);
    // ranks are still the contiguous 1..3 with no duplicates
    const ranks = (await listSkillLevels(db, c.id)).map((l) => l.rank);
    expect(ranks).toEqual([1, 2, 3]);
  });

  it('counts references then deletes, nulling out referencing members and boats', async () => {
    const c = await newClub('sl-del');
    const lvl = await createSkillLevel(db, { clubId: c.id, name: 'Adv', actorId: actor });
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c.id, role: 'member', status: 'approved', skillLevelId: lvl.id }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: c.id, name: 'Quad', seats: 4, minSkillLevelId: lvl.id }).returning();
    expect(await countSkillLevelRefs(db, { clubId: c.id, skillLevelId: lvl.id })).toEqual({ members: 1, boats: 1 });
    expect(await deleteSkillLevel(db, { clubId: c.id, skillLevelId: lvl.id, actorId: actor })).toBe(true);
    const [afterM] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    const [afterB] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.id, boat.id));
    expect(afterM.skillLevelId).toBeNull();
    expect(afterB.minSkillLevelId).toBeNull();
  });

  it('does not delete a level belonging to another club', async () => {
    const c1 = await newClub('sl-x1');
    const c2 = await newClub('sl-x2');
    const lvl = await createSkillLevel(db, { clubId: c1.id, name: 'Z', actorId: actor });
    expect(await deleteSkillLevel(db, { clubId: c2.id, skillLevelId: lvl.id, actorId: actor })).toBe(false);
    expect(await listSkillLevels(db, c1.id)).toHaveLength(1);
  });

  it('does not reorder a level belonging to another club', async () => {
    const c1 = await newClub('sl-ro1');
    const c2 = await newClub('sl-ro2');
    const lvl = await createSkillLevel(db, { clubId: c1.id, name: 'Solo', actorId: actor });
    expect(await reorderSkillLevel(db, { clubId: c2.id, skillLevelId: lvl.id, direction: 'up', actorId: actor })).toBe(false);
    const [after] = await listSkillLevels(db, c1.id);
    expect(after.rank).toBe(lvl.rank);
  });

  it('moving the bottom-most level down is a no-op returning false', async () => {
    const c = await newClub('sl-bot');
    await createSkillLevel(db, { clubId: c.id, name: 'A', actorId: actor }); // rank 1
    const b = await createSkillLevel(db, { clubId: c.id, name: 'B', actorId: actor }); // rank 2
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: b.id, direction: 'down', actorId: actor })).toBe(false);
    expect((await listSkillLevels(db, c.id)).map((l) => l.name)).toEqual(['A', 'B']);
  });

  it('scopes countSkillLevelRefs to the given club, seeing no refs for another club\'s level', async () => {
    const c1 = await newClub('sl-cr1');
    const c2 = await newClub('sl-cr2');
    const lvl = await createSkillLevel(db, { clubId: c1.id, name: 'Ref', actorId: actor });
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'approved', skillLevelId: lvl.id }).returning();
    await db.insert(schema.boatTypes).values({ clubId: c1.id, name: 'Quad', seats: 4, minSkillLevelId: lvl.id }).returning();
    expect(await countSkillLevelRefs(db, { clubId: c1.id, skillLevelId: lvl.id })).toEqual({ members: 1, boats: 1 });
    expect(await countSkillLevelRefs(db, { clubId: c2.id, skillLevelId: lvl.id })).toEqual({ members: 0, boats: 0 });
  });

  it('audits skill_level create, rename, reorder and delete', async () => {
    const owner = await newUser();
    const c = await newClub('sl-audit');
    await createSkillLevel(db, { clubId: c.id, name: 'First', actorId: owner }); // gives the reorder a neighbour
    const lvl = await createSkillLevel(db, { clubId: c.id, name: 'Second', actorId: owner });

    expect(await renameSkillLevel(db, { clubId: c.id, skillLevelId: lvl.id, name: 'Renamed', actorId: owner })).toBe(true);
    expect(await reorderSkillLevel(db, { clubId: c.id, skillLevelId: lvl.id, direction: 'up', actorId: owner })).toBe(true);
    expect(await deleteSkillLevel(db, { clubId: c.id, skillLevelId: lvl.id, actorId: owner })).toBe(true);

    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, lvl.id));
    expect(rows.map((a) => a.action).sort()).toEqual(['skill_level.create', 'skill_level.delete', 'skill_level.rename', 'skill_level.reorder']);
    expect(rows.every((a) => a.actingAsRole === 'owner' && a.actorUserId === owner && a.clubId === c.id)).toBe(true);
  });

  it('writes no audit row for a level belonging to another club', async () => {
    const owner = await newUser();
    const c1 = await newClub('sl-audit-x1');
    const c2 = await newClub('sl-audit-x2');
    const lvl = await createSkillLevel(db, { clubId: c1.id, name: 'Only', actorId: owner });
    expect(await renameSkillLevel(db, { clubId: c2.id, skillLevelId: lvl.id, name: 'Hacked', actorId: owner })).toBe(false);
    expect(await deleteSkillLevel(db, { clubId: c2.id, skillLevelId: lvl.id, actorId: owner })).toBe(false);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, lvl.id));
    expect(rows.map((a) => a.action)).toEqual(['skill_level.create']);
    expect(rows[0].clubId).toBe(c1.id);
  });

  it('rolls the level creation back when the audit insert fails', async () => {
    const c = await newClub('sl-atomic');
    await expect(createSkillLevel(db, { clubId: c.id, name: 'X', actorId: 'no-such-user' })).rejects.toThrow();
    expect(await listSkillLevels(db, c.id)).toHaveLength(0);
  });

  it('rolls the rename back when the audit insert fails', async () => {
    const owner = await newUser();
    const c = await newClub('sl-atomic-r');
    const lvl = await createSkillLevel(db, { clubId: c.id, name: 'Keep', actorId: owner });
    await expect(renameSkillLevel(db, { clubId: c.id, skillLevelId: lvl.id, name: 'Renamed', actorId: 'no-such-user' })).rejects.toThrow();
    expect((await listSkillLevels(db, c.id))[0].name).toBe('Keep');
  });

  it('rolls the reorder back when the audit insert fails', async () => {
    const owner = await newUser();
    const c = await newClub('sl-atomic-o');
    await createSkillLevel(db, { clubId: c.id, name: 'A', actorId: owner });
    const b = await createSkillLevel(db, { clubId: c.id, name: 'B', actorId: owner });
    await expect(reorderSkillLevel(db, { clubId: c.id, skillLevelId: b.id, direction: 'up', actorId: 'no-such-user' })).rejects.toThrow();
    expect((await listSkillLevels(db, c.id)).map((l) => l.name)).toEqual(['A', 'B']);
  });

  it('rolls the deletion back when the audit insert fails', async () => {
    const owner = await newUser();
    const c = await newClub('sl-atomic-d');
    const lvl = await createSkillLevel(db, { clubId: c.id, name: 'Survivor', actorId: owner });
    await expect(deleteSkillLevel(db, { clubId: c.id, skillLevelId: lvl.id, actorId: 'no-such-user' })).rejects.toThrow();
    expect((await listSkillLevels(db, c.id)).map((l) => l.id)).toEqual([lvl.id]);
  });
});
