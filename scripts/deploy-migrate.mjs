// Runs pending Drizzle migrations during a PRODUCTION Vercel build, and nothing else.
//
// Why it exists: `next build` does not run migrations, so pushing code whose schema
// hasn't landed yet fails at runtime with `column "…" does not exist` on every query
// that touches the new column. This puts the migration immediately before the build
// that needs it.
//
// Why production only: previews and this repo's prod share one Neon database, so a
// build-command migrate with no environment gate would let a preview deploy apply its
// branch's migrations to production. `VERCEL_ENV` is 'production' only for a
// production deployment, 'preview' for preview deploys, and unset locally — so a
// plain `pnpm build` on a laptop is always a no-op.
//
// Failing here fails the build on purpose: shipping code ahead of its schema is worse
// than not shipping.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NOOP_PREFIX = '[deploy-migrate]';

// Where drizzle.config.ts points `out`. Keep in lockstep with it.
const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

if (process.env.VERCEL_ENV !== 'production') {
  console.log(`${NOOP_PREFIX} VERCEL_ENV=${process.env.VERCEL_ENV ?? '(unset)'} — skipping migrations.`);
  process.exit(0);
}

// drizzle.config.ts resolves DATABASE_URL_UNPOOLED ?? DATABASE_URL. Neon's pooled
// endpoint (host contains "-pooler.") runs PgBouncer in transaction mode, which is the
// wrong connection for DDL — migrations must use the direct endpoint. Rather than
// silently migrating through the pooler, stop with an actionable message. A DATABASE_URL
// that is already direct is fine on its own; only the pooled-and-unpooled-missing
// combination is an error.
const unpooled = process.env.DATABASE_URL_UNPOOLED;
const pooled = process.env.DATABASE_URL;

if (!unpooled && !pooled) {
  console.error(`${NOOP_PREFIX} Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set.`);
  process.exit(1);
}
if (!unpooled && pooled.includes('-pooler.')) {
  console.error(
    `${NOOP_PREFIX} DATABASE_URL points at Neon's pooled endpoint and DATABASE_URL_UNPOOLED is not set.\n` +
    `${NOOP_PREFIX} Migrations need the direct (non-pooled) connection string — add\n` +
    `${NOOP_PREFIX} DATABASE_URL_UNPOOLED to the Production environment and redeploy.`,
  );
  process.exit(1);
}

console.log(`${NOOP_PREFIX} Applying migrations via ${unpooled ? 'DATABASE_URL_UNPOOLED' : 'DATABASE_URL'}…`);

// drizzle-kit is a devDependency; Vercel installs devDependencies for the build, so the
// binary is in the project's own node_modules/.bin.
const bin = join(process.cwd(), 'node_modules', '.bin', 'drizzle-kit');
if (!existsSync(bin)) {
  console.error(`${NOOP_PREFIX} drizzle-kit not found at ${bin} — are devDependencies installed?`);
  process.exit(1);
}

// `pipe`, not `inherit`, so a failure can be reported with whatever drizzle-kit did
// say — and so we can tell "it said nothing" from "it said something". Both streams are
// echoed immediately either way, so a successful run reads exactly as it did before.
const result = spawnSync(bin, ['migrate'], { encoding: 'utf8' });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error(`${NOOP_PREFIX} Failed to run drizzle-kit:`, result.error.message);
  process.exit(1);
}
if (result.status === 0) {
  console.log(`${NOOP_PREFIX} Migrations applied.`);
  process.exit(0);
}

console.error(`${NOOP_PREFIX} Migration failed (exit ${result.status}) — aborting the build.`);
if (!`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()) {
  console.error(`${NOOP_PREFIX} drizzle-kit exited without printing anything.`);
}
await diagnose();
process.exit(result.status ?? 1);

/**
 * Say what drizzle-kit would not.
 *
 * drizzle-kit routes a `pg` DatabaseError into a generic handler WITHOUT passing the
 * error, so a failed migration exits 1 with completely empty stderr: the operator's
 * entire diagnostic is an exit code, on the one command in the pipeline whose failure
 * they cannot debug from the application logs.
 *
 * Two things are recovered here, in order of usefulness:
 *
 *  1. WHICH migration. drizzle applies every pending migration in ONE transaction and
 *     selects them by `created_at`, so after a failure NOTHING has been applied and
 *     `drizzle.__drizzle_migrations` still names the last good one. The journal turns
 *     that into the ordered list of pending tags.
 *
 *  2. WHAT Postgres said. The pending statements are replayed inside a transaction
 *     that is ALWAYS rolled back, in the same order drizzle ran them, until one
 *     raises — which is then printed in full: code, message, detail, hint, position,
 *     and the statement itself. Nothing is applied by this: a rollback undoes DDL in
 *     Postgres, and the replay is only reached once the real attempt has already
 *     failed and the build is being aborted regardless.
 *
 * Best-effort throughout. A diagnostic that can itself fail the build would be worse
 * than the silence it replaces, so every step here swallows its own errors.
 */
async function diagnose() {
  try {
    const { Client } = await import('pg');
    const journalPath = join(MIGRATIONS_DIR, 'meta', '_journal.json');
    if (!existsSync(journalPath)) return;
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));

    const client = new Client({ connectionString: unpooled || pooled });
    await client.connect();
    // The replay takes the same locks the real migration did, so a concurrent lock
    // holder blocks it too — and a diagnostic that hangs is worse than the silence it
    // replaces, because it stalls the deploy it was meant to explain. Today this is
    // masked whenever 0009 is among the pending set (its own SET LOCAL runs first),
    // which stops being true the moment 0009 is applied in production.
    await client.query("SET lock_timeout = '5s'").catch(() => {});
    try {
      let lastApplied = null;
      try {
        const { rows } = await client.query(
          'select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1',
        );
        lastApplied = rows[0] ? Number(rows[0].created_at) : null;
      } catch {
        // No migrations table yet — every migration is pending, which is itself
        // useful to know and is what the null below reports.
      }

      const applied = journal.entries.filter((e) => lastApplied !== null && e.when <= lastApplied);
      const pending = journal.entries.filter((e) => lastApplied === null || e.when > lastApplied);
      console.error(`${NOOP_PREFIX} Last applied: ${applied.at(-1)?.tag ?? '(none — empty database)'}`);
      console.error(`${NOOP_PREFIX} Pending: ${pending.map((e) => e.tag).join(', ') || '(none)'}`);
      console.error(`${NOOP_PREFIX} Nothing was applied — all pending migrations run in ONE transaction.`);
      if (pending.length === 0) return;

      console.error(`${NOOP_PREFIX} Replaying the pending migrations in a transaction that will be rolled back…`);
      await client.query('BEGIN');
      try {
        for (const entry of pending) {
          const file = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
          if (!existsSync(file)) {
            console.error(`${NOOP_PREFIX}   ${entry.tag}.sql is MISSING from the build — that alone would fail it.`);
            return;
          }
          // The same split drizzle's own `readMigrationFiles` performs.
          for (const statement of readFileSync(file, 'utf8').split('--> statement-breakpoint')) {
            if (!statement.trim()) continue;
            try {
              await client.query(statement);
            } catch (err) {
              report(entry.tag, statement, err);
              return;
            }
          }
        }
        console.error(`${NOOP_PREFIX} The replay SUCCEEDED, so the failure is not in the SQL — suspect the`);
        console.error(`${NOOP_PREFIX} connection (pooled endpoint? permissions?) or a concurrent lock holder.`);
      } finally {
        await client.query('ROLLBACK').catch(() => {});
      }
    } finally {
      await client.end().catch(() => {});
    }
  } catch (err) {
    console.error(`${NOOP_PREFIX} (diagnostics unavailable: ${err?.message ?? err})`);
  }
}

/** Everything a `pg` DatabaseError carries, which is exactly what drizzle-kit drops. */
function report(tag, statement, err) {
  console.error(`${NOOP_PREFIX} FAILED IN ${tag}.sql`);
  for (const field of ['code', 'message', 'detail', 'hint', 'position', 'where', 'constraint', 'table', 'column']) {
    if (err?.[field]) console.error(`${NOOP_PREFIX}   ${field}: ${err[field]}`);
  }
  console.error(`${NOOP_PREFIX}   statement:`);
  for (const line of statement.trim().split('\n')) console.error(`${NOOP_PREFIX}     ${line}`);
}
