import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createClub } from './clubs-admin';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('createClub', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function mkUser() {
    const id = `u-${Date.now()}-${Math.floor(performance.now())}`;
    await db.insert(schema.user).values({ id, name: 'X', email: `${id}@t.co` });
    return { id, email: `${id}@t.co` };
  }

  it('creates an active club, an approved owner membership, and an audit row', async () => {
    const admin = await mkUser();
    const owner = await mkUser();
    const slug = `bogazici-${Date.now()}`;
    const res = await createClub(db, { name: 'Boğaziçi Kürek', slug, ownerEmail: owner.email, createdBy: admin.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [club] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, res.clubId));
    expect(club.status).toBe('active');
    const [m] = await db.select().from(schema.memberships)
      .where(and(eq(schema.memberships.clubId, res.clubId), eq(schema.memberships.userId, owner.id)));
    expect(m.role).toBe('owner');
    expect(m.status).toBe('approved');
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, res.clubId));
    expect(audit.length).toBeGreaterThan(0);
  });

  it('rejects reserved and duplicate slugs, and a missing owner', async () => {
    const admin = await mkUser();
    const owner = await mkUser();
    expect((await createClub(db, { name: 'A', slug: 'admin', ownerEmail: owner.email, createdBy: admin.id })).ok).toBe(false);
    expect(await createClub(db, { name: 'A', slug: 'admin', ownerEmail: owner.email, createdBy: admin.id }))
      .toMatchObject({ ok: false, error: 'slug_reserved' });
    expect(await createClub(db, { name: 'A', slug: `x-${Date.now()}`, ownerEmail: 'nobody@nowhere.co', createdBy: admin.id }))
      .toMatchObject({ ok: false, error: 'owner_not_found' });
    const slug = `dup-${Date.now()}`;
    await createClub(db, { name: 'A', slug, ownerEmail: owner.email, createdBy: admin.id });
    expect(await createClub(db, { name: 'B', slug, ownerEmail: owner.email, createdBy: admin.id }))
      .toMatchObject({ ok: false, error: 'slug_taken' });
  });
});
