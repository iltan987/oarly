import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * What the operator sees when a production migration fails.
 *
 * drizzle-kit routes a `pg` DatabaseError into a generic handler WITHOUT passing the
 * error, so a failed `drizzle-kit migrate` exits 1 with completely empty stderr — the
 * entire diagnostic is an exit code, on the one command in the deploy pipeline whose
 * failure cannot be debugged from application logs.
 *
 * The failure is reproduced exactly rather than described: a stub `drizzle-kit` that
 * exits 1 in silence, over a migrations folder whose second file contains SQL Postgres
 * will refuse. Everything the script then prints has to come from its own diagnostics.
 *
 * Runs against `oarly_test` and leaves it untouched: the replay is wrapped in a
 * transaction that is always rolled back, and the last assertion is that the table the
 * replay created is gone.
 */

const SCRIPT = fileURLToPath(new URL('../../scripts/deploy-migrate.mjs', import.meta.url));
const url = process.env.TEST_DATABASE_URL;
const PROBE_TABLE = 'deploy_migrate_probe';

describe.skipIf(!url)('deploy-migrate failure diagnostics', () => {
  let dir: string;
  let stderr: string;
  let status: number | null;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deploy-migrate-'));

    // A drizzle-kit that fails exactly the way the real one does: exit 1, no output.
    const binDir = join(dir, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const stub = join(binDir, 'drizzle-kit');
    writeFileSync(stub, '#!/bin/sh\nexit 1\n');
    chmodSync(stub, 0o755);

    const migrations = join(dir, 'drizzle');
    mkdirSync(join(migrations, 'meta'), { recursive: true });
    writeFileSync(join(migrations, 'meta', '_journal.json'), JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [
        // Far in the future, so both count as pending against `oarly_test`'s real
        // `__drizzle_migrations` — this suite shares that database and migrates it.
        { idx: 0, version: '7', when: 9_000_000_000_001, tag: '0000_good', breakpoints: true },
        { idx: 1, version: '7', when: 9_000_000_000_002, tag: '0001_boom', breakpoints: true },
      ],
    }));
    writeFileSync(join(migrations, '0000_good.sql'), `CREATE TABLE "${PROBE_TABLE}" ("id" integer);`);
    // A column type that does not exist: `undefined_object` (42704), with a `hint`, so
    // the report has more than a message to carry.
    writeFileSync(join(migrations, '0001_boom.sql'),
      'ALTER TABLE "clubs" ADD COLUMN "nope" no_such_type;--> statement-breakpoint\nSELECT 1;');

    const res = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, VERCEL_ENV: 'production', DATABASE_URL: url, DATABASE_URL_UNPOOLED: '' },
    });
    stderr = `${res.stderr ?? ''}`;
    status = res.status;
  });

  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('still fails the build', () => {
    expect(status).toBe(1);
  });

  it('says that drizzle-kit itself printed nothing, so the silence is not mistaken for a clean run', () => {
    expect(stderr).toContain('drizzle-kit exited without printing anything');
  });

  it('names which migrations were pending and that none of them landed', () => {
    expect(stderr).toContain('Pending: 0000_good, 0001_boom');
    expect(stderr).toContain('Nothing was applied');
  });

  it('names the migration that actually failed', () => {
    expect(stderr).toContain('FAILED IN 0001_boom.sql');
    // NOT the first pending one: the failure is in the second, and saying "0000_good"
    // would send the operator to the wrong file.
    expect(stderr).not.toContain('FAILED IN 0000_good.sql');
  });

  it("reports what Postgres said — the part drizzle-kit drops", () => {
    expect(stderr).toContain('code: 42704');
    expect(stderr).toMatch(/message: type "no_such_type" does not exist/);
  });

  it('prints the offending statement', () => {
    expect(stderr).toContain('ALTER TABLE "clubs" ADD COLUMN "nope" no_such_type;');
  });

  it('applies nothing: the replay is rolled back', async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const { rows } = await client.query<{ exists: boolean }>(
        'select to_regclass($1) is not null as exists', [PROBE_TABLE],
      );
      // 0000_good.sql really did run inside the replay — and really did not survive it.
      expect(rows[0].exists).toBe(false);
    } finally {
      await client.end();
    }
  });
});
