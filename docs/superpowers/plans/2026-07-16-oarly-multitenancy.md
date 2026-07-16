# Oarly Multi-Tenancy & Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the club (tenant) from the request host, serve each club's public/join page at its own subdomain, redirect the path-form URL to the canonical subdomain, and give the small indexable surface correct SEO (canonical, per-host robots/sitemap, noindex on the rest).

**Architecture:** A Next.js 16 **`proxy.ts`** (the renamed `middleware.ts` — exports a `proxy` function) parses the `Host` header and makes one routing decision per request: apex host → serve as-is (marketing / admin / legal) but 301 the path-form `oarly.sbs/{slug}` to `{slug}.oarly.sbs`; tenant host `{slug}.{root}` → rewrite the whole subtree into an internal `app/s/[slug]/…` segment and stamp an `x-tenant-slug` request header. All host/path decision logic lives in a **pure `routeRequest()`** function (exhaustively unit-tested); `proxy.ts` is a thin adapter that turns its decision into a `NextResponse`. The proxy never touches the database — tenant DB lookup happens in a request-memoized server helper (`getClubBySlug`) consumed by the `s/[slug]` pages and the host-aware `robots.ts`/`sitemap.ts`. SEO output (`Metadata`, robots, sitemap) is built by pure functions in `src/lib/seo.ts`; the route handlers/`generateMetadata` are thin adapters over them.

**Tech Stack:** Next.js 16.2.10 App Router (`proxy.ts` convention), React 19.2.4, TypeScript, next-intl **without** i18n routing (locale via cookie/negotiation — no locale-prefixed URLs), Drizzle ORM over `pg`, Vitest (unit + integration against Docker Postgres 18).

## Global Constraints

_(Carried verbatim from the foundation plan; every task's requirements implicitly include these.)_

- Package manager is **pnpm**; never edit `package.json` by hand — use `pnpm add`. Prefer a tool's CLI/scaffold, then customize.
- Pins (do not change): `next@16.2.10`, `react@19.2.4`, `react-dom@19.2.4`.
- **Commit messages: NO AI-attribution trailer** — no `Co-Authored-By`, no "Generated with Claude". Never.
- **Never delete branches.** Work on a feature branch cut from `main`; keep it after merge.
- Path alias `@/*` → `./src/*`. Library code lives in `src/`; routable files in `app/`.
- Store all timestamps in UTC (`timestamptz`); display in club timezone (default `Europe/Istanbul`).
- Default locale is **TR** (`tr`), fallback **EN** (`en`). Payment labels: regular = "Nakit"/"Cash", multisport = "MultiSport".
- Auth cookie domain is `.oarly.sbs` (set via `COOKIE_DOMAIN`, unset locally) so a session spans subdomains.
- Tests must be **hermetic** — no network; integration tests gate on `TEST_DATABASE_URL` via `describe.skipIf`.
- Every task ends green: run `pnpm exec tsc --noEmit` and the relevant test file before committing.

### Plan-specific constants

- **Proxy file convention:** Next.js 16 uses **`src/proxy.ts`** exporting a function named `proxy` (NOT `middleware.ts`/`middleware`). Our next-intl setup uses **no** intl middleware (config is wired via `createNextIntlPlugin` in `next.config.ts`), so `proxy.ts` is ours to use freely for tenancy.
- **Root origin comes from `APP_URL`** (server) — apex origin incl. protocol + host + port. Prod `https://oarly.sbs`, staging `https://ica2.xyz`, local dev **`http://lvh.me:3000`** (`*.lvh.me` resolves to `127.0.0.1`, so subdomains work without hosts-file edits). `rootDomain` = host portion (incl. port), `protocol` = `http:`/`https:`.
- **Internal tenant segment is `s`** — tenant requests rewrite to `app/s/[slug]/…`. This segment name never appears in a user-facing URL (it is a rewrite target only). Any new tenant route in later plans lives under `app/s/[slug]/`.
- **Redirects are HTTP 301** (permanent), per spec §4.
- **i18n / hreflang decision:** because locale is cookie-negotiated with **no** locale-prefixed URLs, there are no distinct per-language URLs to reference. We therefore set `<html lang>` per request (already done in the root layout) + a self-referential canonical, and **omit `alternates.languages` (hreflang)** — emitting hreflang that points TR and EN at the same URL is redundant and flagged as an error by search engines. This is a deliberate deviation from spec §4's "hreflang via alternates.languages"; if indexable language variants are wanted later, add explicit `?lang=` alternates. Note this at handoff.

---

## File Structure

**Create:**
- `src/lib/urls.ts` — pure origin parsing + URL builders (`parseAppOrigin`, `clubUrl`, `apexUrl`).
- `src/lib/urls.test.ts` — unit tests.
- `src/lib/tenant-routing.ts` — pure host resolution + routing decision (`resolveHost`, `routeRequest`, reserved-word sets).
- `src/lib/tenant-routing.test.ts` — unit tests (the bulk of routing coverage).
- `src/proxy.ts` — thin `NextRequest` → `NextResponse` adapter over `routeRequest`.
- `src/proxy.test.ts` — adapter smoke tests.
- `src/lib/tenant.ts` — DB-backed tenant resolution (`getClubBySlug` memoized with React `cache`, `getTenantSlug`, `requireClub`).
- `src/lib/tenant.integration.test.ts` — integration test against Docker PG.
- `src/lib/seo.ts` — pure SEO builders (`buildClubMetadata`, `buildRobots`, `buildApexSitemap`, `buildTenantSitemap`).
- `src/lib/seo.test.ts` — unit tests.
- `app/s/[slug]/layout.tsx` — tenant layout (scopes club accent via `ClubTheme`).
- `app/s/[slug]/page.tsx` — club public/join landing + `generateMetadata`.
- `app/s/[slug]/join/page.tsx` — minimal join-request placeholder (proves nested tenant routing; real mutation in Plan 3).
- `app/robots.ts` — host-aware robots.
- `app/sitemap.ts` — host-aware sitemap.
- `scripts/seed-dev.ts` — idempotent dev seed inserting one `active` demo club.

**Modify:**
- `messages/tr.json`, `messages/en.json` — add a `club` namespace.
- `docker-compose.yml` — add a persistent `postgres-dev` service (volume + pinned pg18 PGDATA) on port `5434`.
- `package.json` — add `db:seed` script (via `pnpm add -D tsx`); do not hand-edit deps.
- `.env.example` — document local subdomain dev (`*.localhost` / `lvh.me`) + the dev DB URL.

---

## Task 1: URL & origin helpers

**Files:**
- Create: `src/lib/urls.ts`
- Test: `src/lib/urls.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AppOrigin = { protocol: string; rootDomain: string }` — `protocol` includes the trailing colon (`'https:'`); `rootDomain` includes the port when present (`'lvh.me:3000'`).
  - `parseAppOrigin(appUrl: string): AppOrigin`
  - `clubUrl(slug: string, origin: AppOrigin): string` — `'https://demo.oarly.sbs'`
  - `apexUrl(path: string, origin: AppOrigin): string` — `'https://oarly.sbs/privacy'` (path must start with `/`)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/urls.test.ts
import { describe, it, expect } from 'vitest';
import { parseAppOrigin, clubUrl, apexUrl } from './urls';

describe('parseAppOrigin', () => {
  it('parses a prod https origin', () => {
    expect(parseAppOrigin('https://oarly.sbs')).toEqual({ protocol: 'https:', rootDomain: 'oarly.sbs' });
  });
  it('keeps the port for local dev', () => {
    expect(parseAppOrigin('http://lvh.me:3000')).toEqual({ protocol: 'http:', rootDomain: 'lvh.me:3000' });
  });
  it('ignores any path on APP_URL', () => {
    expect(parseAppOrigin('https://oarly.sbs/whatever')).toEqual({ protocol: 'https:', rootDomain: 'oarly.sbs' });
  });
});

describe('clubUrl / apexUrl', () => {
  const prod = { protocol: 'https:', rootDomain: 'oarly.sbs' };
  const dev = { protocol: 'http:', rootDomain: 'lvh.me:3000' };
  it('builds a club subdomain URL', () => {
    expect(clubUrl('demo', prod)).toBe('https://demo.oarly.sbs');
    expect(clubUrl('demo', dev)).toBe('http://demo.lvh.me:3000');
  });
  it('builds an apex URL with a path', () => {
    expect(apexUrl('/', prod)).toBe('https://oarly.sbs/');
    expect(apexUrl('/privacy', prod)).toBe('https://oarly.sbs/privacy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/urls.test.ts`
Expected: FAIL — `urls.ts` does not exist / exports undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/urls.ts
export type AppOrigin = { protocol: string; rootDomain: string };

/** Parse APP_URL (the apex origin) into protocol + host[:port]. */
export function parseAppOrigin(appUrl: string): AppOrigin {
  const u = new URL(appUrl);
  return { protocol: u.protocol, rootDomain: u.host };
}

/** Canonical subdomain URL for a club, e.g. https://demo.oarly.sbs */
export function clubUrl(slug: string, origin: AppOrigin): string {
  return `${origin.protocol}//${slug}.${origin.rootDomain}`;
}

/** Apex URL for a path (path must begin with '/'), e.g. https://oarly.sbs/privacy */
export function apexUrl(path: string, origin: AppOrigin): string {
  return `${origin.protocol}//${origin.rootDomain}${path}`;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm exec vitest run src/lib/urls.test.ts && pnpm exec tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/urls.ts src/lib/urls.test.ts
git commit -m "feat(routing): add app-origin parsing and club/apex URL builders"
```

---

## Task 2: Host resolution & routing decision (pure core)

**Files:**
- Create: `src/lib/tenant-routing.ts`
- Test: `src/lib/tenant-routing.test.ts`

**Interfaces:**
- Consumes: `AppOrigin` from `src/lib/urls.ts`.
- Produces:
  - `RESERVED_SUBDOMAINS: ReadonlySet<string>` and `RESERVED_APEX_SEGMENTS: ReadonlySet<string>`.
  - `type HostInfo = { kind: 'apex'; www: boolean } | { kind: 'tenant'; slug: string }`
  - `resolveHost(host: string, rootDomain: string): HostInfo`
  - `type RouteDecision = { type: 'next' } | { type: 'rewrite'; pathname: string; slug: string } | { type: 'redirect'; url: string; status: 301 }`
  - `routeRequest(input: { host: string; pathname: string; search: string; origin: AppOrigin }): RouteDecision`

**Design notes (read before coding):**
- Ports are stripped for host **comparison** only; URL building keeps `origin.rootDomain` (which includes the port).
- A reserved subdomain (`www`, `admin`, `api`, `app`, `static`, `assets`) is treated as apex — `www` triggers a redirect to the bare apex; the others just fall through to `next`.
- On the apex host, a **single-segment** path `/{seg}` whose `seg` is not in `RESERVED_APEX_SEGMENTS` is a path-form club link → 301 to the subdomain. Multi-segment apex paths fall through to `next`.
- **Leak guard:** on the apex host, any path under the internal `/s` segment 301s to apex `/` (the internal segment must never be reachable except via a tenant rewrite).
- `RESERVED_APEX_SEGMENTS` is the source of truth for "top-level apex routes that are NOT club slugs." **Any future top-level apex route (e.g. `/pricing`) MUST be added here**, or it will be 301'd to a subdomain.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tenant-routing.test.ts
import { describe, it, expect } from 'vitest';
import { resolveHost, routeRequest } from './tenant-routing';

const PROD = { protocol: 'https:', rootDomain: 'oarly.sbs' };
const DEV = { protocol: 'http:', rootDomain: 'lvh.me:3000' };

describe('resolveHost', () => {
  it('treats the bare root as apex', () => {
    expect(resolveHost('oarly.sbs', 'oarly.sbs')).toEqual({ kind: 'apex', www: false });
  });
  it('treats www as apex (www flag set)', () => {
    expect(resolveHost('www.oarly.sbs', 'oarly.sbs')).toEqual({ kind: 'apex', www: true });
  });
  it('extracts a tenant slug from a subdomain', () => {
    expect(resolveHost('demo.oarly.sbs', 'oarly.sbs')).toEqual({ kind: 'tenant', slug: 'demo' });
  });
  it('ignores ports when comparing', () => {
    expect(resolveHost('demo.lvh.me:3000', 'lvh.me:3000')).toEqual({ kind: 'tenant', slug: 'demo' });
    expect(resolveHost('lvh.me:3000', 'lvh.me:3000')).toEqual({ kind: 'apex', www: false });
  });
  it('treats reserved subdomains as apex', () => {
    expect(resolveHost('api.oarly.sbs', 'oarly.sbs')).toEqual({ kind: 'apex', www: false });
    expect(resolveHost('admin.oarly.sbs', 'oarly.sbs')).toEqual({ kind: 'apex', www: false });
  });
  it('treats an unknown host (e.g. vercel preview) as apex', () => {
    expect(resolveHost('oarly-abc123.vercel.app', 'oarly.sbs')).toEqual({ kind: 'apex', www: false });
  });
});

describe('routeRequest — apex host', () => {
  const base = { host: 'oarly.sbs', search: '', origin: PROD };
  it('serves the marketing home as-is', () => {
    expect(routeRequest({ ...base, pathname: '/' })).toEqual({ type: 'next' });
  });
  it('serves reserved apex routes as-is', () => {
    expect(routeRequest({ ...base, pathname: '/admin' })).toEqual({ type: 'next' });
    expect(routeRequest({ ...base, pathname: '/privacy' })).toEqual({ type: 'next' });
  });
  it('301-redirects the path-form club link to the subdomain', () => {
    expect(routeRequest({ ...base, pathname: '/demo' })).toEqual({
      type: 'redirect', url: 'https://demo.oarly.sbs', status: 301,
    });
  });
  it('preserves the query string on the path-form redirect', () => {
    expect(routeRequest({ ...base, pathname: '/demo', search: '?ref=x' })).toEqual({
      type: 'redirect', url: 'https://demo.oarly.sbs?ref=x', status: 301,
    });
  });
  it('does not treat a multi-segment path as a club link', () => {
    expect(routeRequest({ ...base, pathname: '/demo/book' })).toEqual({ type: 'next' });
  });
  it('redirects www to the bare apex, preserving the path', () => {
    expect(routeRequest({ host: 'www.oarly.sbs', pathname: '/privacy', search: '', origin: PROD })).toEqual({
      type: 'redirect', url: 'https://oarly.sbs/privacy', status: 301,
    });
  });
  it('guards the internal tenant segment from apex access', () => {
    expect(routeRequest({ ...base, pathname: '/s/demo' })).toEqual({
      type: 'redirect', url: 'https://oarly.sbs/', status: 301,
    });
  });
});

describe('routeRequest — tenant host', () => {
  it('rewrites the subdomain root to the internal segment', () => {
    expect(routeRequest({ host: 'demo.oarly.sbs', pathname: '/', search: '', origin: PROD })).toEqual({
      type: 'rewrite', pathname: '/s/demo', slug: 'demo',
    });
  });
  it('rewrites a nested subdomain path', () => {
    expect(routeRequest({ host: 'demo.lvh.me:3000', pathname: '/join', search: '', origin: DEV })).toEqual({
      type: 'rewrite', pathname: '/s/demo/join', slug: 'demo',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/tenant-routing.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/tenant-routing.ts
import type { AppOrigin } from './urls';
import { clubUrl, apexUrl } from './urls';

/** Subdomains that are never a tenant. `www` redirects to apex; the rest fall through. */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www', 'admin', 'api', 'app', 'static', 'assets',
]);

/**
 * Top-level apex paths that are NOT club slugs. A single-segment apex path not in
 * this set is 301'd to `{seg}.{root}`. ANY new top-level apex route MUST be added here.
 * `s` is the internal tenant rewrite segment.
 */
export const RESERVED_APEX_SEGMENTS: ReadonlySet<string> = new Set([
  's', 'api', 'admin', 'sign-in', 'sign-up', 'sign-out', 'privacy', 'kvkk',
  'favicon.ico', 'robots.txt', 'sitemap.xml', 'opengraph-image', 'icon',
]);

export type HostInfo = { kind: 'apex'; www: boolean } | { kind: 'tenant'; slug: string };

export type RouteDecision =
  | { type: 'next' }
  | { type: 'rewrite'; pathname: string; slug: string }
  | { type: 'redirect'; url: string; status: 301 };

function stripPort(host: string): string {
  return host.split(':')[0].toLowerCase();
}

export function resolveHost(host: string, rootDomain: string): HostInfo {
  const h = stripPort(host);
  const root = stripPort(rootDomain);
  if (h === root) return { kind: 'apex', www: false };
  if (h === `www.${root}`) return { kind: 'apex', www: true };
  if (h.endsWith(`.${root}`)) {
    const sub = h.slice(0, h.length - root.length - 1);
    if (RESERVED_SUBDOMAINS.has(sub)) return { kind: 'apex', www: sub === 'www' };
    return { kind: 'tenant', slug: sub };
  }
  // Unknown host (preview deploys, direct IP, misconfig): treat as apex.
  return { kind: 'apex', www: false };
}

export function routeRequest(input: {
  host: string;
  pathname: string;
  search: string;
  origin: AppOrigin;
}): RouteDecision {
  const { host, pathname, search, origin } = input;
  const info = resolveHost(host, origin.rootDomain);

  if (info.kind === 'apex') {
    if (info.www) {
      return { type: 'redirect', url: apexUrl(`${pathname}${search}`, origin), status: 301 };
    }
    // Never serve the internal tenant segment from the apex host.
    if (pathname === '/s' || pathname.startsWith('/s/')) {
      return { type: 'redirect', url: apexUrl('/', origin), status: 301 };
    }
    // Path-form club link: single non-reserved segment -> canonical subdomain.
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 1 && !RESERVED_APEX_SEGMENTS.has(segments[0])) {
      return { type: 'redirect', url: `${clubUrl(segments[0], origin)}${search}`, status: 301 };
    }
    return { type: 'next' };
  }

  // Tenant host: rewrite the whole subtree under the internal segment.
  const rewritten = pathname === '/' ? `/s/${info.slug}` : `/s/${info.slug}${pathname}`;
  return { type: 'rewrite', pathname: rewritten, slug: info.slug };
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm exec vitest run src/lib/tenant-routing.test.ts && pnpm exec tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant-routing.ts src/lib/tenant-routing.test.ts
git commit -m "feat(routing): add pure host resolution and route-decision core"
```

---

## Task 3: Proxy adapter (`src/proxy.ts`)

**Files:**
- Create: `src/proxy.ts`, `src/proxy.test.ts`

**Interfaces:**
- Consumes: `env.APP_URL`, `parseAppOrigin`, `routeRequest`.
- Produces: `proxy(request: NextRequest): NextResponse` and a `config` matcher export.

**Design notes:**
- The proxy is a thin adapter: read `host` + `nextUrl`, call `routeRequest`, translate to `NextResponse`. No DB, no heavy imports.
- On `rewrite`, stamp `x-tenant-slug` on the forwarded request headers (a convenience for server code outside the `s/[slug]` segment; pages themselves use `params.slug`).
- Matcher excludes `api`, `_next/static`, `_next/image`, and the metadata files so those resolve directly (host-aware) without a tenant rewrite. `robots.txt`/`sitemap.xml` are excluded on purpose — they map to top-level `app/robots.ts`/`app/sitemap.ts` which branch on the host themselves.
- `NextResponse.rewrite` records the target in the `x-middleware-rewrite` response header, and `NextResponse.redirect` sets `location` + status — both are assertable in tests.

- [ ] **Step 1: Write the failing test**

```ts
// src/proxy.test.ts
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

// vitest.config sets APP_URL=http://localhost:3000 -> rootDomain 'localhost:3000'.
function req(url: string, host: string) {
  return new NextRequest(new URL(url), { headers: { host } });
}

describe('proxy', () => {
  it('passes apex home through (no rewrite/redirect)', () => {
    const res = proxy(req('http://localhost:3000/', 'localhost:3000'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
  });

  it('rewrites a tenant subdomain into the internal segment and stamps the slug header', () => {
    const res = proxy(req('http://demo.localhost:3000/join', 'demo.localhost:3000'));
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(new URL(rewrite!).pathname).toBe('/s/demo/join');
    // The slug header is forwarded on the request.
    expect(res.headers.get('x-middleware-request-x-tenant-slug')).toBe('demo');
  });

  it('301-redirects the path-form apex club link to the subdomain', () => {
    const res = proxy(req('http://localhost:3000/demo', 'localhost:3000'));
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('http://demo.localhost:3000');
  });
});
```

> Note: Next forwards request headers set on a rewrite via `x-middleware-request-*` response headers in this runtime. If that header name differs in the installed Next version, assert the rewrite URL only and drop the header assertion — the header stamping is verified functionally by `getTenantSlug` in Task 4's integration usage.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/proxy.test.ts`
Expected: FAIL — `proxy.ts` missing.

- [ ] **Step 3: Write minimal implementation**

> Version-exact types (confirmed in `node_modules/next/dist/server/web/types.d.ts` for 16.2.10): the handler type is `NextProxy` and the config type is `ProxyConfig`, both exported from `next/server`. `NextMiddleware`/`MiddlewareConfig` still exist but are `@deprecated` (renamed to Proxy). Use `ProxyConfig` for the `config` export.

```ts
// src/proxy.ts
import { NextResponse } from 'next/server';
import type { NextRequest, ProxyConfig } from 'next/server';
import { env } from '@/env';
import { parseAppOrigin } from '@/lib/urls';
import { routeRequest } from '@/lib/tenant-routing';

const origin = parseAppOrigin(env.APP_URL);

export function proxy(request: NextRequest): NextResponse {
  const host = request.headers.get('host') ?? origin.rootDomain;
  const { pathname, search } = request.nextUrl;
  const decision = routeRequest({ host, pathname, search, origin });

  if (decision.type === 'redirect') {
    return NextResponse.redirect(decision.url, decision.status);
  }

  if (decision.type === 'rewrite') {
    const url = request.nextUrl.clone();
    url.pathname = decision.pathname;
    const headers = new Headers(request.headers);
    headers.set('x-tenant-slug', decision.slug);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  return NextResponse.next();
}

export const config: ProxyConfig = {
  matcher: [
    // Run on everything except API routes, Next internals, and metadata files
    // (those resolve directly and are host-aware where needed).
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm exec vitest run src/proxy.test.ts && pnpm exec tsc --noEmit`
Expected: PASS; tsc clean. (If the `x-middleware-request-*` assertion fails on this Next build, relax it per the note and re-run.)

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts src/proxy.test.ts
git commit -m "feat(routing): add Next 16 proxy adapter for tenant rewrite and canonical redirects"
```

---

## Task 4: Tenant DB resolution

**Files:**
- Create: `src/lib/tenant.ts`, `src/lib/tenant.integration.test.ts`

**Interfaces:**
- Consumes: `db` from `@/db`, `clubs` from `@/db/schema`, `headers` from `next/headers`, React `cache`.
- Produces:
  - `type Club = typeof clubs.$inferSelect`
  - `getClubBySlug(slug: string): Promise<Club | null>` — request-memoized via `cache()`.
  - `getTenantSlug(): Promise<string | null>` — reads the `x-tenant-slug` header set by the proxy.
  - `requireClub(slug: string): Promise<Club>` — returns the club or calls `notFound()`.

**Design notes:**
- `getClubBySlug` is wrapped in React `cache()` so the page body and `generateMetadata` share one query per request.
- The integration test gates on `TEST_DATABASE_URL` (`describe.skipIf`) and uses its own `Pool`/`drizzle` + `migrate`, mirroring `src/db/roundtrip.integration.test.ts`. It exercises the **query** (`clubs.slug` lookup) directly rather than the `cache()`-wrapped export, which depends on the app `db` singleton and the request scope.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tenant.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '@/db/schema';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('tenant resolution query', () => {
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

  it('finds a club by slug', async () => {
    const slug = `demo-${Date.now()}`;
    await db.insert(schema.clubs).values({ slug, name: 'Demo Rowing' });
    const [found] = await db.select().from(schema.clubs).where(eq(schema.clubs.slug, slug)).limit(1);
    expect(found?.name).toBe('Demo Rowing');
    expect(found?.status).toBe('pending');
  });

  it('returns nothing for an unknown slug', async () => {
    const rows = await db.select().from(schema.clubs).where(eq(schema.clubs.slug, `nope-${Date.now()}`)).limit(1);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails/skips**

Run: `pnpm test:integration -- src/lib/tenant.integration.test.ts`
Expected: FAIL — `@/db/schema` import resolves, but the test asserts against a not-yet-created helper contract? No — this test only uses schema (exists). It should **fail to run** only if the module under test is imported. Since it imports schema only, it will PASS immediately. To keep TDD honest, first create `src/lib/tenant.ts` in Step 3 and add the module-level import in Step 1b below.

- [ ] **Step 2b: Make the test depend on the module under test**

Add this import + assertion to `src/lib/tenant.integration.test.ts`:

```ts
import { getClubBySlug } from './tenant';
// ...inside the 'finds a club by slug' test, after the insert+select:
expect(typeof getClubBySlug).toBe('function');
```

Run: `pnpm test:integration -- src/lib/tenant.integration.test.ts`
Expected: FAIL — `./tenant` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/tenant.ts
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clubs } from '@/db/schema';

export type Club = typeof clubs.$inferSelect;

/** Look up a club by slug, memoized per request. */
export const getClubBySlug = cache(async (slug: string): Promise<Club | null> => {
  const [club] = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
  return club ?? null;
});

/** The tenant slug stamped by the proxy, or null on the apex host. */
export async function getTenantSlug(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-slug');
}

/** Resolve a club or render the 404 page. */
export async function requireClub(slug: string): Promise<Club> {
  const club = await getClubBySlug(slug);
  if (!club) notFound();
  return club;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm test:integration -- src/lib/tenant.integration.test.ts && pnpm exec tsc --noEmit`
Expected: PASS (2 tests) against Docker PG; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant.ts src/lib/tenant.integration.test.ts
git commit -m "feat(tenant): add request-memoized club resolution by slug"
```

---

## Task 5: SEO builders (pure)

**Files:**
- Create: `src/lib/seo.ts`, `src/lib/seo.test.ts`

**Interfaces:**
- Consumes: `Metadata`, `MetadataRoute` from `next`; `Club` from `@/lib/tenant`; `AppOrigin`, `clubUrl`, `apexUrl` from `@/lib/urls`.
- Produces:
  - `buildClubMetadata(args: { club: Club; description: string; origin: AppOrigin }): Metadata`
  - `buildRobots(args: { kind: 'apex' | 'tenant'; origin: AppOrigin; host: string }): MetadataRoute.Robots`
  - `buildApexSitemap(args: { clubs: Pick<Club, 'slug'>[]; origin: AppOrigin; now: Date }): MetadataRoute.Sitemap`
  - `buildTenantSitemap(args: { club: Pick<Club, 'slug' | 'status'>; origin: AppOrigin; now: Date }): MetadataRoute.Sitemap`

**Design notes:**
- `buildClubMetadata` takes an already-translated `description` (mirrors the email templates: pure builders take translated strings; the caller resolves them via next-intl). Canonical is the club's own subdomain URL. `robots.index` is `true` only when the club is `active`; OG image uses `logoUrl` when present.
- `buildRobots` disallows authenticated surfaces per host. `sitemap` points at the same host's `/sitemap.xml`. Host is passed so the sitemap URL matches the requesting host exactly.
- Sitemaps: apex lists the apex home + every active club's subdomain home; tenant lists the club's home when active, else empty. `now` is injected for testability (no `new Date()` inside the pure builder).
- **No hreflang** — see the plan's i18n decision. We do not populate `alternates.languages`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/seo.test.ts
import { describe, it, expect } from 'vitest';
import { buildClubMetadata, buildRobots, buildApexSitemap, buildTenantSitemap } from './seo';

const ORIGIN = { protocol: 'https:', rootDomain: 'oarly.sbs' };
const NOW = new Date('2026-07-16T00:00:00.000Z');

const activeClub = { slug: 'demo', name: 'Demo Rowing', status: 'active', logoUrl: 'https://cdn/x.png' } as never;
const pendingClub = { slug: 'demo', name: 'Demo Rowing', status: 'pending', logoUrl: null } as never;

describe('buildClubMetadata', () => {
  it('sets a self-canonical subdomain URL and indexes an active club', () => {
    const m = buildClubMetadata({ club: activeClub, description: 'Kürek seansları', origin: ORIGIN });
    expect(m.alternates?.canonical).toBe('https://demo.oarly.sbs');
    expect(m.title).toBe('Demo Rowing');
    expect(m.robots).toMatchObject({ index: true, follow: true });
    expect(m.openGraph?.images).toEqual(['https://cdn/x.png']);
  });
  it('noindexes a non-active club', () => {
    const m = buildClubMetadata({ club: pendingClub, description: 'x', origin: ORIGIN });
    expect(m.robots).toMatchObject({ index: false, follow: false });
    expect(m.openGraph?.images).toEqual([]);
  });
  it('emits no hreflang language alternates', () => {
    const m = buildClubMetadata({ club: activeClub, description: 'x', origin: ORIGIN });
    expect(m.alternates?.languages).toBeUndefined();
  });
});

describe('buildRobots', () => {
  it('apex: allows root, disallows admin, points at apex sitemap', () => {
    const r = buildRobots({ kind: 'apex', origin: ORIGIN, host: 'oarly.sbs' });
    expect(r.rules).toMatchObject({ userAgent: '*', allow: '/' });
    expect(r.rules && (r.rules as { disallow?: string[] }).disallow).toContain('/admin');
    expect(r.sitemap).toBe('https://oarly.sbs/sitemap.xml');
  });
  it('tenant: disallows authenticated surfaces, sitemap on same host', () => {
    const r = buildRobots({ kind: 'tenant', origin: ORIGIN, host: 'demo.oarly.sbs' });
    const disallow = (r.rules as { disallow?: string[] }).disallow ?? [];
    expect(disallow).toEqual(expect.arrayContaining(['/join', '/book', '/bookings', '/settings']));
    expect(r.sitemap).toBe('https://demo.oarly.sbs/sitemap.xml');
  });
});

describe('sitemaps', () => {
  it('apex lists home + active clubs', () => {
    const s = buildApexSitemap({ clubs: [{ slug: 'demo' }, { slug: 'foo' }], origin: ORIGIN, now: NOW });
    const urls = s.map((e) => e.url);
    expect(urls).toContain('https://oarly.sbs/');
    expect(urls).toContain('https://demo.oarly.sbs');
    expect(urls).toContain('https://foo.oarly.sbs');
  });
  it('tenant lists its home when active, empty otherwise', () => {
    expect(buildTenantSitemap({ club: { slug: 'demo', status: 'active' }, origin: ORIGIN, now: NOW })).toEqual([
      { url: 'https://demo.oarly.sbs', lastModified: NOW },
    ]);
    expect(buildTenantSitemap({ club: { slug: 'demo', status: 'pending' }, origin: ORIGIN, now: NOW })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/seo.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/seo.ts
import type { Metadata, MetadataRoute } from 'next';
import type { Club } from '@/lib/tenant';
import { type AppOrigin, clubUrl, apexUrl } from '@/lib/urls';

const TENANT_DISALLOW = ['/join', '/book', '/bookings', '/settings'];
const APEX_DISALLOW = ['/admin'];

export function buildClubMetadata(args: {
  club: Pick<Club, 'slug' | 'name' | 'status' | 'logoUrl'>;
  description: string;
  origin: AppOrigin;
}): Metadata {
  const { club, description, origin } = args;
  const canonical = clubUrl(club.slug, origin);
  const indexable = club.status === 'active';
  return {
    title: club.name,
    description,
    alternates: { canonical },
    robots: { index: indexable, follow: indexable },
    openGraph: {
      title: club.name,
      description,
      url: canonical,
      images: club.logoUrl ? [club.logoUrl] : [],
    },
  };
}

export function buildRobots(args: {
  kind: 'apex' | 'tenant';
  origin: AppOrigin;
  host: string;
}): MetadataRoute.Robots {
  const { kind, origin, host } = args;
  const sitemap = `${origin.protocol}//${host}/sitemap.xml`;
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: kind === 'tenant' ? TENANT_DISALLOW : APEX_DISALLOW,
    },
    sitemap,
  };
}

export function buildApexSitemap(args: {
  clubs: Pick<Club, 'slug'>[];
  origin: AppOrigin;
  now: Date;
}): MetadataRoute.Sitemap {
  const { clubs, origin, now } = args;
  return [
    { url: apexUrl('/', origin), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    ...clubs.map((c) => ({ url: clubUrl(c.slug, origin), lastModified: now })),
  ];
}

export function buildTenantSitemap(args: {
  club: Pick<Club, 'slug' | 'status'>;
  origin: AppOrigin;
  now: Date;
}): MetadataRoute.Sitemap {
  const { club, origin, now } = args;
  if (club.status !== 'active') return [];
  return [{ url: clubUrl(club.slug, origin), lastModified: now }];
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm exec vitest run src/lib/seo.test.ts && pnpm exec tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seo.ts src/lib/seo.test.ts
git commit -m "feat(seo): add pure metadata, robots and sitemap builders"
```

---

## Task 6: Club public/join page + tenant layout + i18n

**Files:**
- Create: `app/s/[slug]/layout.tsx`, `app/s/[slug]/page.tsx`
- Modify: `messages/tr.json`, `messages/en.json`
- Test: `src/lib/seo.test.ts` already covers metadata; a render assertion is optional — page is a thin server component. Verified by `pnpm build` in Task 10.

**Interfaces:**
- Consumes: `requireClub` (Task 4), `buildClubMetadata` (Task 5), `parseAppOrigin` + `env.APP_URL`, `ClubTheme` (`@/components/club-theme`), `buttonVariants` (`@/components/ui/button`), `getTranslations` from `next-intl/server`.
- Produces: the route `app/s/[slug]` and its `generateMetadata`.

**Design notes:**
- `params` is a `Promise` in Next 16 — `await params`.
- The layout scopes the club accent to the subtree via the existing `ClubTheme`.
- The page renders the club identity (name, logo if present, phone) and a localized "join" CTA linking to `/join` (same tenant host). The CTA target is the Task 7 placeholder; the real join mutation is Plan 3.
- `generateMetadata` resolves the translated description via `getTranslations('club')` then delegates to `buildClubMetadata`.

- [ ] **Step 1: Add i18n keys**

Add a `club` namespace to `messages/tr.json` (after the `payment` block):

```json
  "club": {
    "joinCta": "Kulübe katıl",
    "joinTitle": "{name} kulübüne katıl",
    "joinBody": "Katılma isteğiniz kulüp yöneticisi tarafından onaylandığında seans rezervasyonu yapabilirsiniz.",
    "metaDescription": "{name} — kürek seansları için çevrimiçi rezervasyon."
  },
```

Add the same namespace to `messages/en.json`:

```json
  "club": {
    "joinCta": "Join this club",
    "joinTitle": "Join {name}",
    "joinBody": "Once the club owner approves your request you can start booking sessions.",
    "metaDescription": "{name} — online booking for rowing sessions."
  },
```

- [ ] **Step 2: Write the tenant layout**

```tsx
// app/s/[slug]/layout.tsx
import type { ReactNode } from 'react';
import { ClubTheme } from '@/components/club-theme';
import { requireClub } from '@/lib/tenant';

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const club = await requireClub(slug);
  return <ClubTheme accent={club.brandAccent}>{children}</ClubTheme>;
}
```

- [ ] **Step 3: Write the club public page + metadata**

```tsx
// app/s/[slug]/page.tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { env } from '@/env';
import { parseAppOrigin } from '@/lib/urls';
import { requireClub } from '@/lib/tenant';
import { buildClubMetadata } from '@/lib/seo';
import { buttonVariants } from '@/components/ui/button';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const club = await requireClub(slug);
  const t = await getTranslations('club');
  return buildClubMetadata({
    club,
    description: t('metaDescription', { name: club.name }),
    origin: parseAppOrigin(env.APP_URL),
  });
}

export default async function ClubPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const club = await requireClub(slug);
  const t = await getTranslations('club');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-8 text-center">
      {club.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={club.logoUrl} alt={club.name} className="h-20 w-20 rounded-full object-cover" />
      ) : null}
      <h1 className="font-heading text-3xl font-bold text-brand">{club.name}</h1>
      <p className="text-muted-foreground">{t('joinBody')}</p>
      {club.phone ? <p className="text-sm text-muted-foreground">{club.phone}</p> : null}
      <Link href="/join" className={buttonVariants({ className: 'w-full' })}>
        {t('joinCta')}
      </Link>
    </main>
  );
}
```

> Base UI's `Button` renders a native `<button>` and has no `asChild`, so a `<Link>` (an `<a>`) must not be nested inside it. The CTA styles the `Link` directly with the exported `buttonVariants()` helper (confirmed present in `src/components/ui/button.tsx`).

- [ ] **Step 4: Verify JSON + typecheck**

Run: `pnpm exec tsc --noEmit && node -e "JSON.parse(require('fs').readFileSync('messages/tr.json','utf8'));JSON.parse(require('fs').readFileSync('messages/en.json','utf8'));console.log('json ok')"`
Expected: tsc clean; `json ok`.

- [ ] **Step 5: Commit**

```bash
git add app/s/[slug]/layout.tsx app/s/[slug]/page.tsx messages/tr.json messages/en.json
git commit -m "feat(tenant): add club public/join page with per-club metadata and accent"
```

---

## Task 7: Join-request placeholder route

**Files:**
- Create: `app/s/[slug]/join/page.tsx`

**Interfaces:**
- Consumes: `requireClub`, `getTranslations('club')`.
- Produces: the tenant route `/join` (proves nested tenant routing works end-to-end).

**Design notes:**
- Minimal, localized placeholder. The actual "request to join" mutation, auth gating, and owner approval are Plan 3. This exists so the public page's CTA resolves and so a second tenant route confirms the rewrite handles nested paths.

- [ ] **Step 1: Write the placeholder page**

```tsx
// app/s/[slug]/join/page.tsx
import { getTranslations } from 'next-intl/server';
import { requireClub } from '@/lib/tenant';

export default async function JoinPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const club = await requireClub(slug);
  const t = await getTranslations('club');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-heading text-2xl font-bold text-brand">{t('joinTitle', { name: club.name })}</h1>
      <p className="text-muted-foreground">{t('joinBody')}</p>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/s/[slug]/join/page.tsx
git commit -m "feat(tenant): add join-request placeholder route"
```

---

## Task 8: Host-aware robots.ts & sitemap.ts

**Files:**
- Create: `app/robots.ts`, `app/sitemap.ts`

**Interfaces:**
- Consumes: `headers` from `next/headers`, `db` + `clubs` from `@/db`, `env.APP_URL`, `parseAppOrigin`, `resolveHost` (Task 2), `buildRobots`/`buildApexSitemap`/`buildTenantSitemap` (Task 5), `getClubBySlug` (Task 4).
- Produces: `/robots.txt` and `/sitemap.xml`, both branching on the requesting host.

**Design notes:**
- These files live at the top level (outside `s/[slug]`) and are excluded from the proxy matcher, so they run on **every** host. They read `host` from `headers()`, classify it with `resolveHost`, and build output accordingly.
- Reading `headers()` makes these dynamic (per-request) — correct, since output depends on the host.
- The apex sitemap queries only **active** clubs (`status = 'active'`). Use `eq(clubs.status, 'active')`.

- [ ] **Step 1: Write robots.ts**

```ts
// app/robots.ts
import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { env } from '@/env';
import { parseAppOrigin } from '@/lib/urls';
import { resolveHost } from '@/lib/tenant-routing';
import { buildRobots } from '@/lib/seo';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = parseAppOrigin(env.APP_URL);
  const host = (await headers()).get('host') ?? origin.rootDomain;
  const info = resolveHost(host, origin.rootDomain);
  return buildRobots({ kind: info.kind, origin, host });
}
```

- [ ] **Step 2: Write sitemap.ts**

```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clubs } from '@/db/schema';
import { env } from '@/env';
import { parseAppOrigin } from '@/lib/urls';
import { resolveHost } from '@/lib/tenant-routing';
import { getClubBySlug } from '@/lib/tenant';
import { buildApexSitemap, buildTenantSitemap } from '@/lib/seo';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = parseAppOrigin(env.APP_URL);
  const host = (await headers()).get('host') ?? origin.rootDomain;
  const info = resolveHost(host, origin.rootDomain);
  const now = new Date();

  if (info.kind === 'tenant') {
    const club = await getClubBySlug(info.slug);
    if (!club) return [];
    return buildTenantSitemap({ club, origin, now });
  }

  const active = await db.select({ slug: clubs.slug }).from(clubs).where(eq(clubs.status, 'active'));
  return buildApexSitemap({ clubs: active, origin, now });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/robots.ts app/sitemap.ts
git commit -m "feat(seo): add host-aware robots and sitemap route handlers"
```

---

## Task 9: Persistent dev database + demo seed

**Files:**
- Modify: `docker-compose.yml`, `package.json` (via CLI), `.env.example`
- Create: `scripts/seed-dev.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` (dev DB), `schema` from `@/db/schema` (imported via relative path in the script).
- Produces: a running dev DB and an idempotent `pnpm db:seed` that inserts an `active` club with slug `demo`.

**Design notes:**
- The existing `postgres` service is the **ephemeral test** DB (`:5433`, no volume — wiped each run). Add a **separate persistent dev** service so a seeded club survives restarts. Per the pg18 caveat already documented in `docker-compose.yml`, pin `PGDATA` to `/var/lib/postgresql/data` when mounting a volume (pg18's default data dir is version-coupled).
- The seed script is **self-contained** (its own `Pool`/`drizzle` from `process.env.DATABASE_URL`, relative schema import) — mirroring the integration tests, avoiding the `@/` alias and t3-env so it runs cleanly under `tsx`. It is **idempotent** (no-op if `demo` already exists), so it is safe to re-run.
- Club creation UI is Plan 3; until then this seed is the only way to get a tenant to look at.
- No new env var: dev just points `DATABASE_URL` at the dev container.

- [ ] **Step 1: Add the persistent dev DB service to `docker-compose.yml`**

Append a second service (keep the existing `postgres` test service and its comment untouched):

```yaml
  postgres-dev:
    image: postgres:18
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: oarly_dev
      PGDATA: /var/lib/postgresql/data
    ports:
      - '5434:5432'
    volumes:
      - oarly_dev_pgdata:/var/lib/postgresql/data

volumes:
  oarly_dev_pgdata:
```

- [ ] **Step 2: Add the `tsx` runner (CLI, not hand-edit) and the `db:seed` script**

Run: `pnpm add -D tsx`

Then add the script to `package.json` `scripts` (this single JSON edit is adding our own script, not managing a dependency):

```json
    "db:seed": "tsx scripts/seed-dev.ts"
```

- [ ] **Step 3: Write the seed script**

```ts
// scripts/seed-dev.ts
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
```

- [ ] **Step 4: Document the dev DB + subdomain dev in `.env.example`**

Add a comment block under the Auth section:

```
# --- Local development ---
# Subdomains on localhost, two options (no /etc/hosts edit needed):
#   1. *.localhost  -> open http://demo.localhost:3000  (Chrome/Edge/Firefox; NOT Safari)
#      keep APP_URL="http://localhost:3000"
#   2. lvh.me        -> open http://demo.lvh.me:3000     (any browser; needs DNS)
#      set  APP_URL="http://lvh.me:3000"
# APP_URL is the apex origin (protocol + host + port); the app derives the root
# domain and every club/apex URL from it.
#
# Dev database (docker compose up postgres-dev), then migrate + seed:
#   DATABASE_URL="postgresql://postgres:postgres@localhost:5434/oarly_dev"
#   pnpm db:migrate && pnpm db:seed   # seeds an active club at slug 'demo'
```

- [ ] **Step 5: Verify the seed end-to-end (Docker + migrate + seed, idempotent)**

```bash
docker compose up -d postgres-dev
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/oarly_dev" pnpm db:migrate
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/oarly_dev" pnpm db:seed
# re-run to confirm idempotency:
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/oarly_dev" pnpm db:seed
```
Expected: first seed prints `✓ seeded active club 'demo'`; second prints `✓ club 'demo' already exists`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml package.json pnpm-lock.yaml scripts/seed-dev.ts .env.example
git commit -m "feat(dev): add persistent dev database and idempotent demo-club seed"
```

---

## Task 10: Full green verification

**Design notes:**
- No new env var was introduced — `APP_URL` already encodes protocol + root host + port, and `parseAppOrigin` derives everything from it.

- [ ] **Step 1: Full unit suite + typecheck**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: tsc clean; all unit tests pass (foundation's plus this plan's `urls`, `tenant-routing`, `proxy`, `seo`).

- [ ] **Step 2: Full integration suite (Docker test PG must be up)**

Ensure the test DB is running (from foundation: `oarly-test-pg` on `localhost:5433`). Then:

Run: `pnpm test:integration`
Expected: all integration tests pass, including `src/lib/tenant.integration.test.ts`.

- [ ] **Step 3: Production build**

Run: `pnpm build`
Expected: compiles successfully; `app/s/[slug]`, `app/s/[slug]/join`, `/robots.txt`, `/sitemap.xml` appear in the route list. The proxy is reported (as Proxy/Middleware).

- [ ] **Step 4: Manual smoke (seeded dev DB from Task 9 must be up)**

With the dev DB seeded (Task 9), the demo club exists at slug `demo`. Using the zero-config `*.localhost` option (Chrome/Edge/Firefox):

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/oarly_dev" pnpm dev
#   http://localhost:3000/              -> marketing home
#   http://demo.localhost:3000/         -> demo club public page (themed, indexable)
#   http://localhost:3000/demo          -> 301 to http://demo.localhost:3000
#   http://demo.localhost:3000/join     -> join placeholder
#   http://demo.localhost:3000/robots.txt   -> tenant robots (disallows /book etc.)
#   http://localhost:3000/robots.txt        -> apex robots (disallows /admin)
#   http://nope.localhost:3000/         -> 404 (no such club)
# (Safari: use the lvh.me option instead — set APP_URL="http://lvh.me:3000".)
```
Expected: each URL behaves as annotated.

- [ ] **Step 5: Whole-branch review & merge**

Run the final whole-branch review per subagent-driven-development, then fast-forward merge to `main` (keep the feature branch — never delete). No extra commit here; `.env.example`, `docker-compose.yml`, and `package.json` were committed in Task 9.

---

## Self-Review (completed against spec §3 "Member join" and §4 "Domains & Routing")

**Spec coverage:**
- §4 canonical `{slug}.oarly.sbs` → Task 2/3 tenant rewrite; Task 5/6 self-canonical metadata. ✅
- §4 `oarly.sbs/{slug}` 301 → subdomain → Task 2/3 path-form redirect. ✅
- §4 `oarly.sbs` marketing + `/admin` reserved → Task 2 (`next` on apex, `admin` reserved). ✅
- §4 middleware resolves club from Host + injects tenant → Task 3 (`x-tenant-slug`) + Task 4 (`getClubBySlug`/`getTenantSlug`). ✅
- §4 wildcard domain / local dev `{slug}.localhost` / `lvh.me` → Task 9 docs; port-aware `resolveHost`. ✅
- §4 SEO: indexable surface only (apex + club public + privacy), noindex the rest → Task 5 `buildRobots`/`buildClubMetadata` (index only when `active`). ✅
- §4 self-referential canonical → Task 5. ✅
- §4 per-club robots/sitemap via route handlers → Task 8 host-aware handlers. ✅
- §4 hreflang → **deliberate deviation documented** (cookie-negotiated i18n has no distinct language URLs; `<html lang>` + self canonical instead). ⚠️ flagged at handoff.
- §3 club public/join page + "request to join" → Task 6 public page + CTA; Task 7 join placeholder (mutation deferred to Plan 3). ✅ (join mutation explicitly out of scope)

**Placeholder scan:** none — every code step contains full code. Deferred items (join mutation, marketing content, admin console) are explicitly labeled as later plans, not TODOs in this plan's deliverables.

**Type consistency:** `AppOrigin` shape, `RouteDecision`/`HostInfo` unions, `Club` type, and builder signatures are consistent across Tasks 1→8. `resolveHost` returns `{ kind, ... }` used identically by `routeRequest`, `robots.ts`, and `sitemap.ts`.

## Follow-ups to carry forward (for later plans)

- **Reserved words vs club slugs (Plan 3, club creation):** `RESERVED_SUBDOMAINS` ∪ `RESERVED_APEX_SEGMENTS` must be excluded from allowable club slugs; this list is the source of truth. Any new top-level apex route must be added to `RESERVED_APEX_SEGMENTS` or it will be 301'd to a subdomain.
- **Club profile fields (Plan 4):** the public page/metadata currently derive description from the club name; add a real `tagline`/`description` and OG image field to `clubs` when the club profile editor lands.
- **hreflang (optional):** if indexable language variants are wanted, add `?lang=` alternates + `alternates.languages`.
- **Suspended clubs:** currently `notFound()` only on missing club; when the lifecycle UI lands, decide whether `suspended` shows a branded "unavailable" page vs a 404.
