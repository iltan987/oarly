import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { requestClub } from './club-request';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('requestClub', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  it('creates a pending club owned by the requester', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'R', email: `${uid}@t.co` });
    const slug = `req-${Date.now()}`;
    const res = await requestClub(db, { name: 'İTÜ Kürek', slug, ownerId: uid });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [club] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, res.clubId));
    expect(club.status).toBe('pending');
    expect(club.createdBy).toBe(uid);
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, res.clubId));
    expect(m).toMatchObject({ userId: uid, role: 'owner', status: 'approved' });
  });

  it('rejects reserved and duplicate slugs', async () => {
    const uid = `u-${Date.now()}-2`;
    await db.insert(schema.user).values({ id: uid, name: 'R', email: `${uid}@t.co` });
    expect(await requestClub(db, { name: 'A', slug: 'admin', ownerId: uid }))
      .toMatchObject({ ok: false, error: 'slug_reserved' });
    const slug = `dup-${Date.now()}`;
    await requestClub(db, { name: 'A', slug, ownerId: uid });
    expect(await requestClub(db, { name: 'B', slug, ownerId: uid }))
      .toMatchObject({ ok: false, error: 'slug_taken' });
  });
});
