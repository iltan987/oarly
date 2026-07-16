# Oarly — Accounts, Club Provisioning & Join Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing auth backend + schema into a working onboarding surface: accounts (sign-up with KVKK consent, sign-in, verification, password reset), an admin console that provisions clubs and assigns owners, an owner club-request path, and a member request-to-join → owner-approve flow.

**Architecture:** Pure-core / thin-adapter, matching Plans 1–2. Business logic lives in `src/lib/*.ts` as functions that take an injected Drizzle `db` plus plain args and are integration-tested against real Postgres. Auth/role **guards** (`session.ts`, `membership.ts`) wrap Better Auth + Next navigation. Server Actions in route folders are thin adapters: guard → call logic → `revalidatePath`/`redirect`. UI is Base UI (`base-nova`) client components for auth forms (via `authClient`) and server components elsewhere. Auth pages live on the **apex** host; the `.oarly.sbs` cookie domain keeps members signed in across subdomains.

**Tech Stack:** Next.js 16 (App Router, root `app/`), React 19, TypeScript, Tailwind 4, Better Auth (already wired), Drizzle + Neon/Postgres, next-intl (TR default), Base UI via shadcn (`Field` primitives), react-hook-form + zod (client-form UX), Resend (already wired), Vitest.

## Global Constraints

- **App is at the repo root.** The proxy is root-level `proxy.ts` (NOT `src/proxy.ts`, which Next silently ignores). See memory `nextjs-proxy-location`.
- **Never trust an inbound `x-tenant-slug` header.** Derive tenant identity from `params.slug` (the proxy rewrite) only. Task 13 additionally makes the proxy strip any inbound `x-tenant-slug` on every path. No authz decision may read the header.
- **Any new top-level (single-segment) apex route MUST be added to `RESERVED_APEX_SEGMENTS`** in `src/lib/tenant-routing.ts`, or the apex `oarly.sbs/{slug}` → `{slug}.oarly.sbs` redirect will hijack it. New slugs must also be rejected if they collide with `RESERVED_SUBDOMAINS ∪ RESERVED_APEX_SEGMENTS`.
- **Auth routes are apex-only and hyphenated:** `/sign-in`, `/sign-up`, `/verify-email`, `/forgot-password`, `/reset-password`, `/request-club`, `/privacy`, and `/admin/*`. `sign-in`/`sign-up`/`privacy`/`kvkk`/`admin` are already reserved; the others are added in Task 1.
- **Business logic takes `db` as its first parameter** (typed `DB = NodePgDatabase<typeof schema>`); it never imports the app singleton `db`. Integration tests pass a test-pool db. Server Actions import `db` from `@/db` and pass it in.
- **Better Auth is the source of identity.** Before using any Better Auth client/server method, verify its signature against the installed types in `node_modules/better-auth` (see memory `nodemodules-type-defs-reference`) or Context7. Do not guess field names.
- **i18n:** every user-facing string goes through next-intl. Add every new key to **both** `messages/tr.json` and `messages/en.json`. TR is the default and must read naturally (this is a Turkish product); EN is the fallback.
- **UI:** Base UI (`base-nova`) primitives from `@/components/ui/*`; add missing primitives with the shadcn CLI (`pnpm dlx shadcn@latest add <name>`), never hand-authored. `cn` from `@/lib/utils`. Theme via next-themes; tenant pages stay wrapped in `ClubTheme`.
- **Forms:** all forms use the shadcn **`Field`** family (`Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldSet`) — the old `Form`/`FormField` component is **deprecated; do not use it**. Two patterns, matched to the form's nature (both documented by shadcn): (a) **client-only auth forms** (sign-in/up, forgot, reset) use **react-hook-form + `zodResolver`** and call `authClient` in `onSubmit`; (b) **server-action forms** (create-club, request-club) use **`useActionState` + `Field`/`FieldError`**, with zod validating inside the action. Single-button forms (approve/reject/activate/suspend) stay plain `<form action={...}>`.
- **Validation is server-authoritative and always runs.** Client-side (RHF + zod) validation is UX only and never trusted. Every one of our mutations re-validates on the server: the server action parses `FormData` with the shared zod schema from `src/lib/schemas.ts` on every call, and the pure-core logic additionally enforces domain/DB rules (reserved/taken slug, ownership scope, club status). Auth mutations are validated server-side by Better Auth itself. Client and server share the schema shape; the client only adds localized messages for UX.
- **New deps:** `react-hook-form` and `@hookform/resolvers` (added in Task 5). `zod` v4 is already present — verify `@hookform/resolvers/zod` supports zod v4 in the installed version; if the resolver needs a `zod/v4` import path, use it.
- **Membership model:** exactly one `memberships` row per `(user_id, club_id)` (`memberships_user_club_uq`). `role ∈ {owner, member}`, `status ∈ {pending, approved, rejected, banned}`.
- **Club lifecycle:** admin-created club → `active` immediately (+ owner membership `owner/approved`). Owner-requested club → `pending` (+ requester membership `owner/approved`); admin **activates** → `active`. `suspended`/`pending` clubs are not publicly available.
- **KVKK:** consent is recorded at sign-up (documents + version constant) via a Better Auth user-create hook. The `/privacy` page is a **stub** in v1 (full clarification text, data export, and account deletion are deferred to a later plan). A lawyer signs off pre-launch.
- **Rate-limiting:** auth endpoints are covered by Better Auth's built-in limiter (already enabled in `src/auth.ts`). Wiring the custom `src/lib/rate-limit.ts` to app routes is Plan 6 — out of scope here.
- **Commits:** no `Co-Authored-By` / AI-attribution line, ever (memory `no-commit-coauthor`).
- **Tests:** unit/component via `pnpm test <path>`; DB integration via `pnpm test:integration <path>` (needs the test Postgres on :5433). Integration files use the harness in `src/auth.integration.test.ts` (`Pool` + `migrate(..., { migrationsFolder: './drizzle' })`, `describe.skipIf(!process.env.TEST_DATABASE_URL)`).

---

## File Structure

**New pure/logic modules (`src/lib/`):**
- `slug.ts` — `RESERVED_SLUGS`, `validateSlug()`.
- `session.ts` — `getSession`, `getCurrentUser`, `requireUser`, `requireAdmin`.
- `membership.ts` — `DB` type, `getMembership`, `requireOwner`.
- `consent.ts` — `CONSENT_DOCUMENTS`, `CONSENT_VERSION`, `recordSignupConsent`.
- `audit.ts` — `logAudit`.
- `clubs-admin.ts` — `createClub`, `setClubStatus`.
- `club-request.ts` — `requestClub`.
- `join.ts` — `requestToJoin`.
- `members-admin.ts` — `setMembershipStatus`, `assignSkillLevel`.
- `schemas.ts` — shared zod schemas (auth + club forms), reused by client RHF and server actions.
- `urls.ts` (modify) — add `safeRedirect`.
- `tenant-routing.ts` (modify) — extend `RESERVED_APEX_SEGMENTS`.

**New apex routes (`app/`):**
- `(auth)/layout.tsx`, `(auth)/sign-in/page.tsx`, `(auth)/sign-up/page.tsx`, `(auth)/verify-email/page.tsx`, `(auth)/forgot-password/page.tsx`, `(auth)/reset-password/page.tsx`
- `privacy/page.tsx` (stub)
- `request-club/page.tsx` + `request-club/actions.ts`
- `admin/layout.tsx`, `admin/page.tsx`, `admin/clubs/new/page.tsx` + `admin/clubs/new/actions.ts`, `admin/requests/page.tsx`, `admin/actions.ts`
- `not-found.tsx` (global, branded)
- `components/sign-out-button.tsx`, `components/auth-form.tsx` helpers as needed

**Modified tenant routes (`app/s/[slug]/`):**
- `layout.tsx` — gate non-`active` clubs to a branded "unavailable" screen.
- `join/page.tsx` + `join/actions.ts` — real request-to-join flow, per-page `robots:{index:false}`.
- `manage/layout.tsx`, `manage/members/page.tsx` + `manage/members/actions.ts` — owner approve/reject/skill.

**Infra:** `vitest.setup.ts` (matchMedia polyfill) + `vitest.config.ts` wiring; root `app/layout.tsx` gets `<Toaster/>`; shadcn `field` primitive + `react-hook-form`/`@hookform/resolvers` deps + `src/lib/schemas.ts` (Task 5).

---

### Task 1: Routing/validation pure helpers (reserved segments, slug, safe redirect)

**Files:**
- Modify: `src/lib/tenant-routing.ts:14-17` (extend `RESERVED_APEX_SEGMENTS`)
- Create: `src/lib/slug.ts`, `src/lib/slug.test.ts`
- Modify: `src/lib/urls.ts` (add `safeRedirect`), `src/lib/urls.test.ts`
- Modify: `src/lib/tenant-routing.test.ts` (assert new reserved segments pass through)

**Interfaces:**
- Produces: `RESERVED_SLUGS: ReadonlySet<string>`; `validateSlug(slug: string): { ok: true } | { ok: false; reason: 'length' | 'format' | 'reserved' }`; `safeRedirect(target: string | null | undefined, origin: AppOrigin, fallback?: string): string`.
- Consumes: `RESERVED_SUBDOMAINS`, `RESERVED_APEX_SEGMENTS` from `tenant-routing.ts`; `AppOrigin`, `parseAppOrigin` from `urls.ts`.

- [ ] **Step 1: Extend the reserved apex segments.** In `src/lib/tenant-routing.ts`, add the new single-segment apex routes to `RESERVED_APEX_SEGMENTS` so they are never treated as club slugs:

```ts
export const RESERVED_APEX_SEGMENTS: ReadonlySet<string> = new Set([
  's', 'api', 'admin', 'sign-in', 'sign-up', 'sign-out', 'privacy', 'kvkk',
  'verify-email', 'forgot-password', 'reset-password', 'request-club',
  'favicon.ico', 'robots.txt', 'sitemap.xml', 'opengraph-image', 'icon',
]);
```

- [ ] **Step 2: Write the failing slug + redirect tests.** Create `src/lib/slug.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateSlug, RESERVED_SLUGS } from './slug';

describe('validateSlug', () => {
  it('accepts a simple lowercase slug', () => {
    expect(validateSlug('bogazici-kurek')).toEqual({ ok: true });
  });
  it('rejects too short / too long', () => {
    expect(validateSlug('ab')).toEqual({ ok: false, reason: 'length' });
    expect(validateSlug('a'.repeat(41))).toEqual({ ok: false, reason: 'length' });
  });
  it('rejects uppercase, spaces, underscores, leading/trailing hyphen', () => {
    expect(validateSlug('Foo').reason).toBe('format');
    expect(validateSlug('a b').reason).toBe('format');
    expect(validateSlug('a_b').reason).toBe('format');
    expect(validateSlug('-ab').reason).toBe('format');
    expect(validateSlug('ab-').reason).toBe('format');
  });
  it('rejects reserved subdomains and apex segments', () => {
    expect(validateSlug('admin').reason).toBe('reserved');
    expect(validateSlug('www').reason).toBe('reserved');
    expect(validateSlug('sign-in').reason).toBe('reserved');
    expect(RESERVED_SLUGS.has('api')).toBe(true);
  });
});
```

Add to `src/lib/urls.test.ts`:

```ts
import { safeRedirect, parseAppOrigin } from './urls';

describe('safeRedirect', () => {
  const origin = parseAppOrigin('https://oarly.sbs');
  it('allows relative paths', () => {
    expect(safeRedirect('/admin', origin)).toBe('/admin');
  });
  it('allows the apex and any subdomain of the root', () => {
    expect(safeRedirect('https://oarly.sbs/x', origin)).toBe('https://oarly.sbs/x');
    expect(safeRedirect('https://demo.oarly.sbs/join', origin)).toBe('https://demo.oarly.sbs/join');
  });
  it('rejects foreign hosts and protocol-relative tricks, using the fallback', () => {
    expect(safeRedirect('https://evil.com/x', origin)).toBe('/');
    expect(safeRedirect('//evil.com', origin)).toBe('/');
    expect(safeRedirect(null, origin, '/home')).toBe('/home');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail.** Run: `pnpm test src/lib/slug.test.ts src/lib/urls.test.ts` — Expected: FAIL (`validateSlug`/`safeRedirect` not exported).

- [ ] **Step 4: Implement.** Create `src/lib/slug.ts`:

```ts
import { RESERVED_SUBDOMAINS, RESERVED_APEX_SEGMENTS } from './tenant-routing';

/** Slugs that would collide with a reserved subdomain or top-level apex route. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  ...RESERVED_SUBDOMAINS,
  ...RESERVED_APEX_SEGMENTS,
]);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSlug(
  slug: string,
): { ok: true } | { ok: false; reason: 'length' | 'format' | 'reserved' } {
  if (slug.length < 3 || slug.length > 40) return { ok: false, reason: 'length' };
  if (!SLUG_RE.test(slug)) return { ok: false, reason: 'format' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'reserved' };
  return { ok: true };
}
```

Add to `src/lib/urls.ts`:

```ts
/**
 * Validate a post-auth redirect target against our own domain to prevent open redirects.
 * Accepts app-relative paths (starting with a single '/') and absolute URLs whose host is
 * the apex root or any subdomain of it. Anything else returns `fallback`.
 */
export function safeRedirect(
  target: string | null | undefined,
  origin: AppOrigin,
  fallback = '/',
): string {
  if (!target) return fallback;
  if (target.startsWith('/') && !target.startsWith('//')) return target;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return fallback;
  }
  const root = origin.rootDomain.split(':')[0].toLowerCase();
  const host = url.host.split(':')[0].toLowerCase();
  if (host === root || host.endsWith(`.${root}`)) return target;
  return fallback;
}
```

- [ ] **Step 5: Add a tenant-routing assertion.** In `src/lib/tenant-routing.test.ts`, add a case proving a newly-reserved apex route passes through instead of redirecting (mirror the file's existing `routeRequest` apex test style):

```ts
it('does not treat reserved auth routes as club slugs', () => {
  const origin = { protocol: 'https:', rootDomain: 'oarly.sbs' };
  for (const seg of ['verify-email', 'forgot-password', 'reset-password', 'request-club']) {
    const d = routeRequest({ host: 'oarly.sbs', pathname: `/${seg}`, search: '', origin });
    expect(d.type).toBe('next');
  }
});
```

- [ ] **Step 6: Run and commit.** Run: `pnpm test src/lib/slug.test.ts src/lib/urls.test.ts src/lib/tenant-routing.test.ts` — Expected: PASS.

```bash
git add src/lib/slug.ts src/lib/slug.test.ts src/lib/urls.ts src/lib/urls.test.ts src/lib/tenant-routing.ts src/lib/tenant-routing.test.ts
git commit -m "feat: slug validation, safe-redirect, and reserved apex routes for auth"
```

---

### Task 2: Session & admin guards (`src/lib/session.ts`)

**Files:**
- Create: `src/lib/session.ts`, `src/lib/session.test.ts`

**Interfaces:**
- Produces:
  - `type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>`
  - `type CurrentUser = NonNullable<SessionResult>['user']`
  - `getSession(): Promise<SessionResult>`
  - `getCurrentUser(): Promise<CurrentUser | null>`
  - `requireUser(redirectTo?: string): Promise<CurrentUser>` — redirects to `/sign-in?redirect=<redirectTo>` when signed out.
  - `requireAdmin(): Promise<CurrentUser>` — `requireUser()` then `notFound()` if `!user.isAdmin`.
- Consumes: `auth` from `@/auth`; `headers` from `next/headers`; `redirect`, `notFound` from `next/navigation`.

- [ ] **Step 1: Write the failing guard tests** (mock Better Auth + Next navigation). Create `src/lib/session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionMock = vi.fn();
vi.mock('@/auth', () => ({ auth: { api: { getSession: getSessionMock } } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
const redirectMock = vi.fn(() => { throw new Error('REDIRECT'); });
const notFoundMock = vi.fn(() => { throw new Error('NOT_FOUND'); });
vi.mock('next/navigation', () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
  notFound: () => notFoundMock(),
}));

import { getCurrentUser, requireUser, requireAdmin } from './session';

beforeEach(() => { getSessionMock.mockReset(); redirectMock.mockClear(); notFoundMock.mockClear(); });

describe('session guards', () => {
  it('getCurrentUser returns null when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });
  it('requireUser redirects to sign-in with the return path', async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(requireUser('/admin')).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/sign-in?redirect=%2Fadmin');
  });
  it('requireAdmin notFound()s a non-admin user', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false }, session: {} });
    await expect(requireAdmin()).rejects.toThrow('NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
  });
  it('requireAdmin returns an admin user', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true }, session: {} });
    expect((await requireAdmin()).id).toBe('u1');
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm test src/lib/session.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/session.ts`:**

```ts
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';

export type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
export type CurrentUser = NonNullable<SessionResult>['user'];

/** The current Better Auth session (user + session) or null. */
export async function getSession(): Promise<SessionResult> {
  return auth.api.getSession({ headers: await headers() });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return (await getSession())?.user ?? null;
}

/** Require a signed-in user, else redirect to apex sign-in with a return target. */
export async function requireUser(redirectTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const q = redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : '';
    redirect(`/sign-in${q}`);
  }
  return user;
}

/** Require a platform admin; a non-admin gets a 404 (the console is not advertised). */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser('/admin');
  if (!user.isAdmin) notFound();
  return user;
}
```

- [ ] **Step 4: Run to verify pass.** Run: `pnpm test src/lib/session.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/session.ts src/lib/session.test.ts
git commit -m "feat: session, requireUser and requireAdmin guards"
```

---

### Task 3: Club-role guard & membership lookup (`src/lib/membership.ts`)

**Files:**
- Create: `src/lib/membership.ts`, `src/lib/membership.test.ts` (unit, mocked), `src/lib/membership.integration.test.ts`

**Interfaces:**
- Produces:
  - `type DB = NodePgDatabase<typeof schema>` (exported for reuse by later logic modules)
  - `type Membership = typeof memberships.$inferSelect`
  - `getMembership(db: DB, userId: string, clubId: string): Promise<Membership | null>`
  - `requireOwner(slug: string, returnPath?: string): Promise<{ club: Club; user: CurrentUser; membership: Membership }>` — redirects to apex sign-in when signed out; `notFound()` when the signed-in user is not an approved owner of the club.
- Consumes: `getClubBySlug`, `Club` from `@/lib/tenant`; `getCurrentUser`, `CurrentUser` from `@/lib/session`; `db` from `@/db`; `env`, `parseAppOrigin`, `apexUrl` for the sign-in redirect; `memberships`, schema from `@/db/schema`.

- [ ] **Step 1: Write the failing integration test** for `getMembership`. Create `src/lib/membership.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from '@/db/schema';
import { getMembership } from './membership';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('getMembership', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  it('finds the membership for a (user, club) pair and null otherwise', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [club] = await db.insert(schema.clubs).values({ slug: `c-${Date.now()}`, name: 'C', status: 'active' }).returning();
    await db.insert(schema.memberships).values({ userId: uid, clubId: club.id, role: 'owner', status: 'approved' });
    const found = await getMembership(db, uid, club.id);
    expect(found?.role).toBe('owner');
    expect(await getMembership(db, uid, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing unit test** for `requireOwner` (mock deps). Create `src/lib/membership.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/env', () => ({ env: { APP_URL: 'https://oarly.sbs' } }));
const getClubBySlug = vi.fn();
vi.mock('@/lib/tenant', () => ({ getClubBySlug: (s: string) => getClubBySlug(s) }));
const getCurrentUser = vi.fn();
vi.mock('@/lib/session', () => ({ getCurrentUser: () => getCurrentUser() }));
const dbGetMembership = vi.fn();
// getMembership is exported from the module under test; spy via a partial mock:
vi.mock('@/db', () => ({ db: {} }));
const redirectMock = vi.fn(() => { throw new Error('REDIRECT'); });
const notFoundMock = vi.fn(() => { throw new Error('NOT_FOUND'); });
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirectMock(u), notFound: () => notFoundMock() }));

import * as mod from './membership';

beforeEach(() => { vi.restoreAllMocks(); getClubBySlug.mockReset(); getCurrentUser.mockReset(); redirectMock.mockClear(); notFoundMock.mockClear(); });

describe('requireOwner', () => {
  it('redirects to apex sign-in (absolute) when signed out', async () => {
    getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status: 'active' });
    getCurrentUser.mockResolvedValue(null);
    await expect(mod.requireOwner('demo', '/manage/members')).rejects.toThrow('REDIRECT');
    const target = redirectMock.mock.calls[0][0] as string;
    expect(target).toContain('https://oarly.sbs/sign-in?redirect=');
    expect(decodeURIComponent(target)).toContain('https://demo.oarly.sbs/manage/members');
  });
  it('notFound()s when the user is not an approved owner', async () => {
    getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status: 'active' });
    getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
    vi.spyOn(mod, 'getMembership').mockResolvedValue(null);
    await expect(mod.requireOwner('demo')).rejects.toThrow('NOT_FOUND');
  });
});
```

> Note to implementer: if `vi.spyOn(mod, 'getMembership')` cannot intercept an intra-module call, have `requireOwner` call `getMembership` through the module's own export object, or split the DB query into a small injected helper — whichever keeps the spy honest. Do not weaken the test to make it pass.

- [ ] **Step 3: Run to verify both fail.** Run: `pnpm test src/lib/membership.test.ts` and `pnpm test:integration src/lib/membership.integration.test.ts` — Expected: FAIL.

- [ ] **Step 4: Implement `src/lib/membership.ts`:**

```ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { redirect, notFound } from 'next/navigation';
import * as schema from '@/db/schema';
import { memberships } from '@/db/schema';
import { db as appDb } from '@/db';
import { env } from '@/env';
import { parseAppOrigin, apexUrl, clubUrl } from '@/lib/urls';
import { getClubBySlug, type Club } from '@/lib/tenant';
import { getCurrentUser, type CurrentUser } from '@/lib/session';

export type DB = NodePgDatabase<typeof schema>;
export type Membership = typeof memberships.$inferSelect;

export async function getMembership(db: DB, userId: string, clubId: string): Promise<Membership | null> {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.clubId, clubId)))
    .limit(1);
  return row ?? null;
}

/** Require the signed-in user to be an approved owner of `slug`. */
export async function requireOwner(
  slug: string,
  returnPath = '/manage/members',
): Promise<{ club: Club; user: CurrentUser; membership: Membership }> {
  const origin = parseAppOrigin(env.APP_URL);
  const club = await getClubBySlug(slug);
  if (!club) notFound();
  const user = await getCurrentUser();
  if (!user) {
    const back = `${clubUrl(slug, origin)}${returnPath}`;
    redirect(`${apexUrl('/sign-in', origin)}?redirect=${encodeURIComponent(back)}`);
  }
  const membership = await getMembership(appDb, user.id, club.id);
  if (!membership || membership.role !== 'owner' || membership.status !== 'approved') notFound();
  return { club, user, membership };
}
```

- [ ] **Step 5: Run to verify pass.** Run: `pnpm test src/lib/membership.test.ts` and `pnpm test:integration src/lib/membership.integration.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/membership.ts src/lib/membership.test.ts src/lib/membership.integration.test.ts
git commit -m "feat: getMembership lookup and requireOwner guard"
```

---

### Task 4: KVKK consent constant + Better Auth create hook

**Files:**
- Create: `src/lib/consent.ts`, `src/lib/consent.integration.test.ts`
- Modify: `src/auth.ts` (add `databaseHooks.user.create.after`)

**Interfaces:**
- Produces: `CONSENT_DOCUMENTS: readonly string[]` = `['privacy_policy', 'kvkk_clarification']`; `CONSENT_VERSION: string` = `'2026-07-15'`; `recordSignupConsent(db: DB, userId: string): Promise<void>`.
- Consumes: `consents` from `@/db/schema`; `DB` from `@/lib/membership`.

- [ ] **Step 1: Write the failing integration test.** Create `src/lib/consent.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { recordSignupConsent, CONSENT_DOCUMENTS, CONSENT_VERSION } from './consent';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('recordSignupConsent', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  it('writes one consent row per document at the current version', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'C', email: `${uid}@t.co` });
    await recordSignupConsent(db, uid);
    const rows = await db.select().from(schema.consents).where(eq(schema.consents.userId, uid));
    expect(rows).toHaveLength(CONSENT_DOCUMENTS.length);
    expect(rows.every((r) => r.version === CONSENT_VERSION)).toBe(true);
    expect(new Set(rows.map((r) => r.document))).toEqual(new Set(CONSENT_DOCUMENTS));
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm test:integration src/lib/consent.integration.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/consent.ts`:**

```ts
import { consents } from '@/db/schema';
import type { DB } from '@/lib/membership';

/** KVKK documents accepted at sign-up. Bump CONSENT_VERSION when the texts change. */
export const CONSENT_DOCUMENTS = ['privacy_policy', 'kvkk_clarification'] as const;
export const CONSENT_VERSION = '2026-07-15';

/** Record one consent row per document for a newly-created user. */
export async function recordSignupConsent(db: DB, userId: string): Promise<void> {
  await db.insert(consents).values(
    CONSENT_DOCUMENTS.map((document) => ({ userId, document, version: CONSENT_VERSION })),
  );
}
```

- [ ] **Step 4: Wire the Better Auth create hook.** In `src/auth.ts`, import the helper and the app db, and add a `databaseHooks` block. **Verify the `databaseHooks.user.create.after` shape against `node_modules/better-auth` types or Context7 before writing** — confirm the callback receives the created `user` with its `id`.

```ts
// add imports
import { db } from '@/db';
import { recordSignupConsent } from '@/lib/consent';

// inside betterAuth({ ... }), as a top-level option:
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await recordSignupConsent(db, user.id);
        },
      },
    },
  },
```

- [ ] **Step 5: Run to verify pass, and confirm sign-up still creates a user.** Run: `pnpm test:integration src/lib/consent.integration.test.ts src/auth.integration.test.ts` — Expected: PASS (the auth sign-up test now also exercises the hook; ensure it still passes).

- [ ] **Step 6: Typecheck + commit.** Run: `pnpm exec tsc --noEmit` — Expected: clean.

```bash
git add src/lib/consent.ts src/lib/consent.integration.test.ts src/auth.ts
git commit -m "feat: record KVKK consent on user creation via Better Auth hook"
```

---

### Task 5: Shared form + test infrastructure (Field, react-hook-form, zod schemas, Toaster)

**Files:**
- Add deps: `pnpm add react-hook-form @hookform/resolvers`
- Add UI primitive: `pnpm dlx shadcn@latest add field` (creates `src/components/ui/field.tsx`)
- Create: `src/lib/schemas.ts`, `src/lib/schemas.test.ts`, `vitest.setup.ts`
- Modify: `vitest.config.ts` (add `test.setupFiles`), `src/components/theme-toggle.test.tsx` (remove local matchMedia polyfill; deepen to assert click-to-flip), `app/layout.tsx` (mount `<Toaster/>`)

**Interfaces:**
- Produces (schemas, shared by client RHF and server actions): `signInSchema`, `signUpSchema`, `forgotPasswordSchema`, `resetPasswordSchema`, `clubRequestSchema`, `createClubSchema`.

- [ ] **Step 1: Install deps and the Field primitive.** Run `pnpm add react-hook-form @hookform/resolvers`, then `pnpm dlx shadcn@latest add field`. Confirm `src/components/ui/field.tsx` imports from `@base-ui/react` (base-nova style) and exports at least `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldSet`. Verify `@hookform/resolvers/zod` supports the installed zod v4 (`node_modules/@hookform/resolvers` types) — if it exposes a `zod/v4` entry, note which import path the forms must use.

- [ ] **Step 2: Write the failing schemas test.** Create `src/lib/schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signUpSchema, createClubSchema } from './schemas';

describe('schemas', () => {
  it('signUpSchema requires consent === true and an 8+ char password', () => {
    const base = { firstName: 'A', lastName: 'B', phone: '5551112233', email: 'a@b.co', password: 'longenough' };
    expect(signUpSchema.safeParse({ ...base, consent: true }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, consent: true, password: 'short' }).success).toBe(false);
  });
  it('createClubSchema validates name/slug length and owner email', () => {
    expect(createClubSchema.safeParse({ name: 'Boğaziçi', slug: 'bogazici', ownerEmail: 'o@c.co' }).success).toBe(true);
    expect(createClubSchema.safeParse({ name: 'x', slug: 'bogazici', ownerEmail: 'o@c.co' }).success).toBe(false);
    expect(createClubSchema.safeParse({ name: 'Boğaziçi', slug: 'bogazici', ownerEmail: 'nope' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `pnpm test src/lib/schemas.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/lib/schemas.ts`.** These are the SERVER-authoritative shapes (format/length/required); domain rules stay in pure-core. Match the existing zod idiom in `src/env.ts` (`z.string().email()`); if the installed zod v4 warns on the string-method form, switch to the top-level `z.email()` / `z.url()` equivalents.

```ts
import * as z from 'zod';

// --- auth (client-side UX; Better Auth is the server authority) ---
export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const signUpSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  consent: z.literal(true), // KVKK gate — must be explicitly true
});
export const forgotPasswordSchema = z.object({ email: z.string().email() });
export const resetPasswordSchema = z.object({ newPassword: z.string().min(8) });

// --- club forms (client UX mirror; server action re-parses these,
//     and pure-core enforces reserved/taken slug + owner existence) ---
export const clubRequestSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().min(3).max(40),
});
export const createClubSchema = clubRequestSchema.extend({
  ownerEmail: z.string().email(),
});
```

- [ ] **Step 5: Run to verify pass.** Run: `pnpm test src/lib/schemas.test.ts` — Expected: PASS.

- [ ] **Step 6: Create `vitest.setup.ts`** with the jsdom `matchMedia` polyfill (moved from `theme-toggle.test.tsx`):

```ts
import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
```

- [ ] **Step 7: Wire it in `vitest.config.ts`.** Add `setupFiles: ['./vitest.setup.ts']` under the `test` block (keep the existing `env`/`environment` settings intact). Confirm the config still resolves `@/*` via `vite-tsconfig-paths`.

- [ ] **Step 8: Deepen the theme-toggle test.** In `src/components/theme-toggle.test.tsx`, remove the now-duplicated local `matchMedia` polyfill and add an assertion that clicking the toggle flips the theme (query the button, `fireEvent.click`, assert the resulting `aria`/text or `next-themes` call). Keep it minimal but real (no assertion-free test).

- [ ] **Step 9: Mount `<Toaster/>`.** In `app/layout.tsx`, import `{ Toaster } from '@/components/ui/sonner'` and render `<Toaster />` inside `<body>` (after `NextIntlClientProvider`'s children wrapper, so toasts appear on every page).

- [ ] **Step 10: Run to verify.** Run: `pnpm test src/lib/schemas.test.ts src/components/theme-toggle.test.tsx` — Expected: PASS. Run: `pnpm exec tsc --noEmit` — Expected: clean.

- [ ] **Step 11: Commit.**

```bash
git add package.json pnpm-lock.yaml src/components/ui/field.tsx src/lib/schemas.ts src/lib/schemas.test.ts vitest.setup.ts vitest.config.ts src/components/theme-toggle.test.tsx app/layout.tsx
git commit -m "chore: Field primitive, react-hook-form, shared zod schemas, vitest setup, Toaster"
```

---

### Task 6: Auth shell — layout, sign-in page, sign-out button

**Files:**
- Add UI primitives first (shadcn): `checkbox` (Task 7 needs it), `separator` (optional). This task needs only existing `button`, `input`, `label`, `card`.
- Create: `app/(auth)/layout.tsx`, `app/(auth)/sign-in/page.tsx`, `app/(auth)/sign-in/sign-in-form.tsx` (client), `src/components/sign-out-button.tsx` (client)
- Modify: `messages/tr.json`, `messages/en.json` (add `auth` namespace)

**Interfaces:**
- Consumes: `authClient` from `@/auth-client` (`signIn.email`, `signIn.social`); `safeRedirect`, `parseAppOrigin` from `@/lib/urls`; `env`.
- Produces: `<SignOutButton />` used by admin/nav later.

- [ ] **Step 1: Add the `auth` namespace** to `messages/tr.json` and `messages/en.json`. TR:

```json
"auth": {
  "signInTitle": "Giriş yap",
  "signUpTitle": "Kayıt ol",
  "email": "E-posta",
  "password": "Şifre",
  "firstName": "Ad",
  "lastName": "Soyad",
  "phone": "Telefon",
  "submitSignIn": "Giriş yap",
  "submitSignUp": "Hesap oluştur",
  "google": "Google ile devam et",
  "forgotLink": "Şifremi unuttum",
  "noAccount": "Hesabın yok mu?",
  "haveAccount": "Zaten hesabın var mı?",
  "toSignUp": "Kayıt ol",
  "toSignIn": "Giriş yap",
  "verifyTitle": "E-postanı doğrula",
  "verifyBody": "Sana bir doğrulama bağlantısı gönderdik. Devam etmek için e-postandaki bağlantıya tıkla.",
  "resend": "Yeniden gönder",
  "forgotTitle": "Şifreni sıfırla",
  "forgotBody": "E-posta adresini gir; sana bir sıfırlama bağlantısı gönderelim.",
  "forgotSubmit": "Bağlantı gönder",
  "forgotSent": "Bağlantı gönderildi. E-postanı kontrol et.",
  "resetTitle": "Yeni şifre belirle",
  "resetSubmit": "Şifreyi güncelle",
  "resetDone": "Şifren güncellendi. Şimdi giriş yapabilirsin.",
  "kvkkConsent": "Gizlilik politikasını ve KVKK aydınlatma metnini okudum, kabul ediyorum.",
  "kvkkNotice": "Devam ederek gizlilik politikasını ve KVKK aydınlatma metnini kabul etmiş olursun.",
  "privacyLink": "Gizlilik ve KVKK",
  "errorEmail": "Geçerli bir e-posta adresi gir.",
  "errorPassword": "Şifre en az 8 karakter olmalı.",
  "errorRequired": "Bu alan zorunlu.",
  "errorCredentials": "E-posta veya şifre hatalı.",
  "errorConsent": "Devam etmek için KVKK metnini kabul etmelisin.",
  "errorGeneric": "Bir şeyler ters gitti. Lütfen tekrar dene."
}
```

EN (mirror keys):

```json
"auth": {
  "signInTitle": "Sign in",
  "signUpTitle": "Sign up",
  "email": "Email",
  "password": "Password",
  "firstName": "First name",
  "lastName": "Last name",
  "phone": "Phone",
  "submitSignIn": "Sign in",
  "submitSignUp": "Create account",
  "google": "Continue with Google",
  "forgotLink": "Forgot password",
  "noAccount": "No account yet?",
  "haveAccount": "Already have an account?",
  "toSignUp": "Sign up",
  "toSignIn": "Sign in",
  "verifyTitle": "Verify your email",
  "verifyBody": "We sent you a verification link. Click the link in your email to continue.",
  "resend": "Resend",
  "forgotTitle": "Reset your password",
  "forgotBody": "Enter your email and we'll send you a reset link.",
  "forgotSubmit": "Send link",
  "forgotSent": "Link sent. Check your email.",
  "resetTitle": "Set a new password",
  "resetSubmit": "Update password",
  "resetDone": "Your password is updated. You can sign in now.",
  "kvkkConsent": "I have read and accept the privacy policy and KVKK clarification text.",
  "kvkkNotice": "By continuing you accept the privacy policy and KVKK clarification text.",
  "privacyLink": "Privacy & KVKK",
  "errorEmail": "Enter a valid email address.",
  "errorPassword": "Password must be at least 8 characters.",
  "errorRequired": "This field is required.",
  "errorCredentials": "Wrong email or password.",
  "errorConsent": "You must accept the KVKK text to continue.",
  "errorGeneric": "Something went wrong. Please try again."
}
```

- [ ] **Step 2: Create the auth layout** `app/(auth)/layout.tsx` (centered card shell, server component):

```tsx
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-6 p-6">
      {children}
    </main>
  );
}
```

- [ ] **Step 3: Create the sign-in page** `app/(auth)/sign-in/page.tsx` (server; resolves + validates the redirect target, hands it to the client form):

```tsx
import { getTranslations } from 'next-intl/server';
import { env } from '@/env';
import { parseAppOrigin, safeRedirect } from '@/lib/urls';
import { SignInForm } from './sign-in-form';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;
  const t = await getTranslations('auth');
  const dest = safeRedirect(redirect, parseAppOrigin(env.APP_URL), '/');
  return <SignInForm title={t('signInTitle')} redirectTo={dest} />;
}
```

- [ ] **Step 4: Create the client form** `app/(auth)/sign-in/sign-in-form.tsx` — react-hook-form + `zodResolver(signInSchema)` + `Field`. **Verify `authClient.signIn.email` / `signIn.social` signatures against the installed `better-auth` types, and the `@hookform/resolvers/zod` import path for zod v4, before writing.**

```tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { authClient } from '@/auth-client';
import { signInSchema } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldError, FieldGroup } from '@/components/ui/field';

type Values = z.infer<typeof signInSchema>;

export function SignInForm({ title, redirectTo }: { title: string; redirectTo: string }) {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: Values) {
    setPending(true);
    const { error } = await authClient.signIn.email({ email: values.email, password: values.password });
    setPending(false);
    if (error) { toast.error(t('errorCredentials')); return; }
    window.location.href = redirectTo; // validated on the server in the page
  }

  return (
    <div className="w-full">
      <h1 className="mb-4 font-heading text-2xl font-bold">{title}</h1>
      <form onSubmit={handleSubmit(onSubmit)}>
        <FieldGroup>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
            {errors.email && <FieldError>{t('errorEmail')}</FieldError>}
          </Field>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
            <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register('password')} />
            {errors.password && <FieldError>{t('errorRequired')}</FieldError>}
          </Field>
          <Button type="submit" disabled={pending} className="w-full">{t('submitSignIn')}</Button>
        </FieldGroup>
      </form>
      <Button
        variant="outline"
        className="mt-3 w-full"
        onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: redirectTo })}
      >
        {t('google')}
      </Button>
      <div className="mt-4 flex justify-between text-sm text-muted-foreground">
        <Link href="/forgot-password" className="hover:underline">{t('forgotLink')}</Link>
        <Link href="/sign-up" className="hover:underline">{t('toSignUp')}</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create the sign-out button** `src/components/sign-out-button.tsx`:

```tsx
'use client';
import { useTranslations } from 'next-intl';
import { authClient } from '@/auth-client';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const t = useTranslations('common');
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => authClient.signOut().then(() => { window.location.href = '/'; })}
    >
      {t('signOut')}
    </Button>
  );
}
```

- [ ] **Step 6: Verify build + smoke.** Run: `pnpm exec tsc --noEmit` (clean) and `pnpm build` (compiles; `/sign-in` listed). Manually confirm `/sign-in` renders on the apex.

- [ ] **Step 7: Commit.**

```bash
git add app/\(auth\) src/components/sign-out-button.tsx messages/tr.json messages/en.json
git commit -m "feat: auth shell with sign-in page, Google, and sign-out"
```

---

### Task 7: Sign-up page with KVKK consent + privacy stub

**Files:**
- Add UI primitive: `pnpm dlx shadcn@latest add checkbox` (creates `src/components/ui/checkbox.tsx`).
- Create: `app/(auth)/sign-up/page.tsx` (server), `app/(auth)/sign-up/sign-up-form.tsx` (client), `app/privacy/page.tsx` (stub)

**Interfaces:**
- Consumes: `authClient.signUp.email`; `auth` message namespace (Task 6). KVKK consent recorded server-side by the Task 4 hook — the form only enforces the checkbox and shows the notice.

- [ ] **Step 1: Add the checkbox primitive.** Run: `pnpm dlx shadcn@latest add checkbox`. Confirm it imports from `@base-ui/react` (base-nova style), not Radix.

- [ ] **Step 2: Create the sign-up page** `app/(auth)/sign-up/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { SignUpForm } from './sign-up-form';

export default async function SignUpPage() {
  const t = await getTranslations('auth');
  return <SignUpForm title={t('signUpTitle')} />;
}
```

- [ ] **Step 3: Create the client form** `app/(auth)/sign-up/sign-up-form.tsx` — react-hook-form + `zodResolver(signUpSchema)` + `Field`, with a `Controller`-wrapped `Checkbox` for the KVKK gate (`consent: z.literal(true)` fails the form until checked). `name` is composed from first+last for Better Auth. **Verify `authClient.signUp.email` accepts the extra fields (`firstName`, `lastName`, `phone`) — they are declared in `auth.ts` `user.additionalFields`; confirm names against the installed types.**

```tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { authClient } from '@/auth-client';
import { signUpSchema } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, FieldError, FieldGroup } from '@/components/ui/field';

// Form-input type: `consent` is a boolean the resolver forces to `true`.
type Values = { firstName: string; lastName: string; phone: string; email: string; password: string; consent: boolean };

export function SignUpForm({ title }: { title: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const { register, handleSubmit, control, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { firstName: '', lastName: '', phone: '', email: '', password: '', consent: false },
  });

  async function onSubmit(v: Values) {
    setPending(true);
    const { error } = await authClient.signUp.email({
      email: v.email,
      password: v.password,
      name: `${v.firstName} ${v.lastName}`.trim(),
      firstName: v.firstName,
      lastName: v.lastName,
      phone: v.phone,
    });
    setPending(false);
    if (error) { toast.error(t('errorGeneric')); return; }
    router.push('/verify-email');
  }

  return (
    <div className="w-full">
      <h1 className="mb-4 font-heading text-2xl font-bold">{title}</h1>
      <form onSubmit={handleSubmit(onSubmit)}>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field data-invalid={!!errors.firstName}>
              <FieldLabel htmlFor="firstName">{t('firstName')}</FieldLabel>
              <Input id="firstName" autoComplete="given-name" aria-invalid={!!errors.firstName} {...register('firstName')} />
              {errors.firstName && <FieldError>{t('errorRequired')}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.lastName}>
              <FieldLabel htmlFor="lastName">{t('lastName')}</FieldLabel>
              <Input id="lastName" autoComplete="family-name" aria-invalid={!!errors.lastName} {...register('lastName')} />
              {errors.lastName && <FieldError>{t('errorRequired')}</FieldError>}
            </Field>
          </div>
          <Field data-invalid={!!errors.phone}>
            <FieldLabel htmlFor="phone">{t('phone')}</FieldLabel>
            <Input id="phone" type="tel" autoComplete="tel" aria-invalid={!!errors.phone} {...register('phone')} />
            {errors.phone && <FieldError>{t('errorRequired')}</FieldError>}
          </Field>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
            {errors.email && <FieldError>{t('errorEmail')}</FieldError>}
          </Field>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
            <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register('password')} />
            {errors.password && <FieldError>{t('errorPassword')}</FieldError>}
          </Field>
          <Field orientation="horizontal" data-invalid={!!errors.consent}>
            <Controller
              control={control}
              name="consent"
              render={({ field }) => (
                <Checkbox id="consent" checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} />
              )}
            />
            <FieldLabel htmlFor="consent" className="font-normal">
              {t('kvkkConsent')}{' '}
              <Link href="/privacy" className="underline" target="_blank">{t('privacyLink')}</Link>
            </FieldLabel>
          </Field>
          {errors.consent && <FieldError>{t('errorConsent')}</FieldError>}
          <Button type="submit" disabled={pending} className="w-full">{t('submitSignUp')}</Button>
        </FieldGroup>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">{t('kvkkNotice')}</p>
      <div className="mt-4 text-sm text-muted-foreground">
        {t('haveAccount')} <Link href="/sign-in" className="underline">{t('toSignIn')}</Link>
      </div>
    </div>
  );
}
```

> Note: `Checkbox`'s `onCheckedChange` value type comes from Base UI — verify (`boolean` vs a `CheckedState` union) against the generated component and adjust the `v === true` guard if needed. Confirm `Field`'s `orientation="horizontal"` prop exists in the base-nova `field.tsx`; if not, lay the checkbox + label out with a flex wrapper instead.

- [ ] **Step 4: Create the privacy stub** `app/privacy/page.tsx` (publicly reachable; full KVKK text deferred):

```tsx
import { getTranslations } from 'next-intl/server';

export default async function PrivacyPage() {
  const t = await getTranslations('privacy');
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-4 font-heading text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('stub')}</p>
    </main>
  );
}
```

Add a `privacy` namespace to both message files — TR: `{ "title": "Gizlilik ve KVKK", "stub": "Aydınlatma metni ve gizlilik politikası yayın öncesi eklenecektir." }`; EN: `{ "title": "Privacy & KVKK", "stub": "The full clarification text and privacy policy will be published before launch." }`.

- [ ] **Step 5: Verify + smoke.** Run: `pnpm exec tsc --noEmit` (clean), `pnpm build` (compiles). Manually: `/sign-up` requires the checkbox; submitting without it toasts the consent error.

- [ ] **Step 6: Commit.**

```bash
git add src/components/ui/checkbox.tsx app/\(auth\)/sign-up app/privacy messages/tr.json messages/en.json
git commit -m "feat: sign-up with KVKK consent gate and privacy stub"
```

---

### Task 8: Email verification, forgot-password, reset-password pages

**Files:**
- Create: `app/(auth)/verify-email/page.tsx` (+ client resend), `app/(auth)/forgot-password/page.tsx` (+ client form), `app/(auth)/reset-password/page.tsx` (+ client form)

**Interfaces:**
- Consumes: `authClient` — verify method names against installed types: expect `authClient.sendVerificationEmail({ email, callbackURL })`, `authClient.forgetPassword({ email, redirectTo })` (a.k.a. `requestPasswordReset`), `authClient.resetPassword({ newPassword, token })`. **Confirm exact names/params before implementing; the reset token arrives as `?token=` on `/reset-password`.**

- [ ] **Step 1: verify-email page** — informational + resend. `app/(auth)/verify-email/page.tsx` (server) renders a `<VerifyEmailNotice/>` client component showing `t('verifyTitle')`/`t('verifyBody')` and a resend button that calls the verification-resend method (requires the email; if unknown, prompt the user to re-enter it or link back to `/sign-in`). Keep it minimal: title, body, and a "back to sign-in" link; the resend button is best-effort.

- [ ] **Step 2: forgot-password page** `app/(auth)/forgot-password/page.tsx` + client form (RHF + `zodResolver(forgotPasswordSchema)` + `Field`): one email input → call the password-reset-request method with `redirectTo` = apex `/reset-password`; on success toast `t('forgotSent')`. Build `redirectTo` from `env.NEXT_PUBLIC_APP_URL ?? window.location.origin` + `/reset-password`.

- [ ] **Step 3: reset-password page** `app/(auth)/reset-password/page.tsx` (server reads `?token=`) + client form (RHF + `zodResolver(resetPasswordSchema)` + `Field`): new-password input → call `authClient.resetPassword({ newPassword, token })`; on success toast `t('resetDone')` and `router.push('/sign-in')`. If `token` is missing, show `t('errorGeneric')` and a link to `/forgot-password`.

Follow the exact RHF + `Field` + toast + `useTranslations('auth')` pattern from Task 6's `sign-in-form.tsx` (schemas from `@/lib/schemas`). All copy comes from the `auth` namespace already added in Task 6.

- [ ] **Step 4: Verify + smoke.** Run: `pnpm exec tsc --noEmit` (clean), `pnpm build` (compiles; all three routes listed). Manually confirm each renders and the reset flow round-trips against the dev DB (request reset → follow the emailed link → set new password → sign in).

- [ ] **Step 5: Commit.**

```bash
git add app/\(auth\)/verify-email app/\(auth\)/forgot-password app/\(auth\)/reset-password
git commit -m "feat: email verification, forgot-password and reset-password pages"
```

---

### Task 9: Admin console — guard, layout, clubs list

**Files:**
- Create: `app/admin/layout.tsx` (server; `requireAdmin`), `app/admin/page.tsx` (server; clubs list)
- Modify: `messages/tr.json`, `messages/en.json` (add `admin` namespace)

**Interfaces:**
- Consumes: `requireAdmin` (Task 2); `db` from `@/db`; `clubs` from `@/db/schema`; `SignOutButton` (Task 6).

- [ ] **Step 1: Add the `admin` namespace** to both message files. TR:

```json
"admin": {
  "title": "Yönetim",
  "clubs": "Kulüpler",
  "requests": "Kulüp istekleri",
  "newClub": "Yeni kulüp",
  "name": "Ad",
  "slug": "Alan adı (slug)",
  "ownerEmail": "Yönetici e-postası",
  "create": "Oluştur",
  "activate": "Etkinleştir",
  "suspend": "Askıya al",
  "status": "Durum",
  "statusActive": "Aktif",
  "statusPending": "Beklemede",
  "statusSuspended": "Askıda",
  "noClubs": "Henüz kulüp yok.",
  "noRequests": "Bekleyen istek yok.",
  "created": "Kulüp oluşturuldu.",
  "activated": "Kulüp etkinleştirildi.",
  "suspended2": "Kulüp askıya alındı.",
  "errorSlugInvalid": "Geçersiz slug.",
  "errorSlugReserved": "Bu slug ayrılmış, kullanılamaz.",
  "errorSlugTaken": "Bu slug zaten kullanımda.",
  "errorOwnerNotFound": "Bu e-postayla bir kullanıcı bulunamadı. Önce hesabı oluşturulmalı."
}
```

EN mirror: `{ "title": "Admin", "clubs": "Clubs", "requests": "Club requests", "newClub": "New club", "name": "Name", "slug": "Slug", "ownerEmail": "Owner email", "create": "Create", "activate": "Activate", "suspend": "Suspend", "status": "Status", "statusActive": "Active", "statusPending": "Pending", "statusSuspended": "Suspended", "noClubs": "No clubs yet.", "noRequests": "No pending requests.", "created": "Club created.", "activated": "Club activated.", "suspended2": "Club suspended.", "errorSlugInvalid": "Invalid slug.", "errorSlugReserved": "That slug is reserved.", "errorSlugTaken": "That slug is already taken.", "errorOwnerNotFound": "No user with that email. The account must be created first." }`

- [ ] **Step 2: Create the admin layout** `app/admin/layout.tsx` (guards + chrome):

```tsx
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/session';
import { SignOutButton } from '@/components/sign-out-button';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  const t = await getTranslations('admin');
  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/admin" className="font-heading text-lg font-bold">{t('title')}</Link>
          <Link href="/admin" className="text-muted-foreground hover:underline">{t('clubs')}</Link>
          <Link href="/admin/requests" className="text-muted-foreground hover:underline">{t('requests')}</Link>
          <Link href="/admin/clubs/new" className="text-muted-foreground hover:underline">{t('newClub')}</Link>
        </nav>
        <SignOutButton />
      </header>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Create the clubs list** `app/admin/page.tsx` (server component; the layout already enforces admin):

```tsx
import { getTranslations } from 'next-intl/server';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { clubs } from '@/db/schema';

export default async function AdminClubsPage() {
  const t = await getTranslations('admin');
  const rows = await db.select().from(clubs).orderBy(desc(clubs.createdAt));
  const statusLabel: Record<string, string> = {
    active: t('statusActive'), pending: t('statusPending'), suspended: t('statusSuspended'),
  };
  if (rows.length === 0) return <p className="text-muted-foreground">{t('noClubs')}</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((c) => (
        <li key={c.id} className="flex items-center justify-between p-3">
          <div>
            <div className="font-medium">{c.name}</div>
            <div className="text-sm text-muted-foreground">{c.slug} · {statusLabel[c.status]}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Verify guard behavior.** Run: `pnpm exec tsc --noEmit` (clean), `pnpm build` (compiles). Manually: as a non-admin, `/admin` returns the (branded, Task 13) 404; as an admin, the list renders.

- [ ] **Step 5: Commit.**

```bash
git add app/admin/layout.tsx app/admin/page.tsx messages/tr.json messages/en.json
git commit -m "feat: admin console shell and clubs list"
```

---

### Task 10: Admin — create club + assign owner (logic + audit + action + page)

**Files:**
- Create: `src/lib/audit.ts`, `src/lib/clubs-admin.ts`, `src/lib/clubs-admin.integration.test.ts`
- Create: `app/admin/clubs/new/page.tsx`, `app/admin/clubs/new/actions.ts`

**Interfaces:**
- Produces:
  - `logAudit(db: DB, entry: { actorUserId: string; clubId?: string; action: string; target?: string; actingAsRole?: 'owner' | 'member' }): Promise<void>`
  - `createClub(db: DB, input: { name: string; slug: string; ownerEmail: string; createdBy: string }): Promise<{ ok: true; clubId: string } | { ok: false; error: 'slug_invalid' | 'slug_reserved' | 'slug_taken' | 'owner_not_found' }>` — validates slug, ensures uniqueness, finds the owner user by email, inserts club (`status: 'active'`) + owner membership (`owner`/`approved`), writes an audit row. All in one transaction.
- Consumes: `validateSlug`; `DB`, `getMembership` unused here; `clubs`, `memberships`, `user`, `auditLog` from schema.

- [ ] **Step 1: Write the failing integration test.** Create `src/lib/clubs-admin.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { createClub } from './clubs-admin';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('createClub', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function mkUser() {
    const id = `u-${Date.now()}-${Math.floor(performance.now())}`;
    await db.insert(schema.user).values({ id, name: 'X', email: `${id}@t.co` });
    return { id, email: `${id}@t.co` };
  }

  it('creates an active club, an approved owner membership, and an audit row', async () => {
    const admin = await mkUser();
    const owner = await mkUser();
    const slug = `bogazici-${Date.now()}`;
    const res = await createClub(db, { name: 'Boğaziçi Kürek', slug, ownerEmail: owner.email, createdBy: admin.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [club] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, res.clubId));
    expect(club.status).toBe('active');
    const [m] = await db.select().from(schema.memberships)
      .where(and(eq(schema.memberships.clubId, res.clubId), eq(schema.memberships.userId, owner.id)));
    expect(m.role).toBe('owner');
    expect(m.status).toBe('approved');
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, res.clubId));
    expect(audit.length).toBeGreaterThan(0);
  });

  it('rejects reserved and duplicate slugs, and a missing owner', async () => {
    const admin = await mkUser();
    const owner = await mkUser();
    expect((await createClub(db, { name: 'A', slug: 'admin', ownerEmail: owner.email, createdBy: admin.id })).ok).toBe(false);
    expect(await createClub(db, { name: 'A', slug: 'admin', ownerEmail: owner.email, createdBy: admin.id }))
      .toMatchObject({ ok: false, error: 'slug_reserved' });
    expect(await createClub(db, { name: 'A', slug: `x-${Date.now()}`, ownerEmail: 'nobody@nowhere.co', createdBy: admin.id }))
      .toMatchObject({ ok: false, error: 'owner_not_found' });
    const slug = `dup-${Date.now()}`;
    await createClub(db, { name: 'A', slug, ownerEmail: owner.email, createdBy: admin.id });
    expect(await createClub(db, { name: 'B', slug, ownerEmail: owner.email, createdBy: admin.id }))
      .toMatchObject({ ok: false, error: 'slug_taken' });
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm test:integration src/lib/clubs-admin.integration.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/audit.ts`:**

```ts
import { auditLog } from '@/db/schema';
import type { DB } from '@/lib/membership';

export async function logAudit(
  db: DB,
  entry: { actorUserId: string; clubId?: string; action: string; target?: string; actingAsRole?: 'owner' | 'member' },
): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    clubId: entry.clubId ?? null,
    action: entry.action,
    target: entry.target ?? null,
    actingAsRole: entry.actingAsRole ?? null,
  });
}
```

- [ ] **Step 4: Implement `src/lib/clubs-admin.ts`:**

```ts
import { eq } from 'drizzle-orm';
import { clubs, memberships, user } from '@/db/schema';
import { validateSlug } from '@/lib/slug';
import { logAudit } from '@/lib/audit';
import type { DB } from '@/lib/membership';

export async function createClub(
  db: DB,
  input: { name: string; slug: string; ownerEmail: string; createdBy: string },
): Promise<{ ok: true; clubId: string } | { ok: false; error: 'slug_invalid' | 'slug_reserved' | 'slug_taken' | 'owner_not_found' }> {
  const v = validateSlug(input.slug);
  if (!v.ok) return { ok: false, error: v.reason === 'reserved' ? 'slug_reserved' : 'slug_invalid' };

  const [owner] = await db.select().from(user).where(eq(user.email, input.ownerEmail.trim().toLowerCase())).limit(1);
  if (!owner) return { ok: false, error: 'owner_not_found' };

  const [existing] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, input.slug)).limit(1);
  if (existing) return { ok: false, error: 'slug_taken' };

  return db.transaction(async (tx) => {
    const [club] = await tx.insert(clubs)
      .values({ name: input.name, slug: input.slug, status: 'active', createdBy: input.createdBy })
      .returning({ id: clubs.id });
    await tx.insert(memberships).values({ userId: owner.id, clubId: club.id, role: 'owner', status: 'approved' });
    await logAudit(tx as unknown as DB, { actorUserId: input.createdBy, clubId: club.id, action: 'club.create', target: club.id });
    return { ok: true, clubId: club.id };
  });
}
```

> Note: emails are stored as entered by Better Auth; if it does not lowercase them, match case-insensitively (`sql\`lower(${user.email})\``) instead of `.toLowerCase()`. Verify how Better Auth stores `user.email` and adjust the lookup so a real owner is found.

- [ ] **Step 5: Run to verify pass.** Run: `pnpm test:integration src/lib/clubs-admin.integration.test.ts` — Expected: PASS.

- [ ] **Step 6: Add two message keys** to the `admin` namespace in both files — TR: `"errorNameInvalid": "Kulüp adı en az 2 karakter olmalı.", "errorOwnerEmailInvalid": "Geçerli bir e-posta gir."`; EN: `"errorNameInvalid": "Club name must be at least 2 characters.", "errorOwnerEmailInvalid": "Enter a valid email."`.

- [ ] **Step 7: Create the action** `app/admin/clubs/new/actions.ts` — zod shape-validation ALWAYS runs on the server, then pure-core domain rules; both map to field-level errors returned to `useActionState`:

```ts
'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { db } from '@/db';
import { requireAdmin } from '@/lib/session';
import { createClub } from '@/lib/clubs-admin';
import { createClubSchema } from '@/lib/schemas';

export type CreateClubState = { errors?: Record<string, string> };

export async function createClubAction(_prev: CreateClubState, formData: FormData): Promise<CreateClubState> {
  const admin = await requireAdmin();
  const t = await getTranslations('admin');

  const parsed = createClubSchema.safeParse({
    name: String(formData.get('name') ?? '').trim(),
    slug: String(formData.get('slug') ?? '').trim().toLowerCase(),
    ownerEmail: String(formData.get('ownerEmail') ?? '').trim(),
  });
  if (!parsed.success) {
    const f = parsed.error.flatten().fieldErrors;
    return { errors: {
      ...(f.name ? { name: t('errorNameInvalid') } : {}),
      ...(f.slug ? { slug: t('errorSlugInvalid') } : {}),
      ...(f.ownerEmail ? { ownerEmail: t('errorOwnerEmailInvalid') } : {}),
    } };
  }

  const res = await createClub(db, { ...parsed.data, createdBy: admin.id });
  if (!res.ok) {
    const map: Record<typeof res.error, [string, string]> = {
      slug_invalid: ['slug', t('errorSlugInvalid')],
      slug_reserved: ['slug', t('errorSlugReserved')],
      slug_taken: ['slug', t('errorSlugTaken')],
      owner_not_found: ['ownerEmail', t('errorOwnerNotFound')],
    };
    const [field, message] = map[res.error];
    return { errors: { [field]: message } };
  }

  revalidatePath('/admin');
  redirect('/admin');
}
```

- [ ] **Step 8: Create the page** `app/admin/clubs/new/page.tsx` — client component using `useActionState` + `Field`/`FieldError`:

```tsx
'use client';
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { createClubAction, type CreateClubState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldError, FieldGroup } from '@/components/ui/field';

export default function NewClubPage() {
  const t = useTranslations('admin');
  const [state, action, pending] = useActionState<CreateClubState, FormData>(createClubAction, {});
  const e = state.errors ?? {};
  return (
    <form action={action} className="max-w-md">
      <FieldGroup>
        <Field data-invalid={!!e.name}>
          <FieldLabel htmlFor="name">{t('name')}</FieldLabel>
          <Input id="name" name="name" aria-invalid={!!e.name} required />
          {e.name && <FieldError>{e.name}</FieldError>}
        </Field>
        <Field data-invalid={!!e.slug}>
          <FieldLabel htmlFor="slug">{t('slug')}</FieldLabel>
          <Input id="slug" name="slug" aria-invalid={!!e.slug} required />
          {e.slug && <FieldError>{e.slug}</FieldError>}
        </Field>
        <Field data-invalid={!!e.ownerEmail}>
          <FieldLabel htmlFor="ownerEmail">{t('ownerEmail')}</FieldLabel>
          <Input id="ownerEmail" name="ownerEmail" type="email" aria-invalid={!!e.ownerEmail} required />
          {e.ownerEmail && <FieldError>{e.ownerEmail}</FieldError>}
        </Field>
        <Button type="submit" disabled={pending}>{t('create')}</Button>
      </FieldGroup>
    </form>
  );
}
```

> Note: `res.error` is a string-literal union; if TS rejects `Record<typeof res.error, …>` as an index type, widen to `Record<string, [string, string]>`. The action re-guards with `requireAdmin()` even though the layout already does — never rely on the layout alone for a mutation.

- [ ] **Step 9: Verify + commit.** Run: `pnpm exec tsc --noEmit` (clean), `pnpm build` (compiles). Manually create a club and confirm it appears in the list as Active; an invalid slug / unknown owner email surfaces the field-level error.

```bash
git add src/lib/audit.ts src/lib/clubs-admin.ts src/lib/clubs-admin.integration.test.ts app/admin/clubs/new messages/tr.json messages/en.json
git commit -m "feat: admin create-club with owner assignment and audit log"
```

---

### Task 11: Admin — activate/suspend + club requests view

**Files:**
- Modify: `src/lib/clubs-admin.ts` (add `setClubStatus`), `src/lib/clubs-admin.integration.test.ts`
- Create: `app/admin/actions.ts` (status actions), `app/admin/requests/page.tsx`
- Modify: `app/admin/page.tsx` (add activate/suspend buttons per club)

**Interfaces:**
- Produces: `setClubStatus(db: DB, input: { clubId: string; status: 'active' | 'suspended'; actorId: string }): Promise<void>` — updates status, writes an audit row (`club.activate` / `club.suspend`).

- [ ] **Step 1: Add a failing test** to `src/lib/clubs-admin.integration.test.ts`:

```ts
import { setClubStatus } from './clubs-admin';

it('setClubStatus flips status and audits', async () => {
  const admin = await mkUser();
  const [club] = await db.insert(schema.clubs).values({ slug: `st-${Date.now()}`, name: 'S', status: 'pending' }).returning();
  await setClubStatus(db, { clubId: club.id, status: 'active', actorId: admin.id });
  const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
  expect(after.status).toBe('active');
  const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
  expect(audit.some((a) => a.action === 'club.activate')).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm test:integration src/lib/clubs-admin.integration.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `setClubStatus`** in `src/lib/clubs-admin.ts`:

```ts
export async function setClubStatus(
  db: DB,
  input: { clubId: string; status: 'active' | 'suspended'; actorId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(clubs).set({ status: input.status }).where(eq(clubs.id, input.clubId));
    await logAudit(tx as unknown as DB, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: input.status === 'active' ? 'club.activate' : 'club.suspend',
      target: input.clubId,
    });
  });
}
```

- [ ] **Step 4: Run to verify pass.** Run: `pnpm test:integration src/lib/clubs-admin.integration.test.ts` — Expected: PASS.

- [ ] **Step 5: Create `app/admin/actions.ts`:**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin } from '@/lib/session';
import { setClubStatus } from '@/lib/clubs-admin';

export async function setClubStatusAction(formData: FormData) {
  const admin = await requireAdmin();
  const clubId = String(formData.get('clubId'));
  const status = String(formData.get('status')) === 'active' ? 'active' : 'suspended';
  await setClubStatus(db, { clubId, status, actorId: admin.id });
  revalidatePath('/admin');
  revalidatePath('/admin/requests');
}
```

- [ ] **Step 6: Add action buttons.** In `app/admin/page.tsx`, render an `activate`/`suspend` `<form action={setClubStatusAction}>` per club (hidden `clubId`; hidden `status` = `active` when suspended, else `suspend`). Create `app/admin/requests/page.tsx` listing clubs where `status = 'pending'` (`eq(clubs.status, 'pending')`), each with an activate form; empty → `t('noRequests')`.

- [ ] **Step 7: Verify + commit.** Run: `pnpm exec tsc --noEmit` (clean), `pnpm build` (compiles). Manually: suspend then re-activate a club; a pending club appears under Requests and activating moves it to Active.

```bash
git add src/lib/clubs-admin.ts src/lib/clubs-admin.integration.test.ts app/admin/actions.ts app/admin/requests app/admin/page.tsx
git commit -m "feat: admin activate/suspend clubs and review club requests"
```

---

### Task 12: Owner club-request path

**Files:**
- Create: `src/lib/club-request.ts`, `src/lib/club-request.integration.test.ts`
- Create: `app/request-club/page.tsx`, `app/request-club/actions.ts`
- Modify: `messages/tr.json`, `messages/en.json` (add `requestClub` namespace)

**Interfaces:**
- Produces: `requestClub(db: DB, input: { name: string; slug: string; ownerId: string }): Promise<{ ok: true; clubId: string } | { ok: false; error: 'slug_invalid' | 'slug_reserved' | 'slug_taken' }>` — inserts a `pending` club (`createdBy = ownerId`) + `owner`/`approved` membership for the requester, in a transaction.

- [ ] **Step 1: Write the failing integration test.** Create `src/lib/club-request.integration.test.ts` (harness identical to Task 10). Assert: a successful request creates a `pending` club with `createdBy = ownerId` and an `owner`/`approved` membership for the requester; reserved/duplicate slugs return the matching error.

```ts
it('creates a pending club owned by the requester', async () => {
  const uid = `u-${Date.now()}`;
  await db.insert(schema.user).values({ id: uid, name: 'R', email: `${uid}@t.co` });
  const slug = `req-${Date.now()}`;
  const res = await requestClub(db, { name: 'İTÜ Kürek', slug, ownerId: uid });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const [club] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, res.clubId));
  expect(club.status).toBe('pending');
  expect(club.createdBy).toBe(uid);
  const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, res.clubId));
  expect(m).toMatchObject({ userId: uid, role: 'owner', status: 'approved' });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm test:integration src/lib/club-request.integration.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/club-request.ts`** (same validation + uniqueness as `createClub`, but `status: 'pending'`, `createdBy = ownerId`, and the membership is for the requester; no owner-email lookup):

```ts
import { eq } from 'drizzle-orm';
import { clubs, memberships } from '@/db/schema';
import { validateSlug } from '@/lib/slug';
import type { DB } from '@/lib/membership';

export async function requestClub(
  db: DB,
  input: { name: string; slug: string; ownerId: string },
): Promise<{ ok: true; clubId: string } | { ok: false; error: 'slug_invalid' | 'slug_reserved' | 'slug_taken' }> {
  const v = validateSlug(input.slug);
  if (!v.ok) return { ok: false, error: v.reason === 'reserved' ? 'slug_reserved' : 'slug_invalid' };
  const [existing] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, input.slug)).limit(1);
  if (existing) return { ok: false, error: 'slug_taken' };
  return db.transaction(async (tx) => {
    const [club] = await tx.insert(clubs)
      .values({ name: input.name, slug: input.slug, status: 'pending', createdBy: input.ownerId })
      .returning({ id: clubs.id });
    await tx.insert(memberships).values({ userId: input.ownerId, clubId: club.id, role: 'owner', status: 'approved' });
    return { ok: true, clubId: club.id };
  });
}
```

- [ ] **Step 4: Run to verify pass.** Run: `pnpm test:integration src/lib/club-request.integration.test.ts` — Expected: PASS.

- [ ] **Step 5: Add the `requestClub` namespace** to both message files. TR: `{ "title": "Kulüp başvurusu", "body": "Kulübünü Oarly'ye taşımak için başvur. Yönetici onayladığında kulüp yayına alınır.", "name": "Kulüp adı", "slug": "Alan adı (slug)", "submit": "Başvur", "submittedTitle": "Başvurun alındı", "submittedBody": "Yönetici incelemesinden sonra kulübün etkinleştirilecek." }` + reuse `admin.errorSlug*`. EN mirror.

- [ ] **Step 6: Create the action + page** (mirror Task 10's zod-in-action + `useActionState` + `Field`/`FieldError` shape). `app/request-club/actions.ts` (`'use server'`): `requireUser('/request-club')` for the owner id; parse `{ name, slug }` with `clubRequestSchema.safeParse` (return `{ errors: { name?, slug? } }` on failure, messages from `getTranslations`); then `requestClub(db, { ...parsed.data, ownerId })`; map the domain error (`slug_invalid`/`slug_reserved`/`slug_taken`) to the `slug` field via `admin.errorSlug*`; on success `redirect('/request-club?submitted=1')`. `app/request-club/page.tsx`: a server component that `requireUser('/request-club')`s (redirects to sign-in when signed out) and, when `?submitted=1`, renders the `requestClub.submittedTitle`/`submittedBody` confirmation; otherwise it renders a **client** form component (name, slug) using `useActionState` + `Field`/`FieldError`, exactly like `app/admin/clubs/new/page.tsx`.

- [ ] **Step 7: Verify + commit.** Run: `pnpm exec tsc --noEmit` (clean), `pnpm build` (compiles). Manually: submit a request as a signed-in user; it appears under `/admin/requests`; activating it flips it to Active.

```bash
git add src/lib/club-request.ts src/lib/club-request.integration.test.ts app/request-club messages/tr.json messages/en.json
git commit -m "feat: owner club-request path creating a pending club"
```

---

### Task 13: Branded not-found, suspended-club gate, proxy header hardening

**Files:**
- Create: `app/not-found.tsx` (global, apex-styled), `src/components/club-unavailable.tsx`
- Modify: `app/s/[slug]/layout.tsx` (gate non-`active` clubs), `messages/tr.json`, `messages/en.json` (add `notFound`, `unavailable`)
- Modify: `proxy.ts` (strip inbound `x-tenant-slug` on every path), `src/proxy.test.ts` (assert the strip)

**Interfaces:** none exported.

- [ ] **Step 1: Add message keys** to both files. TR: `"notFound": { "title": "Sayfa bulunamadı", "body": "Aradığın sayfa mevcut değil.", "home": "Ana sayfaya dön" }`, `"unavailable": { "title": "Bu kulüp şu anda kullanılamıyor", "body": "Kulüp henüz etkin değil. Daha sonra tekrar dene." }`. EN mirror.

- [ ] **Step 2: Create the global not-found** `app/not-found.tsx`:

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>{t('home')}</Link>
    </main>
  );
}
```

- [ ] **Step 3: Create the unavailable screen** `src/components/club-unavailable.tsx` (server component; themed by the tenant layout's `ClubTheme` wrapper):

```tsx
import { getTranslations } from 'next-intl/server';

export async function ClubUnavailable({ name }: { name: string }) {
  const t = await getTranslations('unavailable');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-heading text-2xl font-bold text-brand">{name}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
    </main>
  );
}
```

- [ ] **Step 4: Gate non-active clubs** in `app/s/[slug]/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { ClubTheme } from '@/components/club-theme';
import { ClubUnavailable } from '@/components/club-unavailable';
import { requireClub } from '@/lib/tenant';

export default async function TenantLayout({
  children, params,
}: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await requireClub(slug);
  return (
    <ClubTheme accent={club.brandAccent}>
      {club.status === 'active' ? children : <ClubUnavailable name={club.name} />}
    </ClubTheme>
  );
}
```

- [ ] **Step 5: Harden the proxy.** In `proxy.ts`, strip any inbound `x-tenant-slug` on every path (defense-in-depth; the header must only ever be set by us on the rewrite path):

```ts
export function proxy(request: NextRequest): NextResponse {
  const host = request.headers.get('host') ?? origin.rootDomain;
  const { pathname, search } = request.nextUrl;
  const decision = routeRequest({ host, pathname, search, origin });

  // Never trust an inbound tenant header — strip it on every request.
  const headers = new Headers(request.headers);
  headers.delete('x-tenant-slug');

  if (decision.type === 'redirect') {
    return NextResponse.redirect(decision.url, decision.status);
  }
  if (decision.type === 'rewrite') {
    const url = request.nextUrl.clone();
    url.pathname = decision.pathname;
    headers.set('x-tenant-slug', decision.slug);
    return NextResponse.rewrite(url, { request: { headers } });
  }
  return NextResponse.next({ request: { headers } });
}
```

- [ ] **Step 6: Add the failing/asserting proxy test.** In `src/proxy.test.ts`, add a case proving a spoofed inbound header is stripped on a pass-through path:

```ts
it('strips an inbound x-tenant-slug on apex pass-through', () => {
  const res = proxy(req('http://localhost:3000/', 'localhost:3000'));
  // The forwarded request header is cleared (only our rewrite path sets it).
  expect(res.headers.get('x-middleware-request-x-tenant-slug')).toBeNull();
});
```

> If `NextResponse.next({ request: { headers } })` does not expose stripped headers via `x-middleware-request-*` in the test, assert instead that a request carrying a spoofed `x-tenant-slug` on a rewrite path still results in the slug derived from the host (not the spoofed value). Keep the assertion meaningful.

- [ ] **Step 7: Verify + commit.** Run: `pnpm test src/proxy.test.ts` (PASS), `pnpm exec tsc --noEmit` (clean), `pnpm build` (compiles). Manually: a suspended club's subdomain shows the branded unavailable screen; an unknown apex path shows the branded 404.

```bash
git add app/not-found.tsx src/components/club-unavailable.tsx app/s/\[slug\]/layout.tsx proxy.ts src/proxy.test.ts messages/tr.json messages/en.json
git commit -m "feat: branded not-found, suspended-club gate, strip inbound tenant header"
```

---

### Task 14: Member request-to-join flow

**Files:**
- Create: `src/lib/join.ts`, `src/lib/join.integration.test.ts`
- Rewrite: `app/s/[slug]/join/page.tsx` (session-aware) + create `app/s/[slug]/join/actions.ts`
- Modify: `messages/tr.json`, `messages/en.json` (add `join` keys)

**Interfaces:**
- Produces: `requestToJoin(db: DB, input: { clubId: string; userId: string }): Promise<'created' | 'exists' | 'club_inactive'>` — no-op returning the existing status when a membership already exists; creates a `member`/`pending` row otherwise; refuses when the club is not `active`.
- Consumes: `getSession` (Task 2); `getMembership` (Task 3); `requireClub` (existing); `env`, `parseAppOrigin`, `apexUrl`, `clubUrl` for the signed-out sign-in link.

- [ ] **Step 1: Write the failing integration test.** Create `src/lib/join.integration.test.ts` (Task 10 harness). Assert: joining an active club creates a `member`/`pending` membership and returns `'created'`; a second call returns `'exists'` and does not duplicate (the `memberships_user_club_uq` index holds); joining a `pending`/`suspended` club returns `'club_inactive'` and writes nothing.

```ts
it('creates one pending membership and is idempotent', async () => {
  const uid = `u-${Date.now()}`;
  await db.insert(schema.user).values({ id: uid, name: 'J', email: `${uid}@t.co` });
  const [club] = await db.insert(schema.clubs).values({ slug: `j-${Date.now()}`, name: 'J', status: 'active' }).returning();
  expect(await requestToJoin(db, { clubId: club.id, userId: uid })).toBe('created');
  expect(await requestToJoin(db, { clubId: club.id, userId: uid })).toBe('exists');
  const rows = await db.select().from(schema.memberships)
    .where(and(eq(schema.memberships.clubId, club.id), eq(schema.memberships.userId, uid)));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ role: 'member', status: 'pending' });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm test:integration src/lib/join.integration.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/join.ts`:**

```ts
import { eq } from 'drizzle-orm';
import { clubs, memberships } from '@/db/schema';
import { getMembership, type DB } from '@/lib/membership';

export async function requestToJoin(
  db: DB,
  input: { clubId: string; userId: string },
): Promise<'created' | 'exists' | 'club_inactive'> {
  const [club] = await db.select({ status: clubs.status }).from(clubs).where(eq(clubs.id, input.clubId)).limit(1);
  if (!club || club.status !== 'active') return 'club_inactive';
  const existing = await getMembership(db, input.userId, input.clubId);
  if (existing) return 'exists';
  await db.insert(memberships).values({ userId: input.userId, clubId: input.clubId, role: 'member', status: 'pending' });
  return 'created';
}
```

- [ ] **Step 4: Run to verify pass.** Run: `pnpm test:integration src/lib/join.integration.test.ts` — Expected: PASS.

- [ ] **Step 5: Add `join` message keys** to both files. TR: `{ "signInToJoin": "Katılmak için giriş yap", "requestToJoin": "Katılma isteği gönder", "pending": "Katılma isteğin onay bekliyor.", "approved": "Bu kulübün üyesisin.", "rejected": "Katılma isteğin reddedildi.", "banned": "Şu anda bu kulüpte rezervasyon yapamazsın." }`. EN mirror. (`joinTitle`/`joinBody`/`joinCta` already exist under `club`.)

- [ ] **Step 6: Create the action** `app/s/[slug]/join/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { getSession } from '@/lib/session';
import { requireClub } from '@/lib/tenant';
import { requestToJoin } from '@/lib/join';

export async function joinAction(slug: string) {
  const session = await getSession();
  if (!session) return;
  const club = await requireClub(slug);
  await requestToJoin(db, { clubId: club.id, userId: session.user.id });
  revalidatePath(`/s/${slug}/join`);
}
```

- [ ] **Step 7: Rewrite the join page** `app/s/[slug]/join/page.tsx` — session-aware, per-page `noindex`, signed-out CTA links to apex sign-in with a return to this page:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { env } from '@/env';
import { parseAppOrigin, apexUrl, clubUrl } from '@/lib/urls';
import { requireClub } from '@/lib/tenant';
import { getSession } from '@/lib/session';
import { getMembership } from '@/lib/membership';
import { db } from '@/db';
import { buttonVariants } from '@/components/ui/button';
import { joinAction } from './actions';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await requireClub(slug);
  const t = await getTranslations('club');
  const tj = await getTranslations('join');
  const session = await getSession();

  if (!session) {
    const origin = parseAppOrigin(env.APP_URL);
    const back = `${clubUrl(slug, origin)}/join`;
    const signInHref = `${apexUrl('/sign-in', origin)}?redirect=${encodeURIComponent(back)}`;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="font-heading text-2xl font-bold text-brand">{t('joinTitle', { name: club.name })}</h1>
        <p className="text-muted-foreground">{t('joinBody')}</p>
        <a href={signInHref} className={buttonVariants({ className: 'w-full' })}>{tj('signInToJoin')}</a>
      </main>
    );
  }

  const membership = await getMembership(db, session.user.id, club.id);
  const statusMsg = membership
    ? { pending: tj('pending'), approved: tj('approved'), rejected: tj('rejected'), banned: tj('banned') }[membership.status]
    : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-heading text-2xl font-bold text-brand">{t('joinTitle', { name: club.name })}</h1>
      {membership ? (
        <p className="text-muted-foreground">{statusMsg}</p>
      ) : (
        <form action={joinAction.bind(null, slug)} className="w-full">
          <p className="mb-4 text-muted-foreground">{t('joinBody')}</p>
          <button type="submit" className={buttonVariants({ className: 'w-full' })}>{tj('requestToJoin')}</button>
        </form>
      )}
    </main>
  );
}
```

> Note: the club public page (`app/s/[slug]/page.tsx`) already links to `/join`; no change needed there. The layout (Task 13) already blocks non-active clubs, so this page only renders for active clubs.

- [ ] **Step 8: Verify + commit.** Run: `pnpm exec tsc --noEmit` (clean), `pnpm build` (compiles). Manually (via `demo.localhost:3000/join`): signed-out shows the sign-in CTA; after signing in and returning, "Request to join" creates a pending membership and the page then shows the pending status.

```bash
git add src/lib/join.ts src/lib/join.integration.test.ts app/s/\[slug\]/join messages/tr.json messages/en.json
git commit -m "feat: member request-to-join flow with status display"
```

---

### Task 15: Owner members management (approve / reject / assign skill)

**Files:**
- Create: `src/lib/members-admin.ts`, `src/lib/members-admin.integration.test.ts`
- Create: `app/s/[slug]/manage/layout.tsx` (owner guard + chrome), `app/s/[slug]/manage/members/page.tsx`, `app/s/[slug]/manage/members/actions.ts`
- Modify: `messages/tr.json`, `messages/en.json` (add `manage` namespace)

**Interfaces:**
- Produces:
  - `setMembershipStatus(db: DB, input: { membershipId: string; clubId: string; status: 'approved' | 'rejected' }): Promise<boolean>` — updates only when the membership belongs to `clubId` (returns whether a row changed); prevents cross-club tampering.
  - `assignSkillLevel(db: DB, input: { membershipId: string; clubId: string; skillLevelId: string | null }): Promise<boolean>` — validates the skill level belongs to the same club (when non-null) before setting.
- Consumes: `requireOwner` (Task 3); `memberships`, `skillLevels`, `user` from schema.

- [ ] **Step 1: Write the failing integration test.** Create `src/lib/members-admin.integration.test.ts` (Task 10 harness). Assert: `setMembershipStatus` flips a pending member to approved and returns `true`; a `membershipId` from a different club returns `false` and changes nothing (scope check); `assignSkillLevel` sets a level from the same club and rejects (`false`) a level belonging to another club.

```ts
it('approves only memberships of the given club', async () => {
  const uid = `u-${Date.now()}`;
  await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
  const [c1] = await db.insert(schema.clubs).values({ slug: `c1-${Date.now()}`, name: 'C1', status: 'active' }).returning();
  const [c2] = await db.insert(schema.clubs).values({ slug: `c2-${Date.now()}`, name: 'C2', status: 'active' }).returning();
  const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'pending' }).returning();
  expect(await setMembershipStatus(db, { membershipId: m.id, clubId: c2.id, status: 'approved' })).toBe(false);
  expect(await setMembershipStatus(db, { membershipId: m.id, clubId: c1.id, status: 'approved' })).toBe(true);
  const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
  expect(after.status).toBe('approved');
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm test:integration src/lib/members-admin.integration.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/members-admin.ts`:**

```ts
import { and, eq } from 'drizzle-orm';
import { memberships, skillLevels } from '@/db/schema';
import type { DB } from '@/lib/membership';

export async function setMembershipStatus(
  db: DB,
  input: { membershipId: string; clubId: string; status: 'approved' | 'rejected' },
): Promise<boolean> {
  const res = await db.update(memberships)
    .set({ status: input.status })
    .where(and(eq(memberships.id, input.membershipId), eq(memberships.clubId, input.clubId)))
    .returning({ id: memberships.id });
  return res.length > 0;
}

export async function assignSkillLevel(
  db: DB,
  input: { membershipId: string; clubId: string; skillLevelId: string | null },
): Promise<boolean> {
  if (input.skillLevelId) {
    const [lvl] = await db.select({ id: skillLevels.id }).from(skillLevels)
      .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId))).limit(1);
    if (!lvl) return false;
  }
  const res = await db.update(memberships)
    .set({ skillLevelId: input.skillLevelId })
    .where(and(eq(memberships.id, input.membershipId), eq(memberships.clubId, input.clubId)))
    .returning({ id: memberships.id });
  return res.length > 0;
}
```

- [ ] **Step 4: Run to verify pass.** Run: `pnpm test:integration src/lib/members-admin.integration.test.ts` — Expected: PASS.

- [ ] **Step 5: Add the `manage` namespace** to both files. TR: `{ "title": "Kulüp yönetimi", "members": "Üyeler", "pendingHeading": "Onay bekleyenler", "approvedHeading": "Üyeler", "approve": "Onayla", "reject": "Reddet", "skillLevel": "Seviye", "noSkillLevels": "Henüz seviye tanımlanmadı.", "none": "—", "empty": "Henüz üye yok." }`. EN mirror.

- [ ] **Step 6: Create the owner guard layout** `app/s/[slug]/manage/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireOwner } from '@/lib/membership';

export default async function ManageLayout({
  children, params,
}: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireOwner(slug);
  const t = await getTranslations('manage');
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 font-heading text-2xl font-bold text-brand">{t('title')}</h1>
      {children}
    </div>
  );
}
```

- [ ] **Step 7: Create the actions** `app/s/[slug]/manage/members/actions.ts` — each re-guards with `requireOwner(slug)` (never trust the client), then calls the logic with the guarded `club.id`, then `revalidatePath`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { setMembershipStatus, assignSkillLevel } from '@/lib/members-admin';

export async function approveMemberAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug);
  await setMembershipStatus(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, status: 'approved' });
  revalidatePath(`/s/${slug}/manage/members`);
}
export async function rejectMemberAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug);
  await setMembershipStatus(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, status: 'rejected' });
  revalidatePath(`/s/${slug}/manage/members`);
}
export async function assignSkillAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug);
  const raw = String(formData.get('skillLevelId') ?? '');
  await assignSkillLevel(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, skillLevelId: raw || null });
  revalidatePath(`/s/${slug}/manage/members`);
}
```

- [ ] **Step 8: Create the members page** `app/s/[slug]/manage/members/page.tsx` (server). Re-guard with `requireOwner(slug)` to get the club id; list memberships joined to `user` for name/email, split into pending (approve/reject forms bound to `slug`) and approved (with a skill-level select from the club's `skillLevels`, submitting `assignSkillAction`). Approve/reject are plain single-button `<form action={approveMemberAction.bind(null, slug)}>` (no RHF/Field needed). The skill-level control is a native `<select name="skillLevelId">` (options = the club's skill levels + an empty "none" option) wrapped in `Field`/`FieldLabel` and auto-submitted or paired with an assign button — no shadcn `Select` dependency. When the club has no skill levels, show `t('noSkillLevels')` instead of the select. Empty roster → `t('empty')`. Bind actions with `.bind(null, slug)`.

- [ ] **Step 9: Verify + commit.** Run: `pnpm exec tsc --noEmit` (clean), `pnpm build` (compiles). Manually (`demo.localhost:3000/manage/members` as the demo club's owner): a pending join request appears; approving flips it to approved and it moves to the members list; a non-owner gets a 404.

```bash
git add src/lib/members-admin.ts src/lib/members-admin.integration.test.ts app/s/\[slug\]/manage messages/tr.json messages/en.json
git commit -m "feat: owner members management with approve/reject and skill assignment"
```

---

## Self-Review

**Spec coverage (recommended scope):**
- Accounts / auth: sign-up (§16, first/last/phone/email/password), sign-in, Google, email verification (§16), password reset — Tasks 6–8. ✅
- KVKK consent at sign-up recorded with document + version + timestamp (§14) — Task 4 (+ privacy stub Task 7; full text/export/deletion deferred by scope decision). ✅
- Roles & authz (admin global flag; owner/member per club) (§2) — Tasks 2–3. ✅
- Admin-first club creation + assign owner; owner-request path; lifecycle pending→active→suspended (§3, §2) — Tasks 10–12. ✅
- Member request-to-join → owner approve; skill-level assignment; multi-club (one membership per club) (§3, §7) — Tasks 14–15. ✅
- Subdomain routing / reserved segments / never-trust-header (§4, carry-forwards) — Tasks 1, 13. ✅
- Branded not-found + suspended-club UX (carry-forward) — Task 13. ✅
- i18n TR/EN on every surface (§15) — every UI task. ✅

**Deferred by the chosen scope (not gaps):** KVKK data export, account deletion/anonymization, full privacy/clarification page (§14); admin "Act as owner" impersonation + audit banner (§2). `robots.txt Disallow: /join` is now backed by per-page `noindex` (Task 14). Rate-limiter route wiring is Plan 6.

**Type consistency:** `DB` is defined once in `membership.ts` and imported by `consent.ts`, `audit.ts`, `clubs-admin.ts`, `club-request.ts`, `join.ts`, `members-admin.ts`. Logic functions uniformly take `db: DB` first. Server actions import `db` from `@/db`. Guard names (`requireUser`, `requireAdmin`, `requireOwner`, `getMembership`, `getSession`) are used consistently. Membership `role`/`status` values match `enums.ts`. Club `status` values (`active`/`pending`/`suspended`) match.

**Forms & validation:** every form uses the shadcn `Field` family (the deprecated `Form` component is never used). Auth forms (Tasks 6–8) use react-hook-form + `zodResolver` and call `authClient`; server-action forms (Tasks 10, 12) use `useActionState` + `Field`/`FieldError` with the shared zod schema re-parsed **inside the action** — client validation is UX only, the server is authoritative, and pure-core (`validateSlug`, ownership/status checks) adds the domain layer. Schemas live once in `src/lib/schemas.ts`, shared by client and server.

**Placeholder scan:** transactions use `tx as unknown as DB` for `logAudit` inside a transaction — flagged inline as intentional; the implementer may instead thread the tx type properly. Library specifics flagged for verification against installed types/Context7 rather than assumed: Better Auth method names (`signUp.email` extra fields, `signIn.social`, password-reset/verify methods, `databaseHooks.user.create.after`); the `@hookform/resolvers/zod` import path under zod v4; the base-nova `field.tsx` export surface (`FieldError`, `orientation` prop); `Checkbox.onCheckedChange`'s value type; and zod v4's `z.string().email()` vs top-level `z.email()`. Three test notes (the `vi.spyOn` intra-module concern in Task 3; the `x-middleware-request-*` assertion in Task 13; the `Record<typeof res.error, …>` index-type widening in Task 10) give the implementer a concrete fallback without weakening the test.
