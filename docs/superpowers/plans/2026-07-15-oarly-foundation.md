# Oarly Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the substrate every Oarly feature builds on — a running Next.js 16 app with a fully-migrated Postgres schema, Better Auth (email/password + Google + verification + reset), i18n (TR default / EN), per-club theming on light/dark, a rate-limiter utility, and an app shell.

**Architecture:** Next.js 16 App Router at repo root (`app/`) with library code under `src/`. Drizzle ORM over the `pg` (node-postgres) driver against Neon Postgres (local Postgres for tests) — chosen over the Neon HTTP driver because later plans need interactive transactions (advisory locks, `SELECT … FOR UPDATE`). Better Auth owns identity in its `user`/`session`/`account`/`verification` tables; profile fields ride on `user` via `additionalFields`; all app tables reference the `text` `user.id`. i18n uses next-intl's *without-i18n-routing* mode (locale from cookie/`Accept-Language`) so it composes with subdomain-per-club tenancy (added in Plan 2). Theming is one Tailwind 4 CSS-variable token system; the per-club brand is a runtime-overridable `--club-accent` mapped into shadcn's `--primary`.

**Tech Stack:** Next.js 16.2.10, React 19.2.4, TypeScript, Tailwind CSS 4, shadcn/ui, Better Auth, Drizzle ORM + `pg`, Neon Postgres, Resend, next-intl, next-themes, Vitest, pnpm.

## Global Constraints

- Package manager is **pnpm**. Pin: `next@16.2.10`, `react@19.2.4`, `react-dom@19.2.4`.
- **Turkish (`tr`) is the default locale**, English (`en`) is the fallback. Every user-facing string goes through next-intl — no hardcoded copy in components.
- **Store all timestamps in UTC** (`timestamp with time zone`); display in the club timezone later. Default club timezone `Europe/Istanbul`.
- **Never add a `Co-Authored-By` / AI-attribution trailer to commit messages.**
- Auth session cookie must be shareable across `*.oarly.sbs` subdomains (`.oarly.sbs`); unset locally so `localhost` works.
- Member-facing payment labels: **"Nakit"** (regular) and **"MultiSport"** (do not translate "MultiSport").
- Library/app code lives under `src/` with the `@/*` → `./src/*` path alias; the Next `app/` directory stays at repo root.
- Tests must not require network/secrets by default: unit tests validate schema/logic in-process; DB integration tests run only when `TEST_DATABASE_URL` is set.

---

### Task 1: Project dependencies, tooling & test harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Modify: `tsconfig.json`
- Create: `src/lib/utils.ts`
- Create: `src/sanity.test.ts`

**Interfaces:**
- Produces: `cn(...inputs)` from `@/lib/utils`; `pnpm test` runs Vitest with `@/*` path resolution and `globals: true`.

- [ ] **Step 1: Install runtime and dev dependencies**

Run:
```bash
cd /home/icaner/projects/oarly
pnpm add drizzle-orm pg better-auth next-intl next-themes resend zod @upstash/ratelimit @upstash/redis @formatjs/intl-localematcher negotiator class-variance-authority clsx tailwind-merge lucide-react tw-animate-css
pnpm add -D drizzle-kit @better-auth/cli @types/pg @types/negotiator vitest vite-tsconfig-paths jsdom @testing-library/react @testing-library/jest-dom dotenv
```
Expected: dependencies added, no peer-dep errors that block install.

- [ ] **Step 2: Add scripts to `package.json`**

Merge these into the `"scripts"` block:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "auth:generate": "better-auth generate --config ./src/auth.ts --output ./src/db/schema/auth.ts"
  }
}
```

- [ ] **Step 3: Add the `@/*` path alias to `tsconfig.json`**

Ensure `compilerOptions` contains:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```
Keep every existing option the Next scaffold generated; only add `baseUrl`/`paths` if missing.

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

- [ ] **Step 5: Create `src/lib/utils.ts` (the shadcn `cn` helper)**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 6: Write the harness sanity test**

`src/sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('test harness', () => {
  it('resolves the @/ alias and merges classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
```

- [ ] **Step 7: Run the test — expect PASS**

Run: `pnpm test`
Expected: 1 passed. Confirms Vitest + `@/*` alias + `cn` work.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts src/lib/utils.ts src/sanity.test.ts
git commit -m "chore: add dependencies, vitest harness and cn util"
```

---

### Task 2: Environment validation (`src/env.ts`)

**Files:**
- Create: `src/env.ts`
- Create: `src/env.test.ts`
- Create: `.env.example`

**Interfaces:**
- Produces: `parseEnv(input: Record<string,string|undefined>): Env` and the eagerly-parsed `env: Env`. `Env` fields: `DATABASE_URL`, `DATABASE_URL_UNPOOLED?`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_URL`, `COOKIE_DOMAIN?`, `TRUSTED_ORIGINS: string[]`, `GOOGLE_CLIENT_ID?`, `GOOGLE_CLIENT_SECRET?`, `RESEND_API_KEY?`, `EMAIL_FROM?`, `UPSTASH_REDIS_REST_URL?`, `UPSTASH_REDIS_REST_TOKEN?`, `NODE_ENV`.

- [ ] **Step 1: Write the failing test**

`src/env.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseEnv } from '@/env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  BETTER_AUTH_SECRET: 'secret-value',
  BETTER_AUTH_URL: 'http://localhost:3000',
  APP_URL: 'http://localhost:3000',
};

describe('parseEnv', () => {
  it('parses a valid minimal env and defaults TRUSTED_ORIGINS to APP_URL', () => {
    const env = parseEnv(base);
    expect(env.DATABASE_URL).toBe(base.DATABASE_URL);
    expect(env.TRUSTED_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('splits TRUSTED_ORIGINS on commas', () => {
    const env = parseEnv({ ...base, TRUSTED_ORIGINS: 'https://a.com, https://b.com' });
    expect(env.TRUSTED_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
  });

  it('throws when a required var is missing', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/env.test.ts`
Expected: FAIL — cannot import `parseEnv` (module not found).

- [ ] **Step 3: Write `src/env.ts`**

```ts
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  APP_URL: z.string().url(),
  COOKIE_DOMAIN: z.string().optional(),
  TRUSTED_ORIGINS: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = Omit<z.infer<typeof schema>, 'TRUSTED_ORIGINS'> & {
  TRUSTED_ORIGINS: string[];
};

export function parseEnv(input: Record<string, string | undefined>): Env {
  const parsed = schema.parse(input);
  const origins = parsed.TRUSTED_ORIGINS
    ? parsed.TRUSTED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [parsed.APP_URL];
  return { ...parsed, TRUSTED_ORIGINS: origins };
}

export const env = parseEnv(process.env);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/env.test.ts`
Expected: PASS (3 tests). Note: importing `env` (the eager parse) is not exercised by the test — the test calls `parseEnv` directly so it never touches `process.env`.

- [ ] **Step 5: Create `.env.example`**

```bash
# Database (Neon pooled for the app; unpooled/direct for migrations)
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/oarly?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/oarly?sslmode=require"

# Auth
BETTER_AUTH_SECRET="run: openssl rand -base64 32"
BETTER_AUTH_URL="http://localhost:3000"
APP_URL="http://localhost:3000"
# COOKIE_DOMAIN=".oarly.sbs"   # leave unset locally
# TRUSTED_ORIGINS="https://oarly.sbs,https://*.oarly.sbs"

# Google OAuth (optional locally)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

# Email (optional locally — logs to console when unset)
RESEND_API_KEY=""
EMAIL_FROM="Oarly <no-reply@oarly.sbs>"

# Rate limiting (optional locally — in-memory when unset)
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""
```

- [ ] **Step 6: Commit**

```bash
git add src/env.ts src/env.test.ts .env.example
git commit -m "feat: add validated environment config"
```

---

### Task 3: Database client & Drizzle config

**Files:**
- Create: `src/db/index.ts`
- Create: `drizzle.config.ts`
- Create: `src/db/schema/index.ts` (empty re-export barrel for now)
- Create: `docker-compose.yml`
- Create: `src/db/index.test.ts`

**Interfaces:**
- Consumes: `env` from `@/env`.
- Produces: `db` (Drizzle client over a `pg` Pool) and `type DB` from `@/db`; `src/db/schema/index.ts` barrel that later schema tasks append to.

- [ ] **Step 1: Create the schema barrel (empty for now)**

`src/db/schema/index.ts`:
```ts
// Re-exports every schema module. Populated by Tasks 4–11.
export {};
```

- [ ] **Step 2: Create the db client**

`src/db/index.ts`:
```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '@/env';
import * as schema from './schema';

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export type DB = typeof db;
```

- [ ] **Step 3: Create `drizzle.config.ts`**

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '',
  },
});
```

- [ ] **Step 4: Create `docker-compose.yml` for the test database**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: oarly_test
    ports:
      - '5433:5432'
```

- [ ] **Step 5: Write the config test**

`src/db/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import config from '../../drizzle.config';

describe('drizzle config', () => {
  it('targets postgresql and the schema barrel', () => {
    expect(config.dialect).toBe('postgresql');
    expect(config.schema).toBe('./src/db/schema/index.ts');
    expect(config.out).toBe('./drizzle');
  });
});
```

- [ ] **Step 6: Run test — expect PASS**

Run: `pnpm test src/db/index.test.ts`
Expected: PASS. (We do not import `@/db` here — it opens a Pool; that is exercised by the integration test in Task 12.)

- [ ] **Step 7: Commit**

```bash
git add src/db/index.ts src/db/schema/index.ts drizzle.config.ts docker-compose.yml src/db/index.test.ts
git commit -m "feat: add drizzle db client, config and test database compose"
```

---

### Task 4: Shared enums

**Files:**
- Create: `src/db/schema/enums.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/schema/enums.test.ts`

**Interfaces:**
- Produces: pgEnums consumed by every later schema module — `paymentTypeEnum`, `clubStatusEnum`, `multisportModeEnum`, `bookingOpenModeEnum`, `noshowPenaltyEnum`, `headingFontEnum`, `membershipRoleEnum`, `membershipStatusEnum`, `allowedPaymentEnum`, `slotStatusEnum`, `sessionStatusEnum`, `bookingStatusEnum`, `bookingSourceEnum`, `holidaySourceEnum`, `holidayStatusEnum`, `notificationTypeEnum`.

- [ ] **Step 1: Write the failing test**

`src/db/schema/enums.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  paymentTypeEnum,
  noshowPenaltyEnum,
  bookingStatusEnum,
  allowedPaymentEnum,
} from '@/db/schema/enums';

describe('enums', () => {
  it('payment types are regular|multisport', () => {
    expect(paymentTypeEnum.enumValues).toEqual(['regular', 'multisport']);
  });
  it('no-show penalties match the spec', () => {
    expect(noshowPenaltyEnum.enumValues).toEqual(['off', '2d', '1w', '2w', '1m', 'never']);
  });
  it('booking statuses include waitlisted and attendance outcomes', () => {
    expect(bookingStatusEnum.enumValues).toEqual([
      'booked', 'waitlisted', 'cancelled', 'no_show', 'attended',
    ]);
  });
  it('allowed payment expresses boat eligibility', () => {
    expect(allowedPaymentEnum.enumValues).toEqual(['regular_only', 'multisport_only', 'both']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/db/schema/enums.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/schema/enums.ts`**

```ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const paymentTypeEnum = pgEnum('payment_type', ['regular', 'multisport']);
export const clubStatusEnum = pgEnum('club_status', ['pending', 'active', 'suspended']);
export const multisportModeEnum = pgEnum('multisport_mode', ['equal', 'priority']);
export const bookingOpenModeEnum = pgEnum('booking_open_mode', ['always', 'lead']);
export const noshowPenaltyEnum = pgEnum('noshow_penalty', ['off', '2d', '1w', '2w', '1m', 'never']);
export const headingFontEnum = pgEnum('heading_font', ['default', 'premium']);
export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'member']);
export const membershipStatusEnum = pgEnum('membership_status', ['pending', 'approved', 'rejected', 'banned']);
export const allowedPaymentEnum = pgEnum('allowed_payment', ['regular_only', 'multisport_only', 'both']);
export const slotStatusEnum = pgEnum('slot_status', ['scheduled', 'open', 'closed', 'cancelled']);
export const sessionStatusEnum = pgEnum('session_status', ['open', 'closed', 'cancelled']);
export const bookingStatusEnum = pgEnum('booking_status', ['booked', 'waitlisted', 'cancelled', 'no_show', 'attended']);
export const bookingSourceEnum = pgEnum('booking_source', ['member', 'owner', 'admin_prereservation']);
export const holidaySourceEnum = pgEnum('holiday_source', ['auto', 'manual']);
export const holidayStatusEnum = pgEnum('holiday_status', ['pending', 'approved']);
export const notificationTypeEnum = pgEnum('notification_type', [
  'booking_confirmation', 'waitlist_promotion', 'displaced', 'cancellation', 'reminder',
]);
```

- [ ] **Step 4: Re-export from the barrel**

Replace the contents of `src/db/schema/index.ts` with:
```ts
export * from './enums';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/db/schema/enums.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/enums.ts src/db/schema/index.ts src/db/schema/enums.test.ts
git commit -m "feat: add shared postgres enums"
```

---

### Task 5: Auth schema (Better Auth tables)

**Files:**
- Create: `src/db/schema/auth.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/schema/auth.test.ts`

**Interfaces:**
- Consumes: `paymentTypeEnum` from `./enums`.
- Produces: `user`, `session`, `account`, `verification`. `user.id` is `text` (Better Auth id); every app table FKs to it. `user` carries profile columns (`firstName`, `lastName`, `phone`, `birthday`, `gender`, `defaultPaymentType`, `locale`, `theme`, `isAdmin`).

> **Note:** These columns match Better Auth's Drizzle conventions plus the `additionalFields` declared in Task 14. If you bump Better Auth and its expected columns change, regenerate with `pnpm auth:generate` and reconcile.

- [ ] **Step 1: Write the failing test**

`src/db/schema/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { user, session, account, verification } from '@/db/schema/auth';

describe('auth schema', () => {
  it('user has a text primary key and profile columns', () => {
    const cfg = getTableConfig(user);
    const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(cols['id'].primary).toBe(true);
    expect(cols['id'].dataType).toBe('string');
    expect(cols['email'].isUnique).toBe(true);
    for (const name of ['first_name', 'last_name', 'phone', 'default_payment_type', 'is_admin']) {
      expect(cols[name]).toBeDefined();
    }
  });

  it('session/account reference the user', () => {
    expect(getTableConfig(session).foreignKeys.length).toBeGreaterThan(0);
    expect(getTableConfig(account).foreignKeys.length).toBeGreaterThan(0);
    expect(getTableConfig(verification).columns.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/db/schema/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/schema/auth.ts`**

```ts
import { pgTable, text, timestamp, boolean, date } from 'drizzle-orm/pg-core';
import { paymentTypeEnum } from './enums';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // profile (Better Auth additionalFields — see Task 14)
  firstName: text('first_name'),
  lastName: text('last_name'),
  phone: text('phone'),
  birthday: date('birthday'),
  gender: text('gender'),
  defaultPaymentType: paymentTypeEnum('default_payment_type').notNull().default('regular'),
  locale: text('locale').notNull().default('tr'),
  theme: text('theme').notNull().default('system'),
  isAdmin: boolean('is_admin').notNull().default(false),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Re-export from the barrel**

Append to `src/db/schema/index.ts`:
```ts
export * from './auth';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/db/schema/auth.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/auth.ts src/db/schema/index.ts src/db/schema/auth.test.ts
git commit -m "feat: add better-auth schema with profile fields"
```

---

### Task 6: Profile & KVKK schema (user_socials, consents)

**Files:**
- Create: `src/db/schema/profile.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/schema/profile.test.ts`

**Interfaces:**
- Consumes: `user` from `./auth`.
- Produces: `userSocials`, `consents` (KVKK consent records: `document`, `version`, `acceptedAt`).

- [ ] **Step 1: Write the failing test**

`src/db/schema/profile.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { userSocials, consents } from '@/db/schema/profile';

describe('profile schema', () => {
  it('user_socials FKs to user', () => {
    expect(getTableConfig(userSocials).foreignKeys.length).toBe(1);
  });
  it('consents records document + version + accepted_at', () => {
    const cols = getTableConfig(consents).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['user_id', 'document', 'version', 'accepted_at']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/db/schema/profile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/schema/profile.ts`**

```ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

export const userSocials = pgTable('user_socials', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  handle: text('handle').notNull(),
});

export const consents = pgTable('consents', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  document: text('document').notNull(),
  version: text('version').notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Re-export from the barrel**

Append to `src/db/schema/index.ts`:
```ts
export * from './profile';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/db/schema/profile.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/profile.ts src/db/schema/index.ts src/db/schema/profile.test.ts
git commit -m "feat: add user socials and KVKK consent schema"
```

---

### Task 7: Clubs, memberships & skill levels schema

**Files:**
- Create: `src/db/schema/clubs.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/schema/clubs.test.ts`

**Interfaces:**
- Consumes: `user` (`./auth`); enums `clubStatusEnum`, `multisportModeEnum`, `bookingOpenModeEnum`, `noshowPenaltyEnum`, `headingFontEnum`, `membershipRoleEnum`, `membershipStatusEnum`.
- Produces: `clubs`, `clubSocials`, `skillLevels`, `memberships`. `clubs.id` and `skillLevels.id` and `memberships.id` are `uuid`. `memberships` has a unique `(user_id, club_id)`.

- [ ] **Step 1: Write the failing test**

`src/db/schema/clubs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { clubs, memberships, skillLevels } from '@/db/schema/clubs';

describe('clubs schema', () => {
  it('clubs has a unique slug and policy columns', () => {
    const cfg = getTableConfig(clubs);
    const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(cols['slug'].isUnique).toBe(true);
    for (const name of ['multisport_mode', 'booking_open_mode', 'noshow_penalty', 'brand_accent', 'timezone']) {
      expect(cols[name]).toBeDefined();
    }
  });

  it('memberships enforce one row per (user, club)', () => {
    const cfg = getTableConfig(memberships);
    const uq = cfg.indexes.find((i) => i.config.unique);
    expect(uq).toBeDefined();
    expect(uq!.config.columns.map((c: any) => c.name).sort()).toEqual(['club_id', 'user_id']);
  });

  it('skill levels order by rank within a club', () => {
    const cols = getTableConfig(skillLevels).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['club_id', 'name', 'rank']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/db/schema/clubs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/schema/clubs.ts`**

```ts
import {
  pgTable, uuid, text, integer, boolean, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import {
  clubStatusEnum, multisportModeEnum, bookingOpenModeEnum,
  noshowPenaltyEnum, headingFontEnum, membershipRoleEnum, membershipStatusEnum,
} from './enums';

export const clubs = pgTable('clubs', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  logoUrl: text('logo_url'),
  phone: text('phone'),
  timezone: text('timezone').notNull().default('Europe/Istanbul'),
  status: clubStatusEnum('status').notNull().default('pending'),
  multisportMode: multisportModeEnum('multisport_mode').notNull().default('equal'),
  bookingOpenMode: bookingOpenModeEnum('booking_open_mode').notNull().default('always'),
  bookingOpenLeadDays: integer('booking_open_lead_days'),
  selfCancelEnabled: boolean('self_cancel_enabled').notNull().default(true),
  cancelCutoffHours: integer('cancel_cutoff_hours'),
  noshowPenalty: noshowPenaltyEnum('noshow_penalty').notNull().default('off'),
  openOnHolidays: boolean('open_on_holidays').notNull().default(false),
  brandAccent: text('brand_accent'),
  headingFont: headingFontEnum('heading_font').notNull().default('default'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clubSocials = pgTable('club_socials', {
  id: uuid('id').defaultRandom().primaryKey(),
  clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  handle: text('handle').notNull(),
});

export const skillLevels = pgTable(
  'skill_levels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    rank: integer('rank').notNull(),
  },
  (t) => [uniqueIndex('skill_levels_club_rank_uq').on(t.clubId, t.rank)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull().default('member'),
    status: membershipStatusEnum('status').notNull().default('pending'),
    bannedUntil: timestamp('banned_until', { withTimezone: true }),
    skillLevelId: uuid('skill_level_id').references(() => skillLevels.id, { onDelete: 'set null' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('memberships_user_club_uq').on(t.userId, t.clubId)],
);
```

- [ ] **Step 4: Re-export from the barrel**

Append to `src/db/schema/index.ts`:
```ts
export * from './clubs';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/db/schema/clubs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/clubs.ts src/db/schema/index.ts src/db/schema/clubs.test.ts
git commit -m "feat: add clubs, memberships and skill levels schema"
```

---

### Task 8: Boat types schema

**Files:**
- Create: `src/db/schema/boats.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/schema/boats.test.ts`

**Interfaces:**
- Consumes: `clubs`, `skillLevels` (`./clubs`); `allowedPaymentEnum` (`./enums`).
- Produces: `boatTypes` (`seats` = capacity, `minSkillLevelId?`, `allowedPayment`, `minAttendance?`, `active`).

- [ ] **Step 1: Write the failing test**

`src/db/schema/boats.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { boatTypes } from '@/db/schema/boats';

describe('boat_types schema', () => {
  it('carries seats, allowed_payment and optional min skill/attendance', () => {
    const cfg = getTableConfig(boatTypes);
    const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(cols['seats'].notNull).toBe(true);
    expect(cols['allowed_payment']).toBeDefined();
    expect(cols['min_skill_level_id'].notNull).toBe(false);
    expect(cols['min_attendance'].notNull).toBe(false);
  });
  it('references its club and (optionally) a skill level', () => {
    expect(getTableConfig(boatTypes).foreignKeys.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/db/schema/boats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/schema/boats.ts`**

```ts
import { pgTable, uuid, text, integer, boolean } from 'drizzle-orm/pg-core';
import { clubs, skillLevels } from './clubs';
import { allowedPaymentEnum } from './enums';

export const boatTypes = pgTable('boat_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  seats: integer('seats').notNull(),
  minSkillLevelId: uuid('min_skill_level_id').references(() => skillLevels.id, { onDelete: 'set null' }),
  allowedPayment: allowedPaymentEnum('allowed_payment').notNull().default('both'),
  minAttendance: integer('min_attendance'),
  active: boolean('active').notNull().default(true),
});
```

- [ ] **Step 4: Re-export from the barrel**

Append to `src/db/schema/index.ts`:
```ts
export * from './boats';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/db/schema/boats.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/boats.ts src/db/schema/index.ts src/db/schema/boats.test.ts
git commit -m "feat: add boat types schema"
```

---

### Task 9: Schedule schema (windows, window_boats, slots, sessions)

**Files:**
- Create: `src/db/schema/schedule.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/schema/schedule.test.ts`

**Interfaces:**
- Consumes: `clubs` (`./clubs`), `boatTypes` (`./boats`); `slotStatusEnum`, `sessionStatusEnum` (`./enums`).
- Produces: `scheduleWindows` (`weekday`, `startTime`, `endTime`, `defaultSessionMinutes`), `windowBoats` (`quantity`), `slots` (`date`, `startAt`, `endAt`, `status`), `sessions` (`capacity`, `minAttendance?`, `status`, `isOverride`).

- [ ] **Step 1: Write the failing test**

`src/db/schema/schedule.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { scheduleWindows, windowBoats, slots, sessions } from '@/db/schema/schedule';

describe('schedule schema', () => {
  it('windows store weekday and session length', () => {
    const cols = getTableConfig(scheduleWindows).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['weekday', 'start_time', 'end_time', 'default_session_minutes']));
  });
  it('window_boats set quantity per boat type', () => {
    const cols = getTableConfig(windowBoats).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['window_id', 'boat_type_id', 'quantity']));
  });
  it('slots carry UTC start/end and a status', () => {
    const cols = Object.fromEntries(getTableConfig(slots).columns.map((c) => [c.name, c]));
    expect(cols['start_at'].notNull).toBe(true);
    expect(cols['status']).toBeDefined();
  });
  it('sessions carry capacity and override flag', () => {
    const cols = Object.fromEntries(getTableConfig(sessions).columns.map((c) => [c.name, c]));
    expect(cols['capacity'].notNull).toBe(true);
    expect(cols['is_override']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/db/schema/schedule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/schema/schedule.ts`**

```ts
import {
  pgTable, uuid, integer, boolean, date, time, timestamp, index,
} from 'drizzle-orm/pg-core';
import { clubs } from './clubs';
import { boatTypes } from './boats';
import { slotStatusEnum, sessionStatusEnum } from './enums';

export const scheduleWindows = pgTable('schedule_windows', {
  id: uuid('id').defaultRandom().primaryKey(),
  clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  weekday: integer('weekday').notNull(), // 0 = Sunday … 6 = Saturday
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  defaultSessionMinutes: integer('default_session_minutes').notNull(),
});

export const windowBoats = pgTable('window_boats', {
  id: uuid('id').defaultRandom().primaryKey(),
  windowId: uuid('window_id').notNull().references(() => scheduleWindows.id, { onDelete: 'cascade' }),
  boatTypeId: uuid('boat_type_id').notNull().references(() => boatTypes.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull().default(1),
});

export const slots = pgTable(
  'slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    fromWindowId: uuid('from_window_id').references(() => scheduleWindows.id, { onDelete: 'set null' }),
    status: slotStatusEnum('status').notNull().default('scheduled'),
  },
  (t) => [
    index('slots_club_start_idx').on(t.clubId, t.startAt),
    index('slots_status_idx').on(t.status),
  ],
);

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  slotId: uuid('slot_id').notNull().references(() => slots.id, { onDelete: 'cascade' }),
  clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  boatTypeId: uuid('boat_type_id').notNull().references(() => boatTypes.id, { onDelete: 'restrict' }),
  capacity: integer('capacity').notNull(),
  minAttendance: integer('min_attendance'),
  status: sessionStatusEnum('status').notNull().default('open'),
  isOverride: boolean('is_override').notNull().default(false),
});
```

- [ ] **Step 4: Re-export from the barrel**

Append to `src/db/schema/index.ts`:
```ts
export * from './schedule';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/db/schema/schedule.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/schedule.ts src/db/schema/index.ts src/db/schema/schedule.test.ts
git commit -m "feat: add schedule windows, slots and sessions schema"
```

---

### Task 10: Bookings & penalties schema (partial unique index)

**Files:**
- Create: `src/db/schema/bookings.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/schema/bookings.test.ts`

**Interfaces:**
- Consumes: `user` (`./auth`), `clubs`, `memberships` (`./clubs`), `sessions` (`./schedule`); `paymentTypeEnum`, `bookingStatusEnum`, `bookingSourceEnum` (`./enums`).
- Produces: `bookings` (with active-status partial unique index on `(session_id, user_id)`, and an idempotency partial unique index) and `penalties`. `bookings.userId` is nullable (guest bookings).

- [ ] **Step 1: Write the failing test**

`src/db/schema/bookings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { bookings, penalties } from '@/db/schema/bookings';

describe('bookings schema', () => {
  const cfg = getTableConfig(bookings);

  it('allows guest bookings (nullable user_id) and records payment/source', () => {
    const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(cols['user_id'].notNull).toBe(false);
    expect(cols['payment_type'].notNull).toBe(true);
    expect(cols['effective_at'].notNull).toBe(true);
    expect(cols['hidden']).toBeDefined();
    expect(cols['source']).toBeDefined();
  });

  it('has an active-status partial unique index on (session_id, user_id)', () => {
    const idx = cfg.indexes.find((i) => i.config.name === 'bookings_active_uq');
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(true);
    expect(idx!.config.where).toBeDefined();
    expect(idx!.config.columns.map((c: any) => c.name).sort()).toEqual(['session_id', 'user_id']);
  });

  it('has an idempotency partial unique index', () => {
    const idx = cfg.indexes.find((i) => i.config.name === 'bookings_idem_uq');
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(true);
    expect(idx!.config.where).toBeDefined();
  });

  it('penalties link a membership and record ban expiry', () => {
    const cols = getTableConfig(penalties).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['membership_id', 'reason', 'banned_until']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/db/schema/bookings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/schema/bookings.ts`**

```ts
import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, integer, boolean, timestamp, uniqueIndex, index,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { clubs, memberships } from './clubs';
import { sessions } from './schedule';
import { paymentTypeEnum, bookingStatusEnum, bookingSourceEnum } from './enums';

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    paymentType: paymentTypeEnum('payment_type').notNull(),
    status: bookingStatusEnum('status').notNull().default('booked'),
    queuePosition: integer('queue_position'),
    slotIndex: integer('slot_index'),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    source: bookingSourceEnum('source').notNull().default('member'),
    hidden: boolean('hidden').notNull().default(false),
    guestName: text('guest_name'),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One active seat per user per session (guests have null user_id → not constrained).
    uniqueIndex('bookings_active_uq')
      .on(t.sessionId, t.userId)
      .where(sql`${t.status} in ('booked', 'waitlisted')`),
    // A retry with the same idempotency key never creates a second booking.
    uniqueIndex('bookings_idem_uq')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('bookings_session_status_idx').on(t.sessionId, t.status),
  ],
);

export const penalties = pgTable('penalties', {
  id: uuid('id').defaultRandom().primaryKey(),
  membershipId: uuid('membership_id').notNull().references(() => memberships.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  bannedUntil: timestamp('banned_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Re-export from the barrel**

Append to `src/db/schema/index.ts`:
```ts
export * from './bookings';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/db/schema/bookings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/bookings.ts src/db/schema/index.ts src/db/schema/bookings.test.ts
git commit -m "feat: add bookings and penalties schema with concurrency indexes"
```

---

### Task 11: Holidays, overrides, notifications & audit schema

**Files:**
- Create: `src/db/schema/holidays.ts`
- Create: `src/db/schema/system.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/schema/system.test.ts`

**Interfaces:**
- Consumes: `user` (`./auth`), `clubs` (`./clubs`), `sessions` (`./schedule`); `holidaySourceEnum`, `holidayStatusEnum`, `membershipRoleEnum`, `notificationTypeEnum` (`./enums`).
- Produces: `holidays`, `clubHolidayOverrides`, `notifications` (idempotent send log), `auditLog` (`actorUserId`, `actingAsRole?`, `action`, `target?`).

- [ ] **Step 1: Write the failing test**

`src/db/schema/system.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { holidays, clubHolidayOverrides } from '@/db/schema/holidays';
import { notifications, auditLog } from '@/db/schema/system';

describe('holidays & system schema', () => {
  it('holidays record source and approval status', () => {
    const cols = getTableConfig(holidays).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['date', 'name', 'source', 'status', 'year']));
  });
  it('overrides are unique per (club, date)', () => {
    const uq = getTableConfig(clubHolidayOverrides).indexes.find((i) => i.config.unique);
    expect(uq).toBeDefined();
    expect(uq!.config.columns.map((c: any) => c.name).sort()).toEqual(['club_id', 'date']);
  });
  it('notifications are unique per (user, type, session) for idempotency', () => {
    const uq = getTableConfig(notifications).indexes.find((i) => i.config.name === 'notifications_idem_uq');
    expect(uq).toBeDefined();
    expect(uq!.config.unique).toBe(true);
  });
  it('audit_log records the acting role', () => {
    const cols = getTableConfig(auditLog).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['actor_user_id', 'acting_as_role', 'action']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/db/schema/system.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/schema/holidays.ts`**

```ts
import { pgTable, uuid, text, integer, boolean, date, uniqueIndex } from 'drizzle-orm/pg-core';
import { clubs } from './clubs';
import { holidaySourceEnum, holidayStatusEnum } from './enums';

export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    date: date('date').notNull(),
    name: text('name').notNull(),
    source: holidaySourceEnum('source').notNull().default('auto'),
    status: holidayStatusEnum('status').notNull().default('pending'),
    year: integer('year').notNull(),
  },
  (t) => [uniqueIndex('holidays_date_name_uq').on(t.date, t.name)],
);

export const clubHolidayOverrides = pgTable(
  'club_holiday_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    isOpen: boolean('is_open').notNull(),
  },
  (t) => [uniqueIndex('club_holiday_overrides_club_date_uq').on(t.clubId, t.date)],
);
```

- [ ] **Step 4: Write `src/db/schema/system.ts`**

```ts
import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { clubs } from './clubs';
import { sessions } from './schedule';
import { membershipRoleEnum, notificationTypeEnum } from './enums';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    type: notificationTypeEnum('type').notNull(),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notifications_idem_uq').on(t.userId, t.type, t.sessionId)],
);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
  actingAsRole: membershipRoleEnum('acting_as_role'),
  clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  target: text('target'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 5: Re-export from the barrel**

Append to `src/db/schema/index.ts`:
```ts
export * from './holidays';
export * from './system';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/db/schema/system.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the full unit suite**

Run: `pnpm test`
Expected: all schema + env + sanity tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/holidays.ts src/db/schema/system.ts src/db/schema/index.ts src/db/schema/system.test.ts
git commit -m "feat: add holidays, notifications and audit log schema"
```

---

### Task 12: Initial migration & DB round-trip (integration)

**Files:**
- Create: `drizzle/` (generated migration output)
- Create: `src/db/roundtrip.integration.test.ts`

**Interfaces:**
- Consumes: the full schema barrel `@/db/schema`.
- Produces: a committed initial migration under `drizzle/` that applies cleanly and supports insert/select round-trips.

- [ ] **Step 1: Generate the initial migration**

Run:
```bash
pnpm db:generate
```
Expected: a new SQL file appears in `drizzle/` (e.g. `0000_*.sql`) plus `drizzle/meta/`. It should contain `CREATE TYPE` for every enum, `CREATE TABLE` for all 18 tables, and `CREATE UNIQUE INDEX ... WHERE ...` for `bookings_active_uq` and `bookings_idem_uq`.

- [ ] **Step 2: Inspect the generated SQL for the partial indexes**

Run: `grep -n "WHERE" drizzle/0000_*.sql`
Expected: lines showing the partial `WHERE status in ('booked', 'waitlisted')` and `WHERE idempotency_key is not null` clauses. If absent, the schema `.where()` didn't serialize — stop and fix Task 10 before continuing.

- [ ] **Step 3: Start the test database**

Run:
```bash
docker compose up -d postgres
```
Expected: `postgres` container running on `localhost:5433`. (If Docker is unavailable, point `TEST_DATABASE_URL` at any throwaway Postgres 16 and skip this step.)

- [ ] **Step 4: Write the integration test**

`src/db/roundtrip.integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from '@/db/schema';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('db round-trip', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('inserts and reads a club with default policy values', async () => {
    const [club] = await db
      .insert(schema.clubs)
      .values({ slug: `c-${Date.now()}`, name: 'Test Club' })
      .returning();
    expect(club.status).toBe('pending');
    expect(club.multisportMode).toBe('equal');
    expect(club.timezone).toBe('Europe/Istanbul');
  });

  it('enforces the active-booking unique index', async () => {
    const [club] = await db.insert(schema.clubs).values({ slug: `c2-${Date.now()}`, name: 'C2' }).returning();
    const [u] = await db.insert(schema.user).values({
      id: `u-${Date.now()}`, name: 'A', email: `a-${Date.now()}@t.co`,
    }).returning();
    const [bt] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 4 }).returning();
    const [slot] = await db.insert(schema.slots).values({
      clubId: club.id, date: '2026-08-01', startAt: new Date(), endAt: new Date(),
    }).returning();
    const [sess] = await db.insert(schema.sessions).values({
      slotId: slot.id, clubId: club.id, boatTypeId: bt.id, capacity: 4,
    }).returning();

    await db.insert(schema.bookings).values({
      sessionId: sess.id, clubId: club.id, userId: u.id, paymentType: 'regular', effectiveAt: new Date(),
    });
    await expect(
      db.insert(schema.bookings).values({
        sessionId: sess.id, clubId: club.id, userId: u.id, paymentType: 'regular', effectiveAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run the integration test — expect PASS**

Run: `pnpm test:integration`
Expected: 2 passed. Confirms migrations apply and the active-booking unique index rejects a duplicate seat. (Without `TEST_DATABASE_URL`, `pnpm test` skips this file.)

- [ ] **Step 6: Commit**

```bash
git add drizzle src/db/roundtrip.integration.test.ts
git commit -m "feat: generate initial migration and verify db round-trip"
```

---

### Task 13: Email sender (Resend)

**Files:**
- Create: `src/lib/email.ts`
- Create: `src/lib/email.test.ts`

**Interfaces:**
- Consumes: `env` (`@/env`).
- Produces: `sendEmail(input: SendEmailInput): Promise<void>` where `SendEmailInput = { to: string; subject: string; html?: string; text?: string; attachments?: { filename: string; content: string | Buffer }[] }`. When `RESEND_API_KEY` is unset it logs to console instead of sending (dev/test).

- [ ] **Step 1: Write the failing test**

`src/lib/email.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

describe('sendEmail', () => {
  beforeEach(() => { sendMock.mockReset(); });

  it('logs instead of sending when no API key is configured', async () => {
    vi.resetModules();
    vi.doMock('@/env', () => ({ env: { RESEND_API_KEY: undefined, EMAIL_FROM: undefined } }));
    const { sendEmail } = await import('@/lib/email');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendEmail({ to: 'x@y.co', subject: 'Hi', text: 'body' });
    expect(spy).toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('calls Resend when a key is configured', async () => {
    vi.resetModules();
    vi.doMock('@/env', () => ({ env: { RESEND_API_KEY: 'key', EMAIL_FROM: 'Oarly <no-reply@oarly.sbs>' } }));
    const { sendEmail } = await import('@/lib/email');
    await sendEmail({ to: 'x@y.co', subject: 'Hi', text: 'body' });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Oarly <no-reply@oarly.sbs>', to: 'x@y.co', subject: 'Hi',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/email.test.ts`
Expected: FAIL — `@/lib/email` not found.

- [ ] **Step 3: Write `src/lib/email.ts`**

```ts
import { Resend } from 'resend';
import { env } from '@/env';

export type SendEmailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: { filename: string; content: string | Buffer }[];
};

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.log('[email:dev]', { to: input.to, subject: input.subject });
    return;
  }
  const resend = new Resend(env.RESEND_API_KEY);
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html ?? undefined,
    text: input.text ?? undefined,
    attachments: input.attachments,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/email.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts src/lib/email.test.ts
git commit -m "feat: add resend email sender with dev console fallback"
```

---

### Task 14: Better Auth server, client & route handler

**Files:**
- Create: `src/auth.ts`
- Create: `src/auth-client.ts`
- Create: `app/api/auth/[...all]/route.ts`
- Create: `src/auth.integration.test.ts`

**Interfaces:**
- Consumes: `db` (`@/db`), `* as schema` (`@/db/schema`), `sendEmail` (`@/lib/email`), `env` (`@/env`).
- Produces: `auth` (Better Auth server instance) from `@/auth`; `authClient`, `signIn`, `signUp`, `signOut`, `useSession` from `@/auth-client`; the mounted `GET`/`POST` route handler.

- [ ] **Step 1: Write `src/auth.ts`**

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email';
import { env } from '@/env';

const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Oarly — Şifre sıfırlama / Reset your password',
        text: `Şifrenizi sıfırlamak için tıklayın / Reset your password: ${url}`,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Oarly — E-posta doğrulama / Verify your email',
        text: `E-postanızı doğrulamak için tıklayın / Verify your email: ${url}`,
      });
    },
  },

  ...(googleEnabled
    ? {
        socialProviders: {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            mapProfileToUser: (profile: { given_name?: string; family_name?: string }) => ({
              firstName: profile.given_name,
              lastName: profile.family_name,
            }),
          },
        },
      }
    : {}),

  user: {
    additionalFields: {
      firstName: { type: 'string', required: false },
      lastName: { type: 'string', required: false },
      phone: { type: 'string', required: false },
      birthday: { type: 'date', required: false },
      gender: { type: 'string', required: false },
      defaultPaymentType: { type: 'string', required: false, defaultValue: 'regular' },
      locale: { type: 'string', required: false, defaultValue: 'tr' },
      theme: { type: 'string', required: false, defaultValue: 'system' },
      isAdmin: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
  },

  advanced: env.COOKIE_DOMAIN
    ? { crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } }
    : {},

  trustedOrigins: env.TRUSTED_ORIGINS,

  // Built-in per-endpoint limiter (our own limiter — Task 15 — covers app routes).
  rateLimit: { enabled: true, window: 60, max: 100 },

  plugins: [nextCookies()], // MUST be last
});
```

- [ ] **Step 2: Write `src/auth-client.ts`**

```ts
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
```

- [ ] **Step 3: Write the route handler**

`app/api/auth/[...all]/route.ts`:
```ts
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/auth';

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 4: Reconcile the generated schema (guard against drift)**

Run:
```bash
pnpm auth:generate
```
Expected: the CLI reads `src/auth.ts` and writes `src/db/schema/auth.ts`. Review the diff with `git diff src/db/schema/auth.ts`. It should match the hand-written schema from Task 5 (same columns/types). If it differs, adopt the generated version, re-run `pnpm test src/db/schema/auth.test.ts`, and if columns changed, regenerate the migration (`pnpm db:generate`) and re-run Task 12's integration test.

- [ ] **Step 5: Write the sign-up integration test**

`src/auth.integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('auth sign-up', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await migrate(drizzle(pool, { schema }), { migrationsFolder: './drizzle' });
  });
  afterAll(async () => { await pool.end(); });

  it('creates a user row via the auth API', async () => {
    process.env.DATABASE_URL = url;
    process.env.BETTER_AUTH_SECRET ??= 'test-secret';
    process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
    process.env.APP_URL ??= 'http://localhost:3000';
    const { auth } = await import('@/auth');
    const email = `signup-${Date.now()}@test.co`;
    await auth.api.signUpEmail({
      body: { email, password: 'Passw0rd!123', name: 'Test User' },
    });
    const db = drizzle(pool, { schema });
    const rows = await db.select().from(schema.user).where(eq(schema.user.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0].locale).toBe('tr');
  });
});
```

- [ ] **Step 6: Run the integration test — expect PASS**

Run: `pnpm test:integration src/auth.integration.test.ts`
Expected: PASS. Confirms Better Auth writes to our schema (user row created, `locale` defaulted to `tr`). If `signUpEmail`'s argument shape differs in the installed Better Auth version, adjust to the version's server-API signature (the behavior — a user row is created — is what matters).

- [ ] **Step 7: Commit**

```bash
git add src/auth.ts src/auth-client.ts app/api/auth src/db/schema/auth.ts src/auth.integration.test.ts
git commit -m "feat: wire better-auth server, client and route handler"
```

---

### Task 15: Rate limiter utility

**Files:**
- Create: `src/lib/rate-limit-config.ts`
- Create: `src/lib/rate-limit.ts`
- Create: `src/lib/rate-limit.test.ts`

**Interfaces:**
- Consumes: `env` (`@/env`).
- Produces: `RATE_LIMITS` (spec thresholds) from `@/lib/rate-limit-config`; `rateLimit(key: string, rule: RateRule, now?: number): Promise<{ success: boolean; remaining: number }>` from `@/lib/rate-limit`, where `RateRule = { limit: number; windowSec: number }`. Uses Upstash when configured, else an in-memory fixed-window store.

- [ ] **Step 1: Write the failing test**

`src/lib/rate-limit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { rateLimit } from '@/lib/rate-limit';

describe('rateLimit (in-memory)', () => {
  it('allows up to the limit then blocks within the window', async () => {
    const rule = { limit: 3, windowSec: 60 };
    const key = `k-${Math.random()}`;
    const t0 = 1_000_000;
    expect((await rateLimit(key, rule, t0)).success).toBe(true);
    expect((await rateLimit(key, rule, t0)).success).toBe(true);
    expect((await rateLimit(key, rule, t0)).success).toBe(true);
    const blocked = await rateLimit(key, rule, t0);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets after the window elapses', async () => {
    const rule = { limit: 1, windowSec: 60 };
    const key = `k-${Math.random()}`;
    expect((await rateLimit(key, rule, 1_000_000)).success).toBe(true);
    expect((await rateLimit(key, rule, 1_000_000)).success).toBe(false);
    expect((await rateLimit(key, rule, 1_000_000 + 61_000)).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/rate-limit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/rate-limit-config.ts`**

```ts
export type RateRule = { limit: number; windowSec: number };

// Thresholds from the spec (§17). Tune here in one place.
export const RATE_LIMITS = {
  loginPerAccount: { limit: 5, windowSec: 15 * 60 },
  loginPerIp: { limit: 20, windowSec: 60 },
  signupPerIp: { limit: 5, windowSec: 60 * 60 },
  passwordResetPerEmail: { limit: 3, windowSec: 60 * 60 },
  passwordResetPerIp: { limit: 10, windowSec: 60 * 60 },
  bookingPerAccount: { limit: 10, windowSec: 60 },
  bookingPerIp: { limit: 60, windowSec: 60 },
  apiBaselinePerIp: { limit: 100, windowSec: 60 },
} satisfies Record<string, RateRule>;
```

- [ ] **Step 4: Write `src/lib/rate-limit.ts`**

```ts
import { env } from '@/env';
import type { RateRule } from '@/lib/rate-limit-config';

type Result = { success: boolean; remaining: number };

// --- in-memory fixed-window fallback (dev/test) ---
const buckets = new Map<string, { count: number; resetAt: number }>();

function inMemory(key: string, rule: RateRule, now: number): Result {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowSec * 1000 });
    return { success: true, remaining: rule.limit - 1 };
  }
  if (b.count >= rule.limit) return { success: false, remaining: 0 };
  b.count += 1;
  return { success: true, remaining: rule.limit - b.count };
}

// --- Upstash-backed limiter (prod) ---
let upstash: ((key: string, rule: RateRule) => Promise<Result>) | null = null;

async function getUpstash() {
  if (upstash) return upstash;
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL!,
    token: env.UPSTASH_REDIS_REST_TOKEN!,
  });
  upstash = async (key, rule) => {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, rule.windowSec);
    return { success: count <= rule.limit, remaining: Math.max(0, rule.limit - count) };
  };
  return upstash;
}

export async function rateLimit(key: string, rule: RateRule, now = Date.now()): Promise<Result> {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    const fn = await getUpstash();
    return fn(key, rule);
  }
  return inMemory(key, rule, now);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/lib/rate-limit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/rate-limit-config.ts src/lib/rate-limit.ts src/lib/rate-limit.test.ts
git commit -m "feat: add rate limiter with upstash and in-memory backends"
```

---

### Task 16: i18n (next-intl, without routing)

**Files:**
- Create: `src/i18n/config.ts`
- Create: `src/i18n/resolve-locale.ts`
- Create: `src/i18n/request.ts`
- Create: `src/i18n/set-locale.ts`
- Create: `messages/tr.json`
- Create: `messages/en.json`
- Modify: `next.config.ts`
- Create: `src/i18n/resolve-locale.test.ts`

**Interfaces:**
- Produces: `locales`, `defaultLocale`, `type Locale` (`@/i18n/config`); `resolveLocale(acceptLanguage: string): Locale` (`@/i18n/resolve-locale`); the next-intl `getRequestConfig` default export (`@/i18n/request`); `setLocale(locale: Locale)` server action (`@/i18n/set-locale`).

- [ ] **Step 1: Write the failing test**

`src/i18n/resolve-locale.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveLocale } from '@/i18n/resolve-locale';

describe('resolveLocale', () => {
  it('defaults to Turkish when header is empty', () => {
    expect(resolveLocale('')).toBe('tr');
  });
  it('returns tr when Turkish is preferred', () => {
    expect(resolveLocale('tr,en;q=0.9')).toBe('tr');
  });
  it('returns en for an English-only client', () => {
    expect(resolveLocale('en-US,en;q=0.8')).toBe('en');
  });
  it('falls back to tr for an unsupported language', () => {
    expect(resolveLocale('fr-FR,fr;q=0.9')).toBe('tr');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/i18n/resolve-locale.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/i18n/config.ts`**

```ts
export const locales = ['tr', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'tr';
export const LOCALE_COOKIE = 'locale';
```

- [ ] **Step 4: Write `src/i18n/resolve-locale.ts`**

```ts
import { match } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';
import { locales, defaultLocale, type Locale } from './config';

export function resolveLocale(acceptLanguage: string): Locale {
  if (!acceptLanguage) return defaultLocale;
  const requested = new Negotiator({
    headers: { 'accept-language': acceptLanguage },
  }).languages();
  try {
    return match(requested, locales as unknown as string[], defaultLocale) as Locale;
  } catch {
    return defaultLocale;
  }
}
```

- [ ] **Step 5: Write `src/i18n/request.ts`**

```ts
import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, type Locale } from './config';
import { resolveLocale } from './resolve-locale';

export default getRequestConfig(async ({ locale: override }) => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value as Locale | undefined;
  const acceptLanguage = (await headers()).get('accept-language') ?? '';
  const locale = (override as Locale) || cookieLocale || resolveLocale(acceptLanguage);
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
```

- [ ] **Step 6: Write `src/i18n/set-locale.ts`**

```ts
'use server';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, type Locale } from './config';

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale) {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { maxAge: ONE_YEAR, path: '/', sameSite: 'lax' });
}
```

- [ ] **Step 7: Write the message catalogs**

`messages/tr.json`:
```json
{
  "common": {
    "appName": "Oarly",
    "signIn": "Giriş yap",
    "signUp": "Kayıt ol",
    "signOut": "Çıkış yap",
    "loading": "Yükleniyor…"
  },
  "payment": {
    "regular": "Nakit",
    "multisport": "MultiSport"
  }
}
```

`messages/en.json`:
```json
{
  "common": {
    "appName": "Oarly",
    "signIn": "Sign in",
    "signUp": "Sign up",
    "signOut": "Sign out",
    "loading": "Loading…"
  },
  "payment": {
    "regular": "Cash",
    "multisport": "MultiSport"
  }
}
```

- [ ] **Step 8: Wire the plugin in `next.config.ts`**

```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
export default withNextIntl(nextConfig);
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm test src/i18n/resolve-locale.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 10: Commit**

```bash
git add src/i18n messages next.config.ts
git commit -m "feat: add next-intl i18n (tr default, en fallback) without routing"
```

---

### Task 17: Theming — tokens, fonts, providers, toggle

**Files:**
- Modify: `app/globals.css`
- Create: `src/components/theme-provider.tsx`
- Create: `src/components/theme-toggle.tsx`
- Create: `src/components/club-theme.tsx`
- Create: `src/lib/theme.ts`
- Create: `src/lib/theme.test.ts`

**Interfaces:**
- Produces: `accentStyle(accent?: string): React.CSSProperties` (`@/lib/theme`) that returns `{ '--club-accent': accent }` or `{}`; `ThemeProvider` (`@/components/theme-provider`); `ThemeToggle` (`@/components/theme-toggle`); `ClubTheme` wrapper that applies a club accent (`@/components/club-theme`).

> **Design tokens:** default brand teal — light `#0E9E93`, dark `#2DD4BF`; fonts Space Grotesk (headings) / Manrope (body). During a later design-sync (`/design-sync` against the Claude Design project) replace the approximate `oklch()` values below with the exact ones exported from the canvas.

- [ ] **Step 1: Write `app/globals.css`**

Replace the file contents with:
```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;

  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);

  /* Per-club brand accent — runtime-overridable (default Oarly teal #0E9E93). */
  --club-accent: oklch(0.63 0.1 184);
  --primary: var(--club-accent);
  --primary-foreground: oklch(0.985 0 0);
  --brand-tint: color-mix(in oklab, var(--club-accent) 14%, white);
  --brand-ink: color-mix(in oklab, var(--club-accent) 85%, black);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);

  /* Brighter brand for dark mode (default #2DD4BF); tints mix toward black. */
  --club-accent: oklch(0.78 0.13 180);
  --brand-tint: color-mix(in oklab, var(--club-accent) 22%, black);
  --brand-ink: color-mix(in oklab, var(--club-accent) 85%, white);
}

/* @theme inline keeps var() references live so --club-accent can be overridden at runtime. */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-brand: var(--club-accent);
  --color-brand-tint: var(--brand-tint);
  --color-brand-ink: var(--brand-ink);

  --font-sans: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  --font-heading: var(--font-heading-face), ui-sans-serif, system-ui, sans-serif;

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground font-sans; }
  h1, h2, h3, h4 { @apply font-heading; }
}
```

- [ ] **Step 2: Write `src/components/theme-provider.tsx`**

```tsx
'use client';
import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

- [ ] **Step 3: Write `src/lib/theme.ts`**

```ts
import type { CSSProperties } from 'react';

/** Returns an inline style that overrides the club brand accent, or {} when none. */
export function accentStyle(accent?: string | null): CSSProperties {
  return accent ? ({ '--club-accent': accent } as CSSProperties) : {};
}
```

- [ ] **Step 4: Write `src/components/club-theme.tsx`**

```tsx
import type { ReactNode } from 'react';
import { accentStyle } from '@/lib/theme';

/** Scopes a per-club brand accent to its subtree. */
export function ClubTheme({ accent, children }: { accent?: string | null; children: ReactNode }) {
  return <div style={accentStyle(accent)}>{children}</div>;
}
```

- [ ] **Step 5: Write the unit test**

`src/lib/theme.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { accentStyle } from '@/lib/theme';

describe('accentStyle', () => {
  it('sets the --club-accent custom property when an accent is given', () => {
    expect(accentStyle('oklch(0.55 0.2 30)')).toEqual({ '--club-accent': 'oklch(0.55 0.2 30)' });
  });
  it('returns an empty style when no accent is given', () => {
    expect(accentStyle(null)).toEqual({});
    expect(accentStyle(undefined)).toEqual({});
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/lib/theme.test.ts`
Expected: PASS (2 tests). (`ThemeToggle` is added and rendered in Task 18, which pulls in the shadcn `Button`.)

- [ ] **Step 7: Commit**

```bash
git add app/globals.css src/components/theme-provider.tsx src/components/club-theme.tsx src/lib/theme.ts src/lib/theme.test.ts
git commit -m "feat: add tailwind token system, theme provider and club accent"
```

---

### Task 18: shadcn base components & root layout assembly

**Files:**
- Create: `components.json`
- Create: `src/components/ui/button.tsx` (+ any deps the CLI adds)
- Create: `src/components/theme-toggle.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Create: `src/components/theme-toggle.test.tsx`

**Interfaces:**
- Consumes: `cn` (`@/lib/utils`), `ThemeProvider` (`@/components/theme-provider`), i18n from Task 16, fonts.
- Produces: shadcn `Button` (`@/components/ui/button`); `ThemeToggle` (`@/components/theme-toggle`); a root layout wiring fonts + `ThemeProvider` + `NextIntlClientProvider` + `<html lang>`.

- [ ] **Step 1: Create `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 2: Add base components via the shadcn CLI**

Run:
```bash
pnpm dlx shadcn@latest add button card input label sonner --yes
```
Expected: components written under `src/components/ui/`. If the CLI wants to overwrite `app/globals.css`, decline / restore it — the Task 17 tokens are authoritative (`git checkout app/globals.css` afterward if needed, then re-run `pnpm test src/lib/theme.test.ts`).

- [ ] **Step 3: Write `src/components/theme-toggle.tsx`**

```tsx
'use client';
import * as React from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted) return <Button variant="ghost" size="icon" aria-label="Toggle theme" />;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
```

- [ ] **Step 4: Write `app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { Space_Grotesk, Manrope } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

const heading = Space_Grotesk({ subsets: ['latin'], display: 'swap', variable: '--font-heading-face' });
const body = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Oarly',
  description: 'Kürek kulüpleri için seans ve rezervasyon yönetimi.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning className={`${heading.variable} ${body.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Write a minimal `app/page.tsx` smoke landing**

```tsx
import { getTranslations } from 'next-intl/server';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

export default async function Home() {
  const t = await getTranslations('common');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full items-center justify-between">
        <span className="font-heading text-2xl font-bold text-brand">{t('appName')}</span>
        <ThemeToggle />
      </div>
      <Button className="w-full">{t('signIn')}</Button>
    </main>
  );
}
```

- [ ] **Step 6: Write the component test**

`src/components/theme-toggle.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';

vi.mock('next/font/google', () => ({}), { virtual: true });

describe('ThemeToggle', () => {
  it('renders a theme toggle button inside the provider', () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('Toggle theme')).toBeDefined();
  });
});
```

- [ ] **Step 7: Run the component test — expect PASS**

Run: `pnpm test src/components/theme-toggle.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 8: Verify the app builds and the full unit suite is green**

Run:
```bash
pnpm test
pnpm build
```
Expected: all unit tests pass; `pnpm build` completes without type or bundling errors. (Provide the required env vars from `.env.example`, or a `.env.local`, so `@/env` parses during build.)

- [ ] **Step 9: Commit**

```bash
git add components.json src/components app/layout.tsx app/page.tsx
git commit -m "feat: assemble app shell with shadcn, fonts, theme and i18n"
```

---

## Self-Review

**Spec coverage (foundation-relevant sections):**
- §16 Accounts / Auth (email+password, Google, verify, reset, profile fields) → Tasks 5, 14. ✔
- §14 KVKK consent storage → Task 6 (`consents`); privacy page/export/deletion are Plan 3. ✔ (storage only, by design)
- §15 i18n (TR default/EN, `Accept-Language`) → Task 16; theming (token system + light/dark + club brand skin) → Tasks 17–18. ✔
- §17 Data model — all 18 tables (`user`, `session`, `account`, `verification`, `user_socials`, `consents`, `clubs`, `club_socials`, `skill_levels`, `memberships`, `boat_types`, `schedule_windows`, `window_boats`, `slots`, `sessions`, `bookings`, `penalties`, `holidays`, `club_holiday_overrides`, `notifications`, `audit_log`) → Tasks 4–11. ✔ (21 tables incl. Better Auth's four)
- §10 Concurrency primitives — active-booking partial unique index + idempotency index defined here → Task 10; advisory-lock booking is Plan 6. ✔
- §17 Rate limiting → Task 15 (utility + thresholds); endpoint wiring for booking is Plan 6. ✔
- §5 Time (store UTC) → all timestamps are `timestamp with time zone`. ✔
- §13 Notifications infra — `notifications` log + `sendEmail` → Tasks 11, 13; templates/triggers are Plan 8. ✔

**Deliberate deviations from the §17 sketch (documented so later plans don't trip):**
1. No separate `users` profile table — profile fields live on Better Auth's `user` (via `additionalFields`). All FKs point at `user.id` (`text`, not `uuid`).
2. DB driver is `pg` (node-postgres), not the Neon serverless HTTP driver, because interactive transactions are required later.

**Placeholder scan:** none — every code step contains complete content.

**Type consistency:** enum names, table export names (`scheduleWindows`, `windowBoats`, `boatTypes`, `skillLevels`, `clubHolidayOverrides`, `auditLog`), and index names (`bookings_active_uq`, `bookings_idem_uq`, `memberships_user_club_uq`, `notifications_idem_uq`) are used consistently across schema tasks, tests, and the barrel re-exports. `user.id` is `text` everywhere it is referenced.
