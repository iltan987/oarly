# Rate Limiting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the rate limiter that already exists but has zero call sites, make its Upstash path atomic, and apply §17's thresholds at every abusable surface — server actions, the proxy, the Blob upload routes, and better-auth.

**Architecture:** Four layers over one primitive. `src/lib/rate-limit.ts` becomes an atomic fixed-window limiter on `@upstash/ratelimit` that **fails open**. `src/lib/rate-limit-guard.ts` is the thin adapter server actions call. `proxy.ts` consumes one general-baseline token per POST. `src/auth.ts` gets per-endpoint `customRules`, a shared `customStorage`, and a pair of hooks that give per-account failed-login limiting that better-auth's IP-keyed limiter cannot express.

**Task map:** Task 1 is the primitive. Task 2 is the adapter. Tasks 3–4 wire server actions and routes. Task 5 is the proxy baseline. Tasks 6–7 are better-auth. Task 8 is the local Upstash-compatible test rig plus the integration test that proves atomicity.

**Spec:** `docs/superpowers/specs/2026-08-07-oarly-rate-limiting-design.md`

**Tech Stack:** Next.js 16 App Router (React 19), better-auth 1.6.26, `@upstash/ratelimit` 2.0.8 + `@upstash/redis` 1.38.2, Drizzle + Postgres, Vitest, next-intl.

## Global Constraints

Every task's requirements implicitly include this section.

- **Pure-core + thin-adapter.** Core modules in `src/lib/` take `db: DB` first, are `clubId`-scoped on every write, return a discriminated union, and never call `revalidatePath`, `redirect`, or `headers`. **`src/lib/rate-limit.ts` and `src/lib/rate-limit-guard.ts` must stay in that mould: they never read `headers()`.** Only `src/lib/request-ip.ts` does, and that is its entire job.
- **Fail open, always.** Every call into the limiter is wrapped so that a Redis outage returns "allowed". A booking app that cannot book because a cache is down is worse than one that is briefly unlimited. Any test that asserts a closed failure is wrong.
- **Never hand-author or edit `src/components/ui/*`.** Those are shadcn CLI-managed.
- **`club.id` always comes from the guard**, never from client input.
- **Every new test threads an explicit frozen `now`** into any function that accepts one. Never let a test depend on the real clock.
- **Tests that touch module state must call `resetRateLimitState()` in `beforeEach`.** The limiter's buckets, memoized `Ratelimit` instances, and ephemeral caches are module-level singletons; without the reset, tests leak into each other and pass or fail by file order.
- **Integration tests** use `describe.skipIf(!process.env.<GATE>)` and never fail when the gate env var is absent.
- **i18n:** every new user-visible string gets a key in **both** `messages/en.json` and `messages/tr.json`. Key sets must stay identical.
- **Lint is zero-tolerance:** `pnpm lint` runs `eslint --max-warnings 0`. Import order is enforced by `simple-import-sort`.
- **Commits:** conventional-commit subjects. **Never add a `Co-Authored-By` or any AI-attribution trailer.**

**Command reference:**

```bash
pnpm lint                                    # eslint --max-warnings 0
pnpm exec tsc --noEmit                       # type check
pnpm test                                    # unit suite (integration auto-skips)
pnpm vitest run src/lib/rate-limit.test.ts   # one unit file
docker compose up -d                         # test PG :5433, dev PG :5434
docker compose --profile redis up -d         # + redis + srh on :8079 (Task 8 onward)
```

**i18n parity check** (no automated test — run it by hand):

```bash
node -e "
const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v?flat(v,p+k+'.'):[p+k]);
const en=flat(require('./messages/en.json')), tr=flat(require('./messages/tr.json'));
const miss=(a,b)=>a.filter(k=>!b.includes(k));
console.log('en keys',en.length,'tr keys',tr.length);
console.log('missing in tr:',miss(en,tr)); console.log('missing in en:',miss(tr,en));
"
```

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/lib/request-ip.ts` | The only place that resolves a client IP. Pure `parseClientIp` + a `headers()`-reading `getClientIp`. |
| `src/lib/request-ip.test.ts` | Unit tests for `parseClientIp`. |
| `src/lib/rate-limit-guard.ts` | `enforceRateLimit` (for server actions) and `enforceBaseline` (for the proxy). |
| `src/lib/rate-limit-guard.test.ts` | Unit tests for both, including the short-circuit contract. |
| `src/lib/auth-rate-limit.ts` | better-auth glue: `authRateLimitRules`, `authRateLimitStorage`, and the two sign-in hooks. |
| `src/lib/auth-rate-limit.test.ts` | Unit tests for the rule table and the hook predicates. |
| `src/lib/rate-limit.integration.test.ts` | Upstash path against srh: atomicity under concurrency, TTL, reset. |

**Modified**

| File | Change |
|---|---|
| `src/lib/rate-limit.ts` | Rewritten on `@upstash/ratelimit`; adds `resetAt`, `rateLimitReset`, `resetRateLimitState`; fails open. |
| `src/lib/rate-limit-config.ts` | Four new rules. |
| `src/lib/rate-limit.test.ts` | Rewritten for the new surface. |
| `app/s/[slug]/(member)/book/actions.ts` | `bookingPerAccount` + `bookingPerIp`. |
| `app/s/[slug]/(member)/bookings/actions.ts` | Same two rules, same buckets. |
| `app/request-club/actions.ts` | `clubRequestPerAccount`. |
| `app/request-club/request-club-form.tsx` | Renders a form-level error. |
| `app/s/[slug]/join/actions.ts` | `joinRequestPerAccount`. |
| `app/s/[slug]/join/page.tsx` | Renders `?error=rate_limited`. |
| `src/i18n/set-locale.ts` | `localePerIp` — the one server action with no guard at all. |
| `app/api/club-logo/upload/route.ts`, `.../save/route.ts` | `logoUploadPerAccount` → 429. |
| `proxy.ts` | `async`; consumes `apiBaselinePerIp` on POST. |
| `src/auth.ts` | `customRules`, `customStorage`, `hooks.before` / `hooks.after`. |
| `messages/en.json`, `messages/tr.json` | New error strings. |
| `docker-compose.yml` | `redis` + `serverless-redis-http` under a `redis` profile. |
| `.env.example` | How to point KV at srh locally. |

---

### Task 1: The limiter primitive

**Files:**
- Modify: `src/lib/rate-limit-config.ts`
- Modify: `src/lib/rate-limit.ts` (full rewrite)
- Test: `src/lib/rate-limit.test.ts` (full rewrite)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type RateResult = { success: boolean; remaining: number; resetAt: number };
  export async function rateLimit(key: string, rule: RateRule, now?: number): Promise<RateResult>;
  export async function rateLimitReset(key: string, rule: RateRule): Promise<void>;
  export function resetRateLimitState(): void;
  ```
  and four new `RATE_LIMITS` entries: `clubRequestPerAccount`, `joinRequestPerAccount`, `logoUploadPerAccount`, `localePerIp`.

- [ ] **Step 1: Add the four new rules**

Append inside the `RATE_LIMITS` object in `src/lib/rate-limit-config.ts`, keeping the existing eight untouched:

```ts
  // Not in §17 — added by the rate-limiting cycle for surfaces §17 did not enumerate.
  clubRequestPerAccount: { limit: 5, windowSec: 60 * 60 },
  joinRequestPerAccount: { limit: 20, windowSec: 60 * 60 },
  logoUploadPerAccount: { limit: 20, windowSec: 60 * 60 },
  localePerIp: { limit: 60, windowSec: 60 },
```

- [ ] **Step 2: Write the failing tests**

Replace the whole of `src/lib/rate-limit.test.ts` with:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { rateLimit, rateLimitReset, resetRateLimitState } from '@/lib/rate-limit';

const RULE = { limit: 3, windowSec: 60 };
const T0 = 1_000_000;

describe('rateLimit (in-memory fallback)', () => {
  beforeEach(() => { resetRateLimitState(); });

  it('allows up to the limit then rejects', async () => {
    expect((await rateLimit('k', RULE, T0)).success).toBe(true);
    expect((await rateLimit('k', RULE, T0)).success).toBe(true);
    expect((await rateLimit('k', RULE, T0)).success).toBe(true);
    expect((await rateLimit('k', RULE, T0)).success).toBe(false);
  });

  it('counts down `remaining` and reports 0 once exhausted', async () => {
    expect((await rateLimit('k', RULE, T0)).remaining).toBe(2);
    expect((await rateLimit('k', RULE, T0)).remaining).toBe(1);
    expect((await rateLimit('k', RULE, T0)).remaining).toBe(0);
    expect((await rateLimit('k', RULE, T0)).remaining).toBe(0);
  });

  it('reports resetAt as the end of the window that the first call opened', async () => {
    const first = await rateLimit('k', RULE, T0);
    expect(first.resetAt).toBe(T0 + 60_000);
    // A later call inside the same window keeps the original reset — a fixed window
    // does not slide, so a burst cannot push its own expiry outward.
    expect((await rateLimit('k', RULE, T0 + 30_000)).resetAt).toBe(T0 + 60_000);
  });

  it('opens a fresh window once the old one has elapsed', async () => {
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    expect((await rateLimit('k', RULE, T0)).success).toBe(false);
    const rolled = await rateLimit('k', RULE, T0 + 60_000);
    expect(rolled.success).toBe(true);
    expect(rolled.resetAt).toBe(T0 + 120_000);
  });

  it('keeps buckets separate per key', async () => {
    await rateLimit('a', RULE, T0);
    await rateLimit('a', RULE, T0);
    await rateLimit('a', RULE, T0);
    expect((await rateLimit('a', RULE, T0)).success).toBe(false);
    expect((await rateLimit('b', RULE, T0)).success).toBe(true);
  });

  it('rateLimitReset empties a bucket so the next call starts a new window', async () => {
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    expect((await rateLimit('k', RULE, T0)).success).toBe(false);
    await rateLimitReset('k', RULE);
    const after = await rateLimit('k', RULE, T0);
    expect(after.success).toBe(true);
    expect(after.remaining).toBe(2);
  });

  it('resetRateLimitState clears every bucket', async () => {
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    expect((await rateLimit('k', RULE, T0)).success).toBe(false);
    resetRateLimitState();
    expect((await rateLimit('k', RULE, T0)).success).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `pnpm vitest run src/lib/rate-limit.test.ts`
Expected: FAIL — `rateLimitReset` and `resetRateLimitState` are not exported, and `resetAt` is not on the result.

- [ ] **Step 4: Rewrite the limiter**

Replace the whole of `src/lib/rate-limit.ts`:

```ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env } from '@/env';
import type { RateRule } from '@/lib/rate-limit-config';

export type RateResult = {
  success: boolean;
  remaining: number;
  /** Millisecond epoch at which the current window expires. */
  resetAt: number;
};

/** Namespaces our keys inside a KV database that may be shared with other features. */
const PREFIX = 'oarly:rl';

// --- in-memory fixed-window fallback (dev, test, CI) ---
// Single-threaded JS makes check-and-increment atomic here for free.
const buckets = new Map<string, { count: number; resetAt: number }>();

function inMemory(key: string, rule: RateRule, now: number): RateResult {
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    const resetAt = now + rule.windowSec * 1000;
    buckets.set(key, { count: 1, resetAt });
    return { success: true, remaining: rule.limit - 1, resetAt };
  }
  if (bucket.count >= rule.limit) return { success: false, remaining: 0, resetAt: bucket.resetAt };
  bucket.count += 1;
  return { success: true, remaining: rule.limit - bucket.count, resetAt: bucket.resetAt };
}

// --- Upstash-backed limiter (production) ---
// `Ratelimit` is constructed per distinct rule and memoized at module scope, together
// with a per-rule ephemeral cache. Both must live outside any request handler: that is
// the only way Fluid Compute's instance reuse can reject an already-blocked identifier
// without paying a Redis round trip. Each rule gets its OWN cache Map so two rules that
// happen to share a key string cannot poison each other.
const limiters = new Map<string, Ratelimit>();
let redis: Redis | null = null;

function upstashConfigured(): boolean {
  return Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
}

function limiterFor(rule: RateRule): Ratelimit {
  const id = `${rule.limit}:${rule.windowSec}`;
  const cached = limiters.get(id);
  if (cached) return cached;
  redis ??= new Redis({ url: env.KV_REST_API_URL!, token: env.KV_REST_API_TOKEN! });
  const limiter = new Ratelimit({
    redis,
    // fixedWindow runs check-and-increment as one server-side Lua script. The previous
    // implementation did INCR then a separate EXPIRE, which let concurrent callers slip
    // through and could leave a key with no TTL at all.
    limiter: Ratelimit.fixedWindow(rule.limit, `${rule.windowSec} s`),
    prefix: PREFIX,
    ephemeralCache: new Map<string, number>(),
    analytics: false,
    // Upstash resolves `success: true` if the call exceeds this — fail-open by design.
    timeout: 1000,
  });
  limiters.set(id, limiter);
  return limiter;
}

/**
 * Consume one token for `key` under `rule`.
 *
 * FAILS OPEN. If the KV backend is unreachable or slow, the request is allowed. The
 * failure mode of failing closed is a hard 429 for the whole club at slot-open, which is
 * a worse outage than being briefly unlimited.
 */
export async function rateLimit(key: string, rule: RateRule, now = Date.now()): Promise<RateResult> {
  if (!upstashConfigured()) return inMemory(key, rule, now);
  try {
    const result = await limiterFor(rule).limit(key);
    return { success: result.success, remaining: result.remaining, resetAt: result.reset };
  } catch (error) {
    console.error('rateLimit: backend unavailable, allowing request', error);
    return { success: true, remaining: rule.limit, resetAt: now + rule.windowSec * 1000 };
  }
}

/** Empty `key`'s bucket. Used when a successful sign-in clears an account's failed-attempt count. */
export async function rateLimitReset(key: string, rule: RateRule): Promise<void> {
  if (!upstashConfigured()) {
    buckets.delete(key);
    return;
  }
  try {
    await limiterFor(rule).resetUsedTokens(key);
  } catch (error) {
    console.error('rateLimitReset: backend unavailable', error);
  }
}

/** Test-only. Clears every piece of module-level state this file keeps. */
export function resetRateLimitState(): void {
  buckets.clear();
  limiters.clear();
  redis = null;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm vitest run src/lib/rate-limit.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Prove the fail-open path**

Append to `src/lib/rate-limit.test.ts`:

```ts
describe('rateLimit (backend failure)', () => {
  beforeEach(() => { resetRateLimitState(); vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); resetRateLimitState(); });

  it('allows the request when the Upstash backend throws', async () => {
    vi.stubEnv('KV_REST_API_URL', 'http://127.0.0.1:1/');   // nothing listens on port 1
    vi.stubEnv('KV_REST_API_TOKEN', 'test-token');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await rateLimit('k', RULE, T0);

    expect(result.success).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});
```

Import `afterEach` and `vi` at the top of the file.

**If `vi.stubEnv` does not reach `@/env`** — `@t3-oss/env-nextjs` snapshots `process.env` at module load — then instead of stubbing, prove the same property directly: export nothing new, but assert that a thrown error inside `limiterFor(...).limit` yields `success: true` by spying on the module's `Ratelimit.prototype.limit`:

```ts
vi.spyOn(Ratelimit.prototype, 'limit').mockRejectedValue(new Error('kv down'));
```

Use whichever of the two actually exercises the `catch`. Verify by temporarily changing the `catch` to `return { success: false, ... }` and confirming the test then fails — **do this check, and say in the report which variant you used and that you confirmed it.**

- [ ] **Step 7: Full verification**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```
Expected: 0 lint problems, 0 type errors, whole suite green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/rate-limit.ts src/lib/rate-limit-config.ts src/lib/rate-limit.test.ts
git commit -m "feat(rate-limit): atomic fixed-window limiter with fail-open"
```

---

### Task 2: Client IP and the action adapter

**Files:**
- Create: `src/lib/request-ip.ts`, `src/lib/request-ip.test.ts`
- Create: `src/lib/rate-limit-guard.ts`, `src/lib/rate-limit-guard.test.ts`

**Interfaces:**
- Consumes: `rateLimit`, `resetRateLimitState`, `RATE_LIMITS`, `RateRule` from Task 1.
- Produces:
  ```ts
  // request-ip.ts
  export function parseClientIp(h: { xForwardedFor: string | null; xRealIp: string | null }): string;
  export async function getClientIp(): Promise<string>;

  // rate-limit-guard.ts
  export type RateCheck = { key: string; rule: RateRule };
  export type RateVerdict = { limited: false } | { limited: true; retryAfterSec: number };
  export async function enforceRateLimit(checks: RateCheck[], now?: number): Promise<RateVerdict>;
  ```
  `enforceBaseline` is added to the same file in Task 5 — do not write it here.

- [ ] **Step 1: Write the failing IP tests**

Create `src/lib/request-ip.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseClientIp } from '@/lib/request-ip';

describe('parseClientIp', () => {
  it('takes the leftmost entry of an x-forwarded-for chain', () => {
    expect(parseClientIp({ xForwardedFor: '203.0.113.7, 70.41.3.18, 150.172.238.178', xRealIp: null }))
      .toBe('203.0.113.7');
  });

  it('handles a single-entry x-forwarded-for', () => {
    expect(parseClientIp({ xForwardedFor: '203.0.113.7', xRealIp: null })).toBe('203.0.113.7');
  });

  it('trims surrounding whitespace', () => {
    expect(parseClientIp({ xForwardedFor: '  203.0.113.7 , 70.41.3.18', xRealIp: null })).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    expect(parseClientIp({ xForwardedFor: null, xRealIp: '198.51.100.4' })).toBe('198.51.100.4');
  });

  it('falls back to x-real-ip when x-forwarded-for is present but empty', () => {
    expect(parseClientIp({ xForwardedFor: '   ', xRealIp: '198.51.100.4' })).toBe('198.51.100.4');
  });

  it('returns "unknown" when neither header is present', () => {
    expect(parseClientIp({ xForwardedFor: null, xRealIp: null })).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/request-ip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/request-ip.ts`**

```ts
import { headers } from 'next/headers';

/**
 * TRUST ASSUMPTION — read before reusing this anywhere.
 *
 * `x-forwarded-for` is a client-supplied header unless something in front of the app
 * overwrites it. Vercel's edge does exactly that on every inbound request, which is what
 * makes the per-IP limits in `rate-limit-config.ts` meaningful. Run this app behind a
 * proxy that merely appends — or with no proxy at all — and every per-IP limit becomes
 * bypassable by rotating the header, at which point the limits have to move onto a
 * signed identity instead.
 *
 * Locally no proxy sets either header, so every request resolves to `'unknown'` and
 * shares one bucket. That is fine and deliberate: the per-IP limits sit well above the
 * per-account ones precisely so a shared bucket is not the binding constraint.
 */
export function parseClientIp(h: { xForwardedFor: string | null; xRealIp: string | null }): string {
  const forwarded = h.xForwardedFor?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  const real = h.xRealIp?.trim();
  if (real) return real;
  return 'unknown';
}

/** The current request's client IP, or `'unknown'`. Adapter-layer only — reads `headers()`. */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  return parseClientIp({ xForwardedFor: h.get('x-forwarded-for'), xRealIp: h.get('x-real-ip') });
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run src/lib/request-ip.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing guard tests**

Create `src/lib/rate-limit-guard.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { rateLimit, resetRateLimitState } from '@/lib/rate-limit';
import { enforceRateLimit } from '@/lib/rate-limit-guard';

const ACCOUNT = { limit: 2, windowSec: 60 };
const IP = { limit: 10, windowSec: 60 };
const T0 = 1_000_000;

describe('enforceRateLimit', () => {
  beforeEach(() => { resetRateLimitState(); });

  it('passes when every bucket has room', async () => {
    const verdict = await enforceRateLimit(
      [{ key: 'acct', rule: ACCOUNT }, { key: 'ip', rule: IP }],
      T0,
    );
    expect(verdict).toEqual({ limited: false });
  });

  it('reports the seconds until the exhausted window resets', async () => {
    await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0);
    await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0);
    const verdict = await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0 + 15_000);
    expect(verdict).toEqual({ limited: true, retryAfterSec: 45 });
  });

  it('never reports a retryAfterSec below 1', async () => {
    await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0);
    await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0);
    // 1ms before the window closes: ceil() of a sub-second remainder must not be 0,
    // because a `Retry-After: 0` invites an immediate retry that is still refused.
    const verdict = await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0 + 59_999);
    expect(verdict).toEqual({ limited: true, retryAfterSec: 1 });
  });

  it('does NOT consume from later buckets once an earlier one rejects', async () => {
    const checks = [{ key: 'acct', rule: ACCOUNT }, { key: 'shared-ip', rule: IP }];
    await enforceRateLimit(checks, T0);            // ip: 1 consumed
    await enforceRateLimit(checks, T0);            // ip: 2 consumed
    await enforceRateLimit(checks, T0);            // acct exhausted -> ip untouched
    await enforceRateLimit(checks, T0);            // acct exhausted -> ip untouched

    // If the short-circuit were missing, `shared-ip` would be at 4 rather than 2.
    // Probe it directly: 8 more tokens must remain in a limit of 10.
    for (let i = 0; i < 8; i += 1) {
      expect((await rateLimit('shared-ip', IP, T0)).success).toBe(true);
    }
    expect((await rateLimit('shared-ip', IP, T0)).success).toBe(false);
  });

  it('treats an empty check list as unlimited', async () => {
    expect(await enforceRateLimit([], T0)).toEqual({ limited: false });
  });
});
```

- [ ] **Step 6: Run and watch it fail**

Run: `pnpm vitest run src/lib/rate-limit-guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write `src/lib/rate-limit-guard.ts`**

```ts
import { rateLimit } from '@/lib/rate-limit';
import type { RateRule } from '@/lib/rate-limit-config';

export type RateCheck = { key: string; rule: RateRule };
export type RateVerdict = { limited: false } | { limited: true; retryAfterSec: number };

/**
 * Consume one token from each check in order, stopping at the first rejection.
 *
 * The short-circuit is the point, not an optimisation. Call sites pair a per-account
 * check with a per-IP one; a rowing club's members plausibly share a single gym or
 * office IP, so if a per-account bucket has already rejected, spending a token from the
 * shared per-IP bucket would let one abusive account degrade service for everyone behind
 * that NAT. Order the checks narrowest-first.
 */
export async function enforceRateLimit(checks: RateCheck[], now = Date.now()): Promise<RateVerdict> {
  for (const { key, rule } of checks) {
    const result = await rateLimit(key, rule, now);
    if (!result.success) {
      return { limited: true, retryAfterSec: Math.max(1, Math.ceil((result.resetAt - now) / 1000)) };
    }
  }
  return { limited: false };
}
```

- [ ] **Step 8: Run and watch it pass**

Run: `pnpm vitest run src/lib/rate-limit-guard.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Full verification and commit**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
git add src/lib/request-ip.ts src/lib/request-ip.test.ts src/lib/rate-limit-guard.ts src/lib/rate-limit-guard.test.ts
git commit -m "feat(rate-limit): client-IP resolution and the server-action guard"
```

---

### Task 3: Rate-limit the booking actions

**Files:**
- Modify: `app/s/[slug]/(member)/book/actions.ts`
- Modify: `app/s/[slug]/(member)/bookings/actions.ts`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `enforceRateLimit` (Task 2), `getClientIp` (Task 2), `RATE_LIMITS` (Task 1).
- Produces: the string `'rate_limited'` as a new member of both actions' `error` field. The UI already renders `t(\`errors.${state.error}\`)` and `t(\`cancelErrors.${state.error}\`)`, so no component changes are needed — only catalog keys.

**Key naming convention used from here on** (keep it exactly): `<family>:<dimension>:<value>`, e.g. `book:acct:<userId>`, `book:ip:<ip>`.

- [ ] **Step 1: Add the i18n keys**

In `messages/en.json`, add to the `book.errors` object **and** to the `book.cancelErrors` object:

```json
"rate_limited": "Too many requests. Please wait a moment and try again."
```

In `messages/tr.json`, add to the same two objects:

```json
"rate_limited": "Çok fazla istek. Lütfen biraz bekleyip tekrar deneyin."
```

- [ ] **Step 2: Add the check to `bookSeatAction`**

In `app/s/[slug]/(member)/book/actions.ts`, add the imports

```ts
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { enforceRateLimit } from '@/lib/rate-limit-guard';
import { getClientIp } from '@/lib/request-ip';
```

and insert immediately after the `requireMember` line, before the `safeParse`:

```ts
  // Narrowest bucket first: see enforceRateLimit's short-circuit contract.
  const ip = await getClientIp();
  const verdict = await enforceRateLimit([
    { key: `book:acct:${user.id}`, rule: RATE_LIMITS.bookingPerAccount },
    { key: `book:ip:${ip}`, rule: RATE_LIMITS.bookingPerIp },
  ]);
  if (verdict.limited) return { status: 'error', error: 'rate_limited' };
```

The check goes **after** the guard, not before: the key needs `user.id`, and an unauthenticated caller is redirected by `requireMember` before reaching any of this. The proxy baseline (Task 5) is what covers the pre-auth surface.

- [ ] **Step 3: Add the same check to `cancelBookingAction`**

In `app/s/[slug]/(member)/bookings/actions.ts`, same three imports, and insert after the `requireMemberView` line:

```ts
  // Deliberately the SAME bucket family as booking. §17 says "booking submit", but a
  // cancel/rebook loop is the same abuse surface — each cycle re-runs the seating
  // recompute and can fire a waitlist-promotion email — and separate buckets would hand
  // an attacker 20/min by alternating between the two actions.
  const ip = await getClientIp();
  const verdict = await enforceRateLimit([
    { key: `book:acct:${user.id}`, rule: RATE_LIMITS.bookingPerAccount },
    { key: `book:ip:${ip}`, rule: RATE_LIMITS.bookingPerIp },
  ]);
  if (verdict.limited) return { status: 'error', error: 'rate_limited' };
```

- [ ] **Step 4: Verify the i18n key sets still match**

Run the i18n parity snippet from the Command reference.
Expected: `missing in tr: []` and `missing in en: []`.

- [ ] **Step 5: Full verification**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add "app/s/[slug]/(member)/book/actions.ts" "app/s/[slug]/(member)/bookings/actions.ts" messages/en.json messages/tr.json
git commit -m "feat(rate-limit): bound booking and cancellation per account and per IP"
```

---

### Task 4: Rate-limit the remaining named surfaces

**Files:**
- Modify: `app/request-club/actions.ts`, `app/request-club/request-club-form.tsx`
- Modify: `app/s/[slug]/join/actions.ts`, `app/s/[slug]/join/page.tsx`
- Modify: `src/i18n/set-locale.ts`
- Modify: `app/api/club-logo/upload/route.ts`, `app/api/club-logo/save/route.ts`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `enforceRateLimit`, `getClientIp`, `RATE_LIMITS`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: `requestClubAction`**

`app/request-club/actions.ts` — add the imports (`RATE_LIMITS`, `enforceRateLimit`) and insert after `const t = await getTranslations('admin');`:

```ts
  const verdict = await enforceRateLimit([
    { key: `clubreq:acct:${owner.id}`, rule: RATE_LIMITS.clubRequestPerAccount },
  ]);
  if (verdict.limited) return { errors: { form: t('errorTooManyRequests') } };
```

`RequestClubState.errors` is a `Record<string, string>`, so `form` needs no type change.

Add to the **`admin`** namespace of both catalogs — that is where this form already reads its field errors from:

- `messages/en.json` → `"errorTooManyRequests": "Too many requests. Please try again later."`
- `messages/tr.json` → `"errorTooManyRequests": "Çok fazla istek. Lütfen daha sonra tekrar deneyin."`

- [ ] **Step 2: Render the form-level error**

In `app/request-club/request-club-form.tsx`, insert directly above the submit `<Button>`:

```tsx
        {e.form && <FieldError>{e.form}</FieldError>}
```

`FieldError` is already imported in that file.

- [ ] **Step 3: `joinAction`**

`app/s/[slug]/join/actions.ts` — add the imports and insert after the `requireClub` line:

```ts
  const verdict = await enforceRateLimit([
    { key: `join:acct:${session.user.id}`, rule: RATE_LIMITS.joinRequestPerAccount },
  ]);
  if (verdict.limited) redirect('/join?error=rate_limited');
```

The relative `/join` matches the existing `redirect('/join')` in this file: on a club subdomain the proxy rewrites `/join` to `/s/<slug>/join`.

- [ ] **Step 4: Show it on the join page**

`app/s/[slug]/join/page.tsx` — widen the props and render the notice. Change the signature to:

```tsx
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
```

and insert inside the final `<main>`, directly after the `<h1>`:

```tsx
      {error === 'rate_limited' && <p className="text-sm text-destructive">{tj('rateLimited')}</p>}
```

Add to the **`join`** namespace of both catalogs (that namespace uses flat camelCase keys):

- en: `"rateLimited": "Too many requests. Please try again later."`
- tr: `"rateLimited": "Çok fazla istek. Lütfen daha sonra tekrar deneyin."`

- [ ] **Step 5: `setLocale`**

`src/i18n/set-locale.ts` — this is the only server action in the codebase with no guard at all, so it is keyed by IP:

```ts
'use server';
import { cookies } from 'next/headers';

import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { enforceRateLimit } from '@/lib/rate-limit-guard';
import { getClientIp } from '@/lib/request-ip';

import { type Locale, LOCALE_COOKIE } from './config';

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale) {
  // No auth guard exists on this action — anyone can POST it. Silently doing nothing is
  // the right refusal: the caller is a language switcher with no error surface, and a
  // human cannot reach 60 switches a minute.
  const verdict = await enforceRateLimit([
    { key: `locale:ip:${await getClientIp()}`, rule: RATE_LIMITS.localePerIp },
  ]);
  if (verdict.limited) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { maxAge: ONE_YEAR, path: '/', sameSite: 'lax' });
}
```

- [ ] **Step 6: The Blob routes**

`app/api/club-logo/upload/route.ts` — the authorization check lives inside `onBeforeGenerateToken`, so the limit goes there too, immediately after the `if (!user) throw new Error('Not authorized');` line:

```ts
        const verdict = await enforceRateLimit([
          { key: `logo:acct:${user.id}`, rule: RATE_LIMITS.logoUploadPerAccount },
        ]);
        if (verdict.limited) throw new Error('Rate limited');
```

and extend the existing `catch` so the new sentinel maps to a 429 rather than the generic 400 — insert before the `'Not authorized'` branch:

```ts
    if ((error as Error).message === 'Rate limited') {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
```

`app/api/club-logo/save/route.ts` — insert directly after the `if (!user)` guard:

```ts
  const verdict = await enforceRateLimit([
    { key: `logo:acct:${user.id}`, rule: RATE_LIMITS.logoUploadPerAccount },
  ]);
  if (verdict.limited) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
```

Both routes share one bucket on purpose: an upload is always followed by a save, so a single `logoUploadPerAccount` budget of 20/hour covers ~10 complete logo changes an hour.

- [ ] **Step 7: Verify i18n parity**

Run the i18n parity snippet. Expected: both lists empty.

- [ ] **Step 8: Full verification**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```

- [ ] **Step 9: Commit**

```bash
git add app/request-club src/i18n/set-locale.ts "app/s/[slug]/join" app/api/club-logo messages/en.json messages/tr.json
git commit -m "feat(rate-limit): bound club requests, join requests, locale switching and logo uploads"
```

---

### Task 5: The general per-IP baseline in the proxy

**Files:**
- Modify: `src/lib/rate-limit-guard.ts` (add `enforceBaseline`)
- Modify: `src/lib/rate-limit-guard.test.ts` (add its tests)
- Modify: `proxy.ts`

**Interfaces:**
- Consumes: `enforceRateLimit`, `parseClientIp`, `RATE_LIMITS`.
- Produces:
  ```ts
  export async function enforceBaseline(
    req: { method: string; headers: Headers },
    now?: number,
  ): Promise<RateVerdict>;
  ```

**Why the logic lives in the guard, not in `proxy.ts`:** `proxy.ts` cannot be imported by Vitest without a Next request context, so anything asserted about it has to be reachable through a plain function. `enforceBaseline` takes a structurally-typed `{ method, headers }`, which a test satisfies with an object literal and a `new Headers()`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/rate-limit-guard.test.ts` (add `enforceBaseline` to the import from `@/lib/rate-limit-guard`):

```ts
describe('enforceBaseline', () => {
  beforeEach(() => { resetRateLimitState(); });

  const req = (method: string, ip?: string) => ({
    method,
    headers: new Headers(ip ? { 'x-forwarded-for': ip } : {}),
  });

  it('does not consume anything for a GET', async () => {
    for (let i = 0; i < 200; i += 1) {
      expect(await enforceBaseline(req('GET', '203.0.113.7'), T0)).toEqual({ limited: false });
    }
  });

  it('consumes on POST and rejects past the §17 baseline of 100/min', async () => {
    for (let i = 0; i < 100; i += 1) {
      expect(await enforceBaseline(req('POST', '203.0.113.7'), T0)).toEqual({ limited: false });
    }
    const verdict = await enforceBaseline(req('POST', '203.0.113.7'), T0);
    expect(verdict).toEqual({ limited: true, retryAfterSec: 60 });
  });

  it('buckets by IP, so one exhausted client does not block another', async () => {
    for (let i = 0; i < 100; i += 1) await enforceBaseline(req('POST', '203.0.113.7'), T0);
    expect(await enforceBaseline(req('POST', '203.0.113.7'), T0)).toMatchObject({ limited: true });
    expect(await enforceBaseline(req('POST', '198.51.100.4'), T0)).toEqual({ limited: false });
  });

  it('falls back to a single shared bucket when no IP header is present', async () => {
    for (let i = 0; i < 100; i += 1) await enforceBaseline(req('POST'), T0);
    expect(await enforceBaseline(req('POST'), T0)).toMatchObject({ limited: true });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/rate-limit-guard.test.ts`
Expected: FAIL — `enforceBaseline` is not exported.

- [ ] **Step 3: Add `enforceBaseline`**

Append to `src/lib/rate-limit-guard.ts` (and add `RATE_LIMITS` and `parseClientIp` to its imports):

```ts
/**
 * §17's "general API baseline: 100/min per IP", applied in `proxy.ts`.
 *
 * POST only. Every GET is a navigation, a prefetch, or an RSC fetch, and charging those
 * would both break normal browsing and put a Redis round trip on every page view. A POST
 * to a non-`/api` path is always a server action, so this is the one hook that reaches
 * every action — including `setLocale`, which has no auth guard to hang a check on.
 */
export async function enforceBaseline(
  req: { method: string; headers: Headers },
  now = Date.now(),
): Promise<RateVerdict> {
  if (req.method !== 'POST') return { limited: false };
  const ip = parseClientIp({
    xForwardedFor: req.headers.get('x-forwarded-for'),
    xRealIp: req.headers.get('x-real-ip'),
  });
  return enforceRateLimit([{ key: `base:ip:${ip}`, rule: RATE_LIMITS.apiBaselinePerIp }], now);
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run src/lib/rate-limit-guard.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Wire it into `proxy.ts`**

Make `proxy` async and add the baseline before any routing work. The existing body is unchanged below the new block; keep the `x-tenant-slug` stripping exactly where it is.

```ts
import type { NextRequest, ProxyConfig } from 'next/server';
import { NextResponse } from 'next/server';

import { env } from '@/env';
import { enforceBaseline } from '@/lib/rate-limit-guard';
import { routeRequest } from '@/lib/tenant-routing';
import { parseAppOrigin } from '@/lib/urls';

const origin = parseAppOrigin(env.APP_URL);

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // §17's general baseline. POST-only, so browsing costs nothing; see enforceBaseline.
  // A raw 429 is not an RSC payload, so React surfaces it as a generic failure rather
  // than a toast — accepted, because at 100/min this only trips for scripted abuse and
  // every named action carries a much tighter limit that DOES produce a toast.
  const baseline = await enforceBaseline(request);
  if (baseline.limited) {
    return new NextResponse(null, {
      status: 429,
      headers: { 'Retry-After': String(baseline.retryAfterSec) },
    });
  }

  const host = request.headers.get('host') ?? origin.rootDomain;
  // ...rest of the existing body, unchanged...
}
```

Next 16's proxy runs on the Node.js runtime by default and may be `async` — see
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:223`
and its "This function can be marked `async`" note. Do **not** add a `runtime` export;
that file's docs say setting it throws.

- [ ] **Step 6: Confirm the app still boots and routes**

```bash
pnpm exec tsc --noEmit
pnpm build
```
Expected: type check clean, build succeeds. (`pnpm build` runs `scripts/deploy-migrate.mjs` first, which no-ops outside a Vercel production build.)

- [ ] **Step 7: Full verification and commit**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
git add src/lib/rate-limit-guard.ts src/lib/rate-limit-guard.test.ts proxy.ts
git commit -m "feat(rate-limit): general per-IP baseline on server-action POSTs"
```

---

### Task 6: better-auth per-endpoint rules and shared storage

**Files:**
- Create: `src/lib/auth-rate-limit.ts`, `src/lib/auth-rate-limit.test.ts`
- Modify: `src/auth.ts`

**Interfaces:**
- Consumes: `rateLimit` (Task 1), `RATE_LIMITS` (Task 1).
- Produces:
  ```ts
  export const authRateLimitRules: Record<string, { window: number; max: number }>;
  export const authRateLimitStorage: {
    get(key: string): Promise<{ key: string; count: number; lastRequest: number } | null>;
    set(key: string, value: { key: string; count: number; lastRequest: number }): Promise<void>;
    consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }>;
  } | undefined;
  ```
  `authRateLimitStorage` is `undefined` when KV is not configured — Task 7 adds the hooks to the same file.

**Verified facts about the installed `better-auth@1.6.26` — do not re-derive, and do not "fix" code that relies on them:**

- The endpoints this app actually calls are `/sign-in/email`, `/sign-up/email`, `/request-password-reset`, `/reset-password`, and `/send-verification-email`. There is no `/forget-password` route in this version (only a legacy path *matcher*).
- `customRules` **replace** the matched default rule rather than stacking with it — `dist/api/rate-limiter/index.mjs:301-318` overwrites `currentWindow`/`currentMax`. The defaults being replaced are `/sign-in*` and `/sign-up*` at 3 per 10 s, and `/request-password-reset` + `/send-verification-email` at 3 per 60 s (`getDefaultSpecialRules`, same file). Losing those burst rules is intended: §17's windows are hours, and over any window of a minute or more the new rules are at least as tight.
- The storage contract is `BetterAuthRateLimitStorage` in `@better-auth/core@1.6.26`, `dist/types/init-options.d.mts:73-104`: `get`, `set`, and an optional `consume(key, { window, max }) => { allowed, retryAfter }`. When `consume` is present better-auth uses it and never touches `get`/`set` (`onRequestRateLimit`, `dist/api/rate-limiter/index.mjs:342-347`); when it is absent it logs a warning that limiting is best-effort. `get`/`set` are still required members of the interface, so implement them.
- The stored record is `{ key: string; count: number; lastRequest: number }` (`@better-auth/core/dist/db/schema/rate-limit.d.mts`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/auth-rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { authRateLimitRules } from '@/lib/auth-rate-limit';
import { RATE_LIMITS } from '@/lib/rate-limit-config';

describe('authRateLimitRules', () => {
  it('covers exactly the auth endpoints this app calls', () => {
    expect(Object.keys(authRateLimitRules).sort()).toEqual([
      '/request-password-reset',
      '/reset-password',
      '/send-verification-email',
      '/sign-in/email',
      '/sign-up/email',
    ]);
  });

  it('derives every threshold from RATE_LIMITS rather than hardcoding it', () => {
    expect(authRateLimitRules['/sign-in/email']).toEqual({
      window: RATE_LIMITS.loginPerIp.windowSec,
      max: RATE_LIMITS.loginPerIp.limit,
    });
    expect(authRateLimitRules['/sign-up/email']).toEqual({
      window: RATE_LIMITS.signupPerIp.windowSec,
      max: RATE_LIMITS.signupPerIp.limit,
    });
    expect(authRateLimitRules['/request-password-reset']).toEqual({
      window: RATE_LIMITS.passwordResetPerIp.windowSec,
      max: RATE_LIMITS.passwordResetPerIp.limit,
    });
  });

  it('uses the §17 values', () => {
    expect(authRateLimitRules['/sign-up/email']).toEqual({ window: 3600, max: 5 });
    expect(authRateLimitRules['/sign-in/email']).toEqual({ window: 60, max: 20 });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/auth-rate-limit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/auth-rate-limit.ts`**

```ts
import { Redis } from '@upstash/redis';

import { env } from '@/env';
import { rateLimit } from '@/lib/rate-limit';
import { RATE_LIMITS } from '@/lib/rate-limit-config';

type StoredRateLimit = { key: string; count: number; lastRequest: number };

const rule = (r: { limit: number; windowSec: number }) => ({ window: r.windowSec, max: r.limit });

/**
 * §17's per-endpoint, per-IP auth thresholds.
 *
 * These REPLACE better-auth's built-in special rules for the same paths rather than
 * stacking with them (dist/api/rate-limiter/index.mjs:301-318). The defaults given up
 * are 3/10s on sign-in and sign-up and 3/60s on the mail-sending endpoints; over any
 * window of a minute or more these are at least as tight, and §17's real protection for
 * sign-in is the per-ACCOUNT rule, which better-auth's IP-keyed limiter cannot express
 * and which lives in the hooks below.
 */
export const authRateLimitRules = {
  '/sign-in/email': rule(RATE_LIMITS.loginPerIp),
  '/sign-up/email': rule(RATE_LIMITS.signupPerIp),
  '/request-password-reset': rule(RATE_LIMITS.passwordResetPerIp),
  '/reset-password': rule(RATE_LIMITS.passwordResetPerIp),
  '/send-verification-email': rule(RATE_LIMITS.passwordResetPerIp),
} satisfies Record<string, { window: number; max: number }>;

const AUTH_PREFIX = 'oarly:auth-rl';

function kvRedis(): Redis | null {
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) return null;
  return new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN });
}

/**
 * Shared storage for better-auth's own limiter.
 *
 * Without this, better-auth stores counters in per-process memory, so on Vercel the
 * effective limit is (configured limit x number of warm instances) — which is to say,
 * no limit at all. `consume` is the atomic path better-auth prefers; `get`/`set` are
 * required by the interface but never reached while `consume` exists.
 *
 * `undefined` when KV is not configured, so dev and test keep better-auth's in-memory
 * storage instead of failing to construct a client.
 */
export const authRateLimitStorage = (() => {
  const redis = kvRedis();
  if (!redis) return undefined;
  return {
    async get(key: string): Promise<StoredRateLimit | null> {
      return (await redis.get<StoredRateLimit>(`${AUTH_PREFIX}:${key}`)) ?? null;
    },
    async set(key: string, value: StoredRateLimit): Promise<void> {
      await redis.set(`${AUTH_PREFIX}:${key}`, value, { ex: 60 * 60 });
    },
    async consume(
      key: string,
      r: { window: number; max: number },
    ): Promise<{ allowed: boolean; retryAfter: number | null }> {
      const now = Date.now();
      const result = await rateLimit(`auth:${key}`, { limit: r.max, windowSec: r.window }, now);
      return {
        allowed: result.success,
        retryAfter: result.success ? null : Math.max(1, Math.ceil((result.resetAt - now) / 1000)),
      };
    },
  };
})();
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run src/lib/auth-rate-limit.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire it into `src/auth.ts`**

Replace the single-line `rateLimit` option:

```ts
  // Built-in per-endpoint limiter (our own limiter — Task 15 — covers app routes).
  rateLimit: { enabled: true, window: 60, max: 100 },
```

with:

```ts
  rateLimit: {
    enabled: true,
    // Fallback for every auth endpoint not named in authRateLimitRules.
    window: 60,
    max: 100,
    customRules: authRateLimitRules,
    // Shared across lambda instances when KV is configured; better-auth's own in-memory
    // storage otherwise, which is correct for dev and test.
    ...(authRateLimitStorage ? { customStorage: authRateLimitStorage } : {}),
  },
```

and add `import { authRateLimitRules, authRateLimitStorage } from '@/lib/auth-rate-limit';` to the imports.

- [ ] **Step 6: Full verification**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```
Expected: all green. If `customStorage`'s inferred type does not satisfy `BetterAuthRateLimitStorage`, read the interface at `node_modules/.pnpm/@better-auth+core@1.6.26*/node_modules/@better-auth/core/dist/types/init-options.d.mts:73` and match it exactly — **do not** cast with `as any` or `as unknown as`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth-rate-limit.ts src/lib/auth-rate-limit.test.ts src/auth.ts
git commit -m "feat(rate-limit): per-endpoint auth rules on storage shared across instances"
```

---

### Task 7: Per-account failed-login and per-email reset limiting

**Files:**
- Modify: `src/lib/auth-rate-limit.ts`
- Modify: `src/lib/auth-rate-limit.test.ts`
- Modify: `src/auth.ts`

**Interfaces:**
- Consumes: `rateLimit`, `rateLimitReset` (Task 1); the file created in Task 6.
- Produces:
  ```ts
  export function accountKeyFor(path: string, body: unknown):
    | { key: string; rule: RateRule; clearOnSuccess: boolean }
    | null;
  export const authRateLimitBefore: AuthMiddleware;
  export const authRateLimitAfter: AuthMiddleware;
  ```

**Why this exists:** better-auth keys its own limits by IP. §17's "5 failed attempts / 15 min **per account**" and "3 / hour **per email**" for password resets are identity-keyed and cannot be expressed as `customRules`.

**Verified facts about the installed `better-auth@1.6.26`:**

- `createAuthMiddleware`, `APIError`, and `isAPIError` are all exported from `better-auth/api` (`dist/api/index.d.mts:3962`).
- **`after` hooks run even when the endpoint threw.** `dispatchAuthEndpoint` catches an `APIError`, assigns it to `internalContext.context.returned`, and only then calls `runAfterHooks` (`dist/api/dispatch.mjs:229-242`). So a hook distinguishes success from failure by testing `isAPIError(ctx.context.returned)`.

**The chosen shape — consume in `before`, clear on success in `after` — and why not the obvious alternative:** peeking in `before` and consuming on failure in `after` would express "failed attempts" more literally, but a peek is a read: N parallel attempts would all see an unexhausted bucket and all proceed, which is exactly the shape of a credential-stuffing run. Consuming up front is atomic. Clearing on success is what keeps a member who legitimately signs in on six devices in fifteen minutes from locking themselves out.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/auth-rate-limit.test.ts` (extend the import to include `accountKeyFor`, and import `RATE_LIMITS`):

```ts
describe('accountKeyFor', () => {
  it('keys a sign-in by lowercased email and clears on success', () => {
    expect(accountKeyFor('/sign-in/email', { email: 'Ali@Example.COM', password: 'x' })).toEqual({
      key: 'login:acct:ali@example.com',
      rule: RATE_LIMITS.loginPerAccount,
      clearOnSuccess: true,
    });
  });

  it('keys a password-reset request by email and does NOT clear on success', () => {
    // Succeeding at "please email me a reset link" repeatedly IS the abuse, so a
    // successful request must still count against the mailbox's budget.
    expect(accountKeyFor('/request-password-reset', { email: 'bob@example.com' })).toEqual({
      key: 'pwreset:email:bob@example.com',
      rule: RATE_LIMITS.passwordResetPerEmail,
      clearOnSuccess: false,
    });
  });

  it('returns null for paths it does not govern', () => {
    expect(accountKeyFor('/sign-up/email', { email: 'a@b.com' })).toBeNull();
    expect(accountKeyFor('/get-session', {})).toBeNull();
  });

  it('returns null when the body carries no usable email', () => {
    expect(accountKeyFor('/sign-in/email', {})).toBeNull();
    expect(accountKeyFor('/sign-in/email', { email: '' })).toBeNull();
    expect(accountKeyFor('/sign-in/email', { email: 42 })).toBeNull();
    expect(accountKeyFor('/sign-in/email', null)).toBeNull();
    expect(accountKeyFor('/sign-in/email', undefined)).toBeNull();
  });

  it('trims surrounding whitespace before keying', () => {
    expect(accountKeyFor('/sign-in/email', { email: '  ali@example.com  ' })?.key)
      .toBe('login:acct:ali@example.com');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/auth-rate-limit.test.ts`
Expected: FAIL — `accountKeyFor` is not exported.

- [ ] **Step 3: Add the key resolver and the hooks**

Append to `src/lib/auth-rate-limit.ts`, and extend its imports with
`import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';`,
`import { rateLimit, rateLimitReset } from '@/lib/rate-limit';`, and
`import { RATE_LIMITS, type RateRule } from '@/lib/rate-limit-config';`:

```ts
type AccountRule = { key: string; rule: RateRule; clearOnSuccess: boolean };

/** The email in an auth request body, normalized, or null if there isn't a usable one. */
function emailOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { email?: unknown }).email;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  return normalized || null;
}

/**
 * The identity-keyed rule governing `path`, or null.
 *
 * Pure and exported so the routing decision is testable without a request: the hooks
 * below are thin wrappers whose only job is to call this and act on the answer.
 */
export function accountKeyFor(path: string, body: unknown): AccountRule | null {
  const email = emailOf(body);
  if (!email) return null;
  if (path === '/sign-in/email') {
    return { key: `login:acct:${email}`, rule: RATE_LIMITS.loginPerAccount, clearOnSuccess: true };
  }
  if (path === '/request-password-reset') {
    return { key: `pwreset:email:${email}`, rule: RATE_LIMITS.passwordResetPerEmail, clearOnSuccess: false };
  }
  return null;
}

/**
 * Consume one token BEFORE the endpoint runs.
 *
 * Consuming up front rather than peeking is what makes this atomic: a peek is a read, so
 * a burst of parallel sign-in attempts would all observe an unexhausted bucket and all
 * proceed — the exact shape of credential stuffing.
 */
export const authRateLimitBefore = createAuthMiddleware(async (ctx) => {
  const match = accountKeyFor(ctx.path, ctx.body);
  if (!match) return;
  const result = await rateLimit(match.key, match.rule);
  if (!result.success) {
    throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many attempts. Please try again later.' });
  }
});

/**
 * Clear the bucket when the attempt SUCCEEDED, so honest sign-ins never accumulate.
 *
 * `after` hooks run even for a failed endpoint: dispatchAuthEndpoint catches the APIError
 * and puts it on `ctx.context.returned` before running them
 * (better-auth@1.6.26 dist/api/dispatch.mjs:229-242). Hence the isAPIError test.
 */
export const authRateLimitAfter = createAuthMiddleware(async (ctx) => {
  const match = accountKeyFor(ctx.path, ctx.body);
  if (!match?.clearOnSuccess) return;
  if (isAPIError(ctx.context.returned)) return;
  await rateLimitReset(match.key, match.rule);
});
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run src/lib/auth-rate-limit.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Register the hooks**

In `src/auth.ts`, add `authRateLimitAfter, authRateLimitBefore` to the existing import from `@/lib/auth-rate-limit`, and add a top-level option next to `rateLimit`:

```ts
  hooks: {
    before: authRateLimitBefore,
    after: authRateLimitAfter,
  },
```

If an option named `hooks` already exists in this file, merge into it rather than adding a second key.

- [ ] **Step 6: Prove the hooks are actually reachable**

Add one test that drives the exported middlewares directly with a hand-built context — this is the only assertion that the wiring, not just the resolver, works:

```ts
describe('authRateLimitBefore / authRateLimitAfter', () => {
  beforeEach(() => { resetRateLimitState(); });

  const ctxFor = (path: string, body: unknown, returned?: unknown) =>
    ({ path, body, context: { returned } }) as never;

  it('rejects the sixth sign-in attempt for one account', async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }))).resolves.toBeUndefined();
    }
    await expect(authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }))).rejects.toThrow();
  });

  it('a successful attempt clears the count', async () => {
    for (let i = 0; i < 5; i += 1) {
      await authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }));
    }
    await authRateLimitAfter(ctxFor('/sign-in/email', { email: 'a@b.com' }, { user: { id: 'u1' } }));
    await expect(authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }))).resolves.toBeUndefined();
  });

  it('a failed attempt does not clear the count', async () => {
    const failure = new APIError('UNAUTHORIZED', { message: 'bad password' });
    for (let i = 0; i < 5; i += 1) {
      await authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }));
      await authRateLimitAfter(ctxFor('/sign-in/email', { email: 'a@b.com' }, failure));
    }
    await expect(authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }))).rejects.toThrow();
  });
});
```

Import `APIError` from `better-auth/api` and `resetRateLimitState` from `@/lib/rate-limit` in the test file.

If `createAuthMiddleware`'s returned value cannot be invoked with a plain object in this
version, do not force it: replace these three tests with equivalents that call
`accountKeyFor` + `rateLimit` + `rateLimitReset` in the same sequence the hooks do, and
**say so explicitly in the report**, naming what blocked the direct call.

- [ ] **Step 7: Full verification**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth-rate-limit.ts src/lib/auth-rate-limit.test.ts src/auth.ts
git commit -m "feat(rate-limit): per-account failed-login and per-email reset limits"
```

---

### Task 8: A local Upstash-compatible Redis, and the atomicity proof

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Create: `src/lib/rate-limit.integration.test.ts`

**Interfaces:**
- Consumes: `rateLimit`, `rateLimitReset`, `resetRateLimitState` (Task 1).
- Produces: nothing other tasks depend on.

**Why srh:** `@upstash/redis` speaks the Upstash **REST** protocol, not RESP, so a plain
`redis` container cannot serve it. `hiett/serverless-redis-http` is the standard REST
shim in front of a real Redis. The existing header comment in `docker-compose.yml` says
exactly this and defers it to "Plan 6" — this task is that plan; **delete that sentence
from the comment when adding the services**, so the file does not keep promising work
that has landed.

- [ ] **Step 1: Add the services**

In `docker-compose.yml`, add under `services:` (keeping both Postgres services as they are):

```yaml
  # Rate-limiter development/testing only, hence the profile: `docker compose up -d`
  # still starts just Postgres. @upstash/redis speaks Upstash's REST protocol, so a
  # vanilla redis container is not enough — srh is the REST shim in front of it.
  #   docker compose --profile redis up -d
  redis:
    image: redis:8-alpine
    profiles: [redis]

  redis-http:
    image: hiett/serverless-redis-http:latest
    profiles: [redis]
    environment:
      SRH_MODE: env
      SRH_TOKEN: local-dev-token
      SRH_CONNECTION_STRING: redis://redis:6379
    ports:
      - '8079:80'
    depends_on:
      - redis
```

- [ ] **Step 2: Document it**

In `.env.example`, replace the `# Rate limiting (...)` comment block's first line with an
expanded version that keeps the existing production note and adds the local one:

```
# Rate limiting (optional locally — in-memory when unset).
# In prod these are provisioned automatically by the Vercel Upstash/KV integration
# (use the write token KV_REST_API_TOKEN, not KV_REST_API_READ_ONLY_TOKEN; the
# rediss:// KV_URL/REDIS_URL are for the TCP client and are unused here).
#
# To exercise the real Upstash code path locally, start the REST shim and point at it:
#   docker compose --profile redis up -d
#   KV_REST_API_URL="http://localhost:8079"
#   KV_REST_API_TOKEN="local-dev-token"
# The Upstash-path integration test reads TEST_KV_REST_API_URL/TEST_KV_REST_API_TOKEN
# instead, so it never collides with your app config:
#   TEST_KV_REST_API_URL=http://localhost:8079 TEST_KV_REST_API_TOKEN=local-dev-token \
#     pnpm vitest run src/lib/rate-limit.integration.test.ts
```

- [ ] **Step 3: Write the integration test**

Create `src/lib/rate-limit.integration.test.ts`. It talks to srh through `@upstash/ratelimit`
directly rather than through `rateLimit()`, because `rateLimit()` reads `env.KV_REST_API_*`
at call time and the app's own env must not be hijacked by a test:

```ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { beforeEach, describe, expect, it } from 'vitest';

const url = process.env.TEST_KV_REST_API_URL;
const token = process.env.TEST_KV_REST_API_TOKEN;

// Mirrors limiterFor() in rate-limit.ts. If that construction changes, change it here
// too — this file is the only place the Upstash path is exercised end to end.
function limiterFor(limit: number, windowSec: number): Ratelimit {
  return new Ratelimit({
    redis: new Redis({ url: url!, token: token! }),
    limiter: Ratelimit.fixedWindow(limit, `${windowSec} s`),
    prefix: 'oarly:rl:test',
    ephemeralCache: new Map<string, number>(),
    analytics: false,
    timeout: 1000,
  });
}

describe.skipIf(!url || !token)('rate limiter — Upstash path', () => {
  let key: string;

  beforeEach(() => {
    // Unique per test so a rerun never inherits a previous run's window.
    key = `k-${process.pid}-${performance.now()}`;
  });

  it('admits exactly `limit` of N concurrent callers', async () => {
    const limiter = limiterFor(4, 60);
    const results = await Promise.all(Array.from({ length: 15 }, () => limiter.limit(key)));
    // The assertion the old INCR-then-EXPIRE implementation could not make: a burst of
    // 15 simultaneous callers must yield exactly 4 successes, not "about 4".
    expect(results.filter((r) => r.success)).toHaveLength(4);
    expect(results.filter((r) => !r.success)).toHaveLength(11);
  });

  it('sets a TTL on the window key so an abandoned bucket cannot block forever', async () => {
    const limiter = limiterFor(2, 60);
    const first = await limiter.limit(key);
    expect(first.success).toBe(true);
    expect(first.reset).toBeGreaterThan(Date.now());
    expect(first.reset).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('resetUsedTokens empties the bucket', async () => {
    const limiter = limiterFor(1, 60);
    expect((await limiter.limit(key)).success).toBe(true);
    expect((await limiter.limit(key)).success).toBe(false);
    await limiter.resetUsedTokens(key);
    expect((await limiter.limit(key)).success).toBe(true);
  });
});
```

- [ ] **Step 4: Confirm it skips cleanly without the gate**

Run: `pnpm test`
Expected: whole suite green; the three tests above report as skipped, not failed.

- [ ] **Step 5: Run it for real**

```bash
docker compose --profile redis up -d
TEST_KV_REST_API_URL=http://localhost:8079 TEST_KV_REST_API_TOKEN=local-dev-token \
  pnpm vitest run src/lib/rate-limit.integration.test.ts
```
Expected: 3 passed.

If srh cannot be reached, report BLOCKED with the container logs rather than deleting or
weakening the test — the atomicity assertion is the whole point of the task.

- [ ] **Step 6: Full verification and commit**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
git add docker-compose.yml .env.example src/lib/rate-limit.integration.test.ts
git commit -m "test(rate-limit): local Upstash REST shim and the atomicity proof"
```

---

## Self-Review Notes

**Spec coverage.** §4.1 → Task 1. §4.2 → Task 2. §4.3 → Task 2. §4.4's table → Tasks 3, 4, 5, 6, 7. §4.5 → Task 5. §4.6 → Tasks 6 and 7. §4.7 → Task 8. §5's test table is distributed across the tasks that own each row.

**Known cross-task hazards for the final review.**

1. `enforceRateLimit` is added in Task 2 and *extended* in Task 5. A reviewer seeing Task 2 in isolation will note `enforceBaseline` is missing — that is intended, not an omission.
2. Tasks 3 and 4 both edit `messages/*.json`. The i18n parity check must be re-run after Task 4, not only after Task 3.
3. `proxy.ts` becoming async (Task 5) changes the module's exported signature. Nothing imports `proxy` directly, but `pnpm build` is the gate that catches it if something does.
4. The limiter's module-level state (`buckets`, `limiters`, `redis`) is shared by every test file in the run. Any test that consumes tokens must reset in `beforeEach`; a file that forgets will fail only when the suite order changes.
5. Tasks 6 and 7 both edit `src/auth.ts` and `src/lib/auth-rate-limit.ts`. Task 7 must merge into Task 6's `rateLimit` block and imports rather than replacing them.
