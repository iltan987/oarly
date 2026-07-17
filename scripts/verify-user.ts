import { config } from 'dotenv';

config({ path: ['.env.local', '.env'] }); // Next.js reads .env.local; plain dotenv/config would miss it

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/db/schema';

// Dev-only helper. Marks an already-signed-up user's email as VERIFIED so they
// can sign in without email delivery (local dev has no Resend key, and
// sendEmail only logs the subject — not the verification link).
//
// Unlike make-owner this grants NO role — the user stays a plain account, so
// it's the right tool for setting up a regular member to exercise the
// request-to-join -> owner-approval flow.
//
//   pnpm tsx scripts/verify-user.ts you@example.com
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — point it at the dev DB before running.');

  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage: pnpm tsx scripts/verify-user.ts <email>');

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  const [u] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (!u) throw new Error(`No user with email '${email}'. Sign up first, then re-run.`);

  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, u.id));

  console.log(`✓ ${email} is now email-verified. They can sign in.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
