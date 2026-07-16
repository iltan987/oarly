import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { recordSignupConsent, CONSENT_DOCUMENTS, CONSENT_VERSION } from './consent';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('recordSignupConsent', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  it('writes one consent row per document at the current version', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'C', email: `${uid}@t.co` });
    await recordSignupConsent(db, uid);
    const rows = await db.select().from(schema.consents).where(eq(schema.consents.userId, uid));
    expect(rows).toHaveLength(CONSENT_DOCUMENTS.length);
    expect(rows.every((r) => r.version === CONSENT_VERSION)).toBe(true);
    expect(new Set(rows.map((r) => r.document))).toEqual(new Set(CONSENT_DOCUMENTS));
  });
});
