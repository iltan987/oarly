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
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const NOOP_PREFIX = '[deploy-migrate]';

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

const result = spawnSync(bin, ['migrate'], { stdio: 'inherit' });
if (result.error) {
  console.error(`${NOOP_PREFIX} Failed to run drizzle-kit:`, result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`${NOOP_PREFIX} Migration failed (exit ${result.status}) — aborting the build.`);
  process.exit(result.status ?? 1);
}
console.log(`${NOOP_PREFIX} Migrations applied.`);
