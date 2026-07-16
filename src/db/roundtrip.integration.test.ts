import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('db round-trip', () => {
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

  it('inserts and reads a club with default policy values', async () => {
    const [club] = await db
      .insert(schema.clubs)
      .values({ slug: `c-${Date.now()}`, name: 'Test Club' })
      .returning();
    expect(club.status).toBe('pending');
    expect(club.multisportMode).toBe('equal');
    expect(club.timezone).toBe('Europe/Istanbul');
  });

  it('enforces the active-booking unique index', async () => {
    const [club] = await db.insert(schema.clubs).values({ slug: `c2-${Date.now()}`, name: 'C2' }).returning();
    const [u] = await db.insert(schema.user).values({
      id: `u-${Date.now()}`, name: 'A', email: `a-${Date.now()}@t.co`,
    }).returning();
    const [bt] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 4 }).returning();
    const [slot] = await db.insert(schema.slots).values({
      clubId: club.id, date: '2026-08-01', startAt: new Date(), endAt: new Date(),
    }).returning();
    const [sess] = await db.insert(schema.sessions).values({
      slotId: slot.id, clubId: club.id, boatTypeId: bt.id, capacity: 4,
    }).returning();

    await db.insert(schema.bookings).values({
      sessionId: sess.id, clubId: club.id, userId: u.id, paymentType: 'regular', effectiveAt: new Date(),
    });
    await expect(
      db.insert(schema.bookings).values({
        sessionId: sess.id, clubId: club.id, userId: u.id, paymentType: 'regular', effectiveAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
