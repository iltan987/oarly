import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../src/db/schema';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — point it at the dev DB before seeding.');

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  const slug = 'demo';
  const existing = await db.select().from(schema.clubs).where(eq(schema.clubs.slug, slug)).limit(1);

  if (existing.length > 0) {
    console.log(`✓ club '${slug}' already exists — nothing to do`);
  } else {
    await db.insert(schema.clubs).values({
      slug,
      name: 'Demo Kürek Kulübü',
      status: 'active',
      brandAccent: '#2563eb',
    });
    console.log(`✓ seeded active club '${slug}'`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
