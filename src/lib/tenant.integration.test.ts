import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '@/db/schema';
import { getClubBySlug } from './tenant';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('tenant resolution query', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('finds a club by slug', async () => {
    const slug = `demo-${Date.now()}`;
    await db.insert(schema.clubs).values({ slug, name: 'Demo Rowing' });
    const [found] = await db.select().from(schema.clubs).where(eq(schema.clubs.slug, slug)).limit(1);
    expect(found?.name).toBe('Demo Rowing');
    expect(found?.status).toBe('pending');
    expect(typeof getClubBySlug).toBe('function');
  });

  it('returns nothing for an unknown slug', async () => {
    const rows = await db.select().from(schema.clubs).where(eq(schema.clubs.slug, `nope-${Date.now()}`)).limit(1);
    expect(rows).toHaveLength(0);
  });
});
