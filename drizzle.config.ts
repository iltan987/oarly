import 'dotenv/config';

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    // `||`, not `??`: an env var set to the empty string must fall through to the next
    // candidate, so `DATABASE_URL_UNPOOLED= DATABASE_URL=…local… pnpm db:migrate` targets
    // the local database instead of resolving to an empty URL. `scripts/deploy-migrate.mjs`
    // and `scripts/local-migrate.mjs` use the same precedence — keep all three in lockstep.
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '',
  },
});
