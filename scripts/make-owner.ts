import { config } from 'dotenv';

config({ path: ['.env.local', '.env'] }); // Next.js reads .env.local; plain dotenv/config would miss it

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/db/schema';

// Dev-only helper. Promotes an already-signed-up user to a VERIFIED, APPROVED
// OWNER of a club (default slug `demo`) so the owner console at
// {slug}.localhost:3000/manage/* is reachable without email delivery / OAuth.
//
//   pnpm tsx scripts/make-owner.ts                     # print dev DB state
//   pnpm tsx scripts/make-owner.ts you@example.com     # promote for club `demo`
//   pnpm tsx scripts/make-owner.ts you@example.com bebek
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — point it at the dev DB before running.');

  const email = process.argv[2]?.trim().toLowerCase();
  const slug = process.argv[3]?.trim() ?? 'demo';

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  if (!email) {
    const clubs = await db.select({ slug: schema.clubs.slug, name: schema.clubs.name, status: schema.clubs.status }).from(schema.clubs);
    const users = await db.select({ email: schema.user.email, verified: schema.user.emailVerified }).from(schema.user);
    const mems = await db
      .select({ user: schema.user.email, club: schema.clubs.slug, role: schema.memberships.role, status: schema.memberships.status })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.memberships.userId, schema.user.id))
      .innerJoin(schema.clubs, eq(schema.memberships.clubId, schema.clubs.id));
    console.log('Usage: pnpm tsx scripts/make-owner.ts <email> [club-slug=demo]\n');
    console.log('clubs:      ', JSON.stringify(clubs));
    console.log('users:      ', JSON.stringify(users));
    console.log('memberships:', JSON.stringify(mems));
    await pool.end();
    return;
  }

  const [u] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (!u) throw new Error(`No user with email '${email}'. Sign up at localhost:3000/sign-up first, then re-run.`);

  const [club] = await db.select().from(schema.clubs).where(eq(schema.clubs.slug, slug)).limit(1);
  if (!club) throw new Error(`No club with slug '${slug}'. Run 'pnpm db:seed' (creates 'demo') or create one via /admin.`);

  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, u.id));

  const [existing] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, u.id), eq(schema.memberships.clubId, club.id)))
    .limit(1);

  if (existing) {
    await db.update(schema.memberships)
      .set({ role: 'owner', status: 'approved' })
      .where(eq(schema.memberships.id, existing.id));
  } else {
    await db.insert(schema.memberships).values({ userId: u.id, clubId: club.id, role: 'owner', status: 'approved' });
  }

  console.log(`✓ ${email} is now a verified, approved OWNER of '${slug}'.`);
  console.log(`  Sign in at localhost:3000/sign-in, then open ${slug}.localhost:3000/manage`);
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
