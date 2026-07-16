import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from '@/db/schema';
import { getMembership } from './membership';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('getMembership', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  it('finds the membership for a (user, club) pair and null otherwise', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [club] = await db.insert(schema.clubs).values({ slug: `c-${Date.now()}`, name: 'C', status: 'active' }).returning();
    await db.insert(schema.memberships).values({ userId: uid, clubId: club.id, role: 'owner', status: 'approved' });
    const found = await getMembership(db, uid, club.id);
    expect(found?.role).toBe('owner');
    expect(await getMembership(db, uid, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
