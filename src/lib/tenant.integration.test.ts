import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { findClubBySlug, getClubBySlug } from './tenant';

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

  it('resolves a live club whose slug was previously rejected, not the rejected row', async () => {
    const slug = `trap-${Date.now()}`;
    // A rejected request that once held this slug…
    await db.insert(schema.clubs).values({ slug, name: 'Rejected Squatter', status: 'rejected' });
    // …must not stop the real club from claiming it, and must never be resolved by it.
    await db.insert(schema.clubs).values({ slug, name: 'Real Club', status: 'active' });

    // Ten reads: an unordered `limit 1` can return either row, so a single read can
    // pass by luck. This loop makes the flake into a failure.
    for (let i = 0; i < 10; i++) {
      const found = await findClubBySlug(db, slug);
      expect(found?.name).toBe('Real Club');
    }
  });

  it('does not resolve a rejected club at all', async () => {
    const slug = `gone-${Date.now()}`;
    await db.insert(schema.clubs).values({ slug, name: 'Only Rejected', status: 'rejected' });
    expect(await findClubBySlug(db, slug)).toBeNull();
  });

  it('still enforces slug uniqueness among non-rejected clubs', async () => {
    // The other half of the partial index: exempting rejected rows must not have
    // weakened the constraint for live ones, or two clubs could share a slug and the
    // `limit 1` ambiguity would be back for good.
    const slug = `uq-${Date.now()}`;
    await db.insert(schema.clubs).values({ slug, name: 'First', status: 'active' });
    // drizzle wraps the driver error, so the constraint name lives on `cause`.
    const err = await db.insert(schema.clubs).values({ slug, name: 'Second', status: 'pending' })
      .then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect((err as { cause?: { constraint?: string } }).cause?.constraint).toBe('clubs_slug_uq');
  });
});
