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
 *
 * ── Which migrations the prologue applies to, and why only the newest is asserted ──
 *
 * `takesBlockingLock` below says a statement needs the prologue when it modifies or
 * removes something that can ALREADY be in use by a concurrent transaction: a
 * non-concurrent `CREATE`/`DROP INDEX`, an `ALTER TABLE`, or `ALTER TYPE … ADD VALUE`.
 * It deliberately excludes:
 *   - `CREATE TABLE` / `CREATE TYPE` of a brand-new name — nothing can hold a
 *     conflicting lock on an object that does not exist yet, so there is no reader to
 *     stall (this is why 0000, which only creates things, is exempt).
 *   - `CREATE`/`DROP INDEX CONCURRENTLY` — built for exactly this; asserting the
 *     prologue on one is cargo-culting the convention onto a statement it doesn't fit.
 *   - Plain `INSERT`/`UPDATE`/`DELETE` — row-level locking, not the table-level
 *     ACCESS EXCLUSIVE/SHARE this prologue defends against.
 *
 * Applying that predicate honestly to *every* file in `drizzle/` does not work: 0001
 * (`CREATE INDEX` on `account`/`session`), 0005/0006 (`CREATE UNIQUE INDEX` after a
 * `DELETE`/`UPDATE` backfill) and 0010/0011 (`CREATE`/`DROP INDEX`, `ALTER COLUMN`) all
 * match it and none of them carry the prologue — they predate the convention, or in
 * 0010/0011's case were written after 0009 but missed it. Those files are already
 * applied in production; nothing here can fix them, and pinning the test to demand a
 * statement they will never have would just make the suite red for a shipped fact we
 * cannot change.
 *
 * That is the immutability counter-argument, and it is correct: a test asserting things
 * about an already-shipped migration defends very little, because the file cannot be
 * un-applied and cannot be un-written. The prologue's value is entirely at AUTHORING
 * time — the moment a lock-taking migration is proposed and could still be fixed before
 * merge. So this guard checks exactly one file: whichever migration is newest in the
 * tree `git diff`/CI is looking at. On the PR that adds a new migration, that file IS
 * the newest one present, so the check runs at precisely the moment the brief calls
 * "authoring time" — before merge, while it is still actionable. Once superseded by a
 * later migration it drops out of scope, which is correct: by then it is either merged
 * (immutable, already the operator's problem if wrong) or abandoned (irrelevant). The
 * guard does not accumulate assertions about history; it re-points at whatever is new
 * every time the tree changes.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));
const url = process.env.TEST_DATABASE_URL;

/** Every migration file, oldest first (the zero-padded numeric prefix sorts correctly). */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * A migration file's statements, in order, each with `--` comments and blank lines
 * stripped so the assertions below are about the STATEMENT, not the prose around it.
 */
function statementsOf(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((block) => block.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').trim())
    .filter((s) => s.length > 0);
}

/** See the "which migrations" section of the doc comment above for the full argument. */
function takesBlockingLock(statement: string): boolean {
  if (/^(insert|update|delete)\b/i.test(statement)) return false;
  if (/^create\s+(table|type)\b/i.test(statement)) return false;
  if (/\bconcurrently\b/i.test(statement)) return false;
  return /^(alter\s+table|create\s+(unique\s+)?index|drop\s+index|alter\s+type)\b/i.test(statement);
}

/** Does this migration's SQL open with a `SET LOCAL lock_timeout …` as its first statement? */
function opensWithLockTimeoutPrologue(sql: string): boolean {
  const [first] = statementsOf(sql);
  return !!first && /^set\s+local\s+lock_timeout\s*=/i.test(first);
}

/** The `SET LOCAL lock_timeout …` statement 0009 actually ships, verbatim. */
function lockTimeoutStatement(): string | null {
  const file = readdirSync(MIGRATIONS_DIR).find((f) => f.startsWith('0009_') && f.endsWith('.sql'));
  if (!file) throw new Error('migration 0009 not found — did it get renamed?');
  const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
  const [first] = statementsOf(sql);
  return /^set\s+local\s+lock_timeout\s*=/i.test(first) ? first : null;
}

describe.skipIf(!url)('migration lock safety', () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: url }); });
  afterAll(async () => { await pool.end(); });

  it('0009 bounds lock acquisition before it takes any lock', () => {
    const stmt = lockTimeoutStatement();
    // Named first and asserted on its own: if 0009 is ever renamed or reordered, this
    // is the failure that says so, instead of the lock test below timing out. This is a
    // tamper/regression check on one known-good file, not the authoring-time guard —
    // see "the newest migration" test below for that.
    expect(stmt, 'the FIRST statement of 0009 must be a SET LOCAL lock_timeout').not.toBeNull();
  });

  it('the lock predicate classifies known statements correctly', () => {
    // Fixtures from real shipped migrations, so the predicate is checked against SQL
    // this repo actually runs rather than only against statements invented for the test.
    expect(takesBlockingLock('ALTER TABLE "clubs" DROP CONSTRAINT "clubs_slug_unique"')).toBe(true);
    expect(takesBlockingLock('CREATE UNIQUE INDEX "clubs_slug_uq" ON "clubs" USING btree ("slug")')).toBe(true);
    expect(takesBlockingLock('ALTER TYPE "public"."club_status" ADD VALUE \'rejected\'')).toBe(true);
    expect(takesBlockingLock('ALTER TABLE "audit_log" ALTER COLUMN "created_at" SET DEFAULT now()')).toBe(true);
    // Deliberately excluded — see the doc comment above.
    expect(takesBlockingLock('CREATE INDEX CONCURRENTLY "x" ON "y" USING btree ("z")')).toBe(false);
    expect(takesBlockingLock('INSERT INTO "window_boats" ("id") VALUES (1)')).toBe(false);
    expect(takesBlockingLock('CREATE TABLE "clubs" ("id" uuid PRIMARY KEY)')).toBe(false);
    expect(takesBlockingLock('CREATE TYPE "public"."club_status" AS ENUM(\'pending\')')).toBe(false);
  });

  it('the newest migration opens with the prologue if it takes a blocking lock', () => {
    const files = migrationFiles();
    const newest = files.at(-1);
    if (!newest) throw new Error('no migrations found in drizzle/');
    const sql = readFileSync(`${MIGRATIONS_DIR}/${newest}`, 'utf8');
    const needsPrologue = statementsOf(sql).some(takesBlockingLock);
    if (!needsPrologue) {
      // Nothing to assert: by the predicate above (see doc comment), this migration
      // cannot stall a concurrent transaction, so requiring the prologue on it would be
      // cargo cult, not safety. A bare CREATE INDEX CONCURRENTLY or an INSERT lands here.
      return;
    }
    expect(opensWithLockTimeoutPrologue(sql), `${newest} takes a blocking lock and must open with SET LOCAL lock_timeout — see this file's doc comment`)
      .toBe(true);
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
