// Runs `drizzle-kit migrate` from a developer machine, refusing to touch a REMOTE
// database unless you say so explicitly.
//
// Why it exists: `drizzle.config.ts` resolves `DATABASE_URL_UNPOOLED ?? DATABASE_URL`,
// preferring the unpooled URL because production DDL must not go through PgBouncer.
// That precedence is correct for the deploy path and a trap for the local one — a
// developer whose env file carries a localhost DATABASE_URL alongside a Neon
// DATABASE_URL_UNPOOLED reads "this migrates my local database" and migrates
// production instead. The URL the config will actually use is the one this script
// checks, so the guard can never disagree with the tool it is guarding.
//
// The deployed path does NOT come through here: `scripts/deploy-migrate.mjs` invokes
// drizzle-kit directly during a production Vercel build, gated on VERCEL_ENV.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import 'dotenv/config';

const TAG = '[db:migrate]';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

// Same precedence as drizzle.config.ts — keep these in lockstep. `||`, not `??`, so an
// env var set to the empty string falls through instead of resolving to an empty URL.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '';

if (!url) {
  console.error(
    `${TAG} No database URL. Set DATABASE_URL (or DATABASE_URL_UNPOOLED), e.g.\n` +
    `${TAG}   DATABASE_URL=postgresql://postgres:postgres@localhost:5434/oarly_dev pnpm db:migrate`,
  );
  process.exit(1);
}

/** The URL's host, or null if it will not parse — an unparseable URL is treated as remote. */
function hostOf(raw) {
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

const host = hostOf(url);
const isLocal = host !== null && LOCAL_HOSTS.has(host);
const authorized = process.env.ALLOW_REMOTE_MIGRATE === '1';

if (!isLocal && !authorized) {
  const shown = host ?? '(unparseable URL)';
  console.error(
    `${TAG} Refusing to migrate a remote database: ${shown}\n` +
    `${TAG}\n` +
    `${TAG} drizzle-kit uses DATABASE_URL_UNPOOLED in preference to DATABASE_URL, so an\n` +
    `${TAG} env file holding both a localhost DATABASE_URL and a cloud DATABASE_URL_UNPOOLED\n` +
    `${TAG} resolves to the CLOUD one. That is almost certainly not what you meant.\n` +
    `${TAG}\n` +
    `${TAG} To migrate your local dev database:\n` +
    `${TAG}   DATABASE_URL_UNPOOLED= DATABASE_URL=postgresql://postgres:postgres@localhost:5434/oarly_dev pnpm db:migrate\n` +
    `${TAG}\n` +
    `${TAG} Production migrations run automatically during the Vercel production build\n` +
    `${TAG} (scripts/deploy-migrate.mjs) — you should not normally need to do this by hand.\n` +
    `${TAG} If you genuinely mean to migrate ${shown} right now, re-run with ALLOW_REMOTE_MIGRATE=1.`,
  );
  process.exit(1);
}

if (!isLocal) {
  console.warn(`${TAG} ALLOW_REMOTE_MIGRATE=1 — migrating REMOTE database ${host}.`);
} else {
  console.log(`${TAG} Migrating local database ${host}.`);
}

const bin = join(process.cwd(), 'node_modules', '.bin', 'drizzle-kit');
if (!existsSync(bin)) {
  console.error(`${TAG} drizzle-kit not found at ${bin} — run pnpm install.`);
  process.exit(1);
}

const result = spawnSync(bin, ['migrate'], { stdio: 'inherit' });
if (result.error) {
  console.error(`${TAG} Failed to run drizzle-kit:`, result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
