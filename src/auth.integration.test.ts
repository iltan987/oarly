import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { CONSENT_DOCUMENTS, CONSENT_VERSION } from '@/lib/consent';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('auth sign-up', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(drizzle(pool, { schema }), { migrationsFolder: './drizzle' });
  });
  afterAll(async () => { await pool.end(); });

  it('creates a user row via the auth API', async () => {
    process.env.DATABASE_URL = url;
    process.env.BETTER_AUTH_SECRET ??= 'test-secret';
    process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
    process.env.APP_URL ??= 'http://localhost:3000';
    const { auth } = await import('@/auth');
    const email = `signup-${Date.now()}@test.co`;
    await auth.api.signUpEmail({
      body: { email, password: 'Passw0rd!123', name: 'Test User' },
    });
    const db = drizzle(pool, { schema });
    const rows = await db.select().from(schema.user).where(eq(schema.user.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0].locale).toBe('tr');

    // Assert consent rows were written by the databaseHooks.user.create.after hook
    const consentRows = await db.select().from(schema.consents).where(eq(schema.consents.userId, rows[0].id));
    expect(consentRows).toHaveLength(CONSENT_DOCUMENTS.length);
    expect(consentRows.every(row => row.version === CONSENT_VERSION)).toBe(true);
  });
});
