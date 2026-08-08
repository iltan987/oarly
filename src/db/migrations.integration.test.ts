import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The migration path's safety net.
 *
 * `0009` takes ACCESS EXCLUSIVE on `clubs` (DROP CONSTRAINT), and drizzle runs every
 * pending migration inside ONE transaction — so that lock is then held across `0011`'s
 * `audit_log` rewrite and both of its index builds. `clubs` is the table every request
 * resolves a tenant through, and in Postgres an ACCESS EXCLUSIVE request that has to
 * WAIT also queues every reader arriving behind it. One long-running SELECT holding
 * ACCESS SHARE when the deploy starts is therefore enough to stall the whole site for
 * as long as that query runs.
 *
 * `SET LOCAL lock_timeout` converts that into a failed deploy the operator retries.
 * Verified against a real contended lock rather than by reading the file, because the
 * property that matters is "the request is CANCELLED instead of queueing", and only
 * Postgres can say that.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));
const url = process.env.TEST_DATABASE_URL;

/** The `SET LOCAL lock_timeout …` statement 0009 actually ships, verbatim. */
function lockTimeoutStatement(): string | null {
  const file = readdirSync(MIGRATIONS_DIR).find((f) => f.startsWith('0009_') && f.endsWith('.sql'));
  if (!file) throw new Error('migration 0009 not found — did it get renamed?');
  const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
  const [first] = sql.split('--> statement-breakpoint');
  // Comments are stripped so the assertion is about the STATEMENT, not the prose.
  const statements = first.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').trim();
  return /^set\s+local\s+lock_timeout\s*=/i.test(statements) ? statements : null;
}

describe.skipIf(!url)('migration lock safety', () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: url }); });
  afterAll(async () => { await pool.end(); });

  it('0009 bounds lock acquisition before it takes any lock', () => {
    const stmt = lockTimeoutStatement();
    // Named first and asserted on its own: if 0009 is ever renamed or reordered, this
    // is the failure that says so, instead of the lock test below timing out.
    expect(stmt, 'the FIRST statement of 0009 must be a SET LOCAL lock_timeout').not.toBeNull();
  });

  it('takes effect inside the migration transaction', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(lockTimeoutStatement()!);
      const { rows } = await client.query<{ lock_timeout: string }>('SHOW lock_timeout');
      expect(rows[0].lock_timeout).toBe('5s');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  /**
   * The property, not the setting: with a reader holding ACCESS SHARE on `clubs`, the
   * migration's ACCESS EXCLUSIVE request must be CANCELLED (55P03), not queued behind
   * it — because while it queues, every subsequent reader queues behind IT.
   *
   * Takes ~5s by construction, which is the shipped value. Without the `SET LOCAL`
   * this test does not fail fast, it hangs until vitest's own timeout — the hang IS
   * the defect.
   */
  it('cancels a contended ACCESS EXCLUSIVE request instead of queueing behind it', async () => {
    const reader = new Client({ connectionString: url });
    await reader.connect();
    await reader.query('BEGIN');
    await reader.query('SELECT id FROM clubs LIMIT 1');

    const migrator = new Client({ connectionString: url });
    await migrator.connect();
    const started = Date.now();
    let code: string | undefined;
    try {
      await migrator.query('BEGIN');
      await migrator.query(lockTimeoutStatement()!);
      await migrator.query('LOCK TABLE clubs IN ACCESS EXCLUSIVE MODE');
    } catch (err) {
      code = (err as { code?: string }).code;
    } finally {
      await migrator.query('ROLLBACK').catch(() => {});
      await migrator.end();
      await reader.query('ROLLBACK').catch(() => {});
      await reader.end();
    }

    expect(code, 'expected 55P03 lock_not_available').toBe('55P03');
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(4_000);
    expect(elapsed).toBeLessThan(9_000);
  }, 20_000);
});
