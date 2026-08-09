import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { setUserLocale } from './user-locale';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('setUserLocale', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
  });
  afterAll(async () => { await pool.end(); });

  // randomUUID, never a clock-derived id: `Date.now()` and `performance.now()` are both
  // millisecond-resolution, so ids minted in a tight loop collide and the insert fails
  // with `duplicate key value violates user_pkey` on any machine fast enough. That is a
  // defect this repo has already shipped to CI once.
  async function mkUser(locale: 'tr' | 'en') {
    const id = `ul-${randomUUID()}`;
    await db.insert(schema.user).values({ id, name: 'X', email: `${id}@t.co`, locale });
    return id;
  }

  async function readLocale(id: string) {
    const [row] = await db.select({ locale: schema.user.locale })
      .from(schema.user).where(eq(schema.user.id, id));
    return row?.locale;
  }

  it('overwrites the stored locale', async () => {
    const id = await mkUser('tr');
    await setUserLocale(db, id, 'en');
    expect(await readLocale(id)).toBe('en');
  });

  it('is idempotent', async () => {
    const id = await mkUser('en');
    await setUserLocale(db, id, 'en');
    await setUserLocale(db, id, 'en');
    expect(await readLocale(id)).toBe('en');
  });

  it('touches only the addressed user', async () => {
    // A missing WHERE clause updates every row and every test above still passes.
    const target = await mkUser('tr');
    const bystander = await mkUser('tr');
    await setUserLocale(db, target, 'en');
    expect(await readLocale(target)).toBe('en');
    expect(await readLocale(bystander)).toBe('tr');
  });

  it('is a no-op for an unknown user id', async () => {
    await expect(setUserLocale(db, `ul-${randomUUID()}`, 'en')).resolves.toBeUndefined();
  });
});
