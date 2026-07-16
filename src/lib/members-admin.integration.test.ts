import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { assignSkillLevel, setMembershipStatus } from './members-admin';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('members-admin', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  it('approves only memberships of the given club', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1-${Date.now()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2-${Date.now()}`, name: 'C2', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'pending' }).returning();
    expect(await setMembershipStatus(db, { membershipId: m.id, clubId: c2.id, status: 'approved' })).toBe(false);
    expect(await setMembershipStatus(db, { membershipId: m.id, clubId: c1.id, status: 'approved' })).toBe(true);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(after.status).toBe('approved');
  });

  it('rejects a membershipId belonging to a different club without changing it', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1b-${Date.now()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2b-${Date.now()}`, name: 'C2', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'pending' }).returning();
    expect(await setMembershipStatus(db, { membershipId: m.id, clubId: c2.id, status: 'rejected' })).toBe(false);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(after.status).toBe('pending');
  });

  it('assigns a skill level from the same club and rejects one from another club', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1s-${Date.now()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2s-${Date.now()}`, name: 'C2', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'approved' }).returning();
    const [lvlSameClub] = await db.insert(schema.skillLevels).values({ clubId: c1.id, name: 'Beginner', rank: 1 }).returning();
    const [lvlOtherClub] = await db.insert(schema.skillLevels).values({ clubId: c2.id, name: 'Advanced', rank: 1 }).returning();

    expect(await assignSkillLevel(db, { membershipId: m.id, clubId: c1.id, skillLevelId: lvlOtherClub.id })).toBe(false);
    const [afterReject] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(afterReject.skillLevelId).toBeNull();

    expect(await assignSkillLevel(db, { membershipId: m.id, clubId: c1.id, skillLevelId: lvlSameClub.id })).toBe(true);
    const [afterAssign] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(afterAssign.skillLevelId).toBe(lvlSameClub.id);
  });

  it('assignSkillLevel is scoped by clubId on the membership itself', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1m-${Date.now()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2m-${Date.now()}`, name: 'C2', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'approved' }).returning();
    const [lvl] = await db.insert(schema.skillLevels).values({ clubId: c1.id, name: 'Beginner', rank: 1 }).returning();

    expect(await assignSkillLevel(db, { membershipId: m.id, clubId: c2.id, skillLevelId: lvl.id })).toBe(false);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(after.skillLevelId).toBeNull();
  });
});
