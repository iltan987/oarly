import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { requestToJoin } from './join';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('requestToJoin', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  it('creates one pending membership and is idempotent', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'J', email: `${uid}@t.co` });
    const [club] = await db.insert(schema.clubs).values({ slug: `j-${Date.now()}`, name: 'J', status: 'active' }).returning();
    expect(await requestToJoin(db, { clubId: club.id, userId: uid })).toBe('created');
    expect(await requestToJoin(db, { clubId: club.id, userId: uid })).toBe('exists');
    const rows = await db.select().from(schema.memberships)
      .where(and(eq(schema.memberships.clubId, club.id), eq(schema.memberships.userId, uid)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'member', status: 'pending' });
  });

  it('refuses to join a non-active club and writes nothing', async () => {
    const uid = `u-${Date.now()}-2`;
    await db.insert(schema.user).values({ id: uid, name: 'K', email: `${uid}@t.co` });
    const [club] = await db.insert(schema.clubs).values({ slug: `j2-${Date.now()}`, name: 'K', status: 'pending' }).returning();
    expect(await requestToJoin(db, { clubId: club.id, userId: uid })).toBe('club_inactive');
    const rows = await db.select().from(schema.memberships)
      .where(and(eq(schema.memberships.clubId, club.id), eq(schema.memberships.userId, uid)));
    expect(rows).toHaveLength(0);
  });
});
