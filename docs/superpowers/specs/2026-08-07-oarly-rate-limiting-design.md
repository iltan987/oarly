# Rate Limiting — Design

**Date:** 2026-08-07
**Status:** approved
**Supersedes:** nothing. Implements §17 "Rate-limiting" of `2026-07-15-oarly-design.md`.

---

## 1. Problem

`src/lib/rate-limit.ts` and `src/lib/rate-limit-config.ts` were written during the
foundation cycle and **have never been called**. `@upstash/ratelimit` and `@upstash/redis`
are installed dependencies with zero imports. The only limiting in production today is
better-auth's built-in flat `100 requests / 60 s`, and that runs against **in-memory
storage**, which on Vercel means *per lambda instance* — a fleet of warm instances
multiplies the effective limit by the fleet size.

So today:

- Every server action (book a seat, cancel, request a club, join a club, change locale)
  is unlimited.
- `/api/club-logo/upload` mints a Vercel Blob write token and is unlimited.
- Credential stuffing against `/api/auth/sign-in/email` is bounded only by a shared
  100/min bucket that resets whenever the platform scales.

The existing limiter also has a correctness bug: its Upstash path does `INCR` then a
separate `EXPIRE`, which is not atomic. N concurrent requests can all observe `count === 1`
paths and the key can be left without a TTL if the process dies between the two calls.

## 2. Goal

Implement §17's thresholds for real, on shared storage, at every surface that can be
abused — without making a Redis outage able to take booking down.

**Non-goals.** No CAPTCHA. No IP deny-lists or bot detection (Vercel BotID is a separate
decision). No per-club or per-plan quota tiers. No admin UI for tuning limits — the config
module stays the single tuning point.

## 3. Threat model

| Surface | Attack | Cost to us today |
|---|---|---|
| `/api/auth/sign-in/email` | credential stuffing against a leaked password list | account takeover |
| `/api/auth/sign-up/email` | signup flood | junk users, Resend quota burn |
| `/api/auth/forget-password` | mail-bomb a known member | Resend quota, member harassment |
| `bookSeatAction` | scripted seat sniping at slot-open | unfair allocation; DB advisory-lock contention |
| `cancelBookingAction` | cancel/rebook churn | one waitlist-promotion email per cycle |
| `requestClubAction` | club-request flood | admin inbox flood |
| `joinAction` | join-request flood across clubs | owner inbox flood |
| `/api/club-logo/upload` | Blob token minting | storage cost |
| `setLocale` (unguarded) | trivial POST flood | function invocations |

The booking row's `(user_id, idempotency_key)` dedupe (§10) already absorbs the honest
double-taps of the slot-open rush, so the booking limits only need to stop scripts.

## 4. Architecture

Four layers, each covering what the layer above cannot reach.

```
                        ┌────────────────────────────────────────┐
  every non-/api POST → │ proxy.ts  — §17 general baseline       │  100/min per IP
                        │            (server actions)            │
                        └────────────────────────────────────────┘
                        ┌────────────────────────────────────────┐
  named server actions →│ enforceRateLimit() in the action body  │  per-account + per-IP
                        └────────────────────────────────────────┘
                        ┌────────────────────────────────────────┐
  /api/auth/**         →│ better-auth rateLimit.customRules      │  per-IP, per-endpoint
                        │ + customStorage (shared) + login hooks │  + per-account on login
                        └────────────────────────────────────────┘
                        ┌────────────────────────────────────────┐
  everything           →│ src/lib/rate-limit.ts                  │  one atomic primitive
                        └────────────────────────────────────────┘
```

`proxy.ts`'s matcher excludes `/api/**`, which is why `/api/auth/**` and
`/api/club-logo/**` each need their own hook — the baseline cannot see them.

### 4.1 The primitive (`src/lib/rate-limit.ts`)

Rewritten around `@upstash/ratelimit`'s `Ratelimit.fixedWindow`, which performs the
check-and-increment in a single server-side Lua script. That closes the `INCR`/`EXPIRE`
race and is the same guarantee the in-memory fallback has for free (single-threaded JS).

```ts
export type RateResult = { success: boolean; remaining: number; resetAt: number };

export async function rateLimit(key: string, rule: RateRule, now?: number): Promise<RateResult>;
export async function rateLimitPeek(key: string, rule: RateRule, now?: number): Promise<RateResult>;
export function resetRateLimitState(): void;   // test-only
```

- `rateLimit` consumes one token. `rateLimitPeek` reports the state **without**
  consuming — needed by the failed-login rule (§4.4), which must not count a successful
  login against the account.
- `resetAt` is a millisecond epoch, so callers can compute `Retry-After`.
- **Fail open.** A `timeout: 1000` on the `Ratelimit` instance plus a `try/catch` around
  every call means a Redis outage degrades to "unlimited", not to "nobody can book". This
  is a deliberate availability-over-enforcement choice for a club booking app: the
  failure mode of failing closed is that a slot-open rush gets a hard 429 for everyone.
  Failures are logged once per occurrence via `console.error`.
- One `Ratelimit` instance per distinct `(limit, windowSec)` pair, memoized in a
  module-level `Map`, sharing one module-level `ephemeralCache`. Both live outside any
  handler so Fluid Compute's instance reuse can short-circuit an already-blocked
  identifier without a Redis round trip.
- `prefix: 'oarly:rl'` namespaces our keys inside a shared KV database.
- When `KV_REST_API_URL`/`KV_REST_API_TOKEN` are unset (dev, test, CI) the in-memory
  fixed-window fallback is used, unchanged in behaviour but extended with `resetAt` and
  a `peek` mode.

### 4.2 Client IP (`src/lib/request-ip.ts`)

There is no IP read anywhere in the codebase today. Add one, split so the parsing is
unit-testable without a request:

```ts
export function parseClientIp(headers: {
  xForwardedFor: string | null;
  xRealIp: string | null;
}): string;                                   // pure — returns 'unknown' when absent
export async function getClientIp(): Promise<string>;   // reads next/headers
```

`x-forwarded-for` may be a comma-separated chain; the **leftmost** entry is the client.
Falls back to `x-real-ip`, then the literal `'unknown'`.

**Trust assumption, stated explicitly:** this is only safe because Vercel's edge
*overwrites* `x-forwarded-for` on every inbound request, so a client cannot spoof it. If
Oarly is ever fronted by something else, or run directly, per-IP limits become bypassable
by rotating the header. Documented in the file header.

All local requests resolve to `'unknown'` and therefore share a single per-IP bucket.
That is fine — and is why the per-IP limits are set well above the per-account ones.

### 4.3 The action adapter (`src/lib/rate-limit-guard.ts`)

```ts
export type RateCheck = { key: string; rule: RateRule };
export type RateVerdict = { limited: false } | { limited: true; retryAfterSec: number };

export async function enforceRateLimit(checks: RateCheck[]): Promise<RateVerdict>;
```

Checks run **sequentially and short-circuit**: if the per-account bucket rejects, the
per-IP bucket is not touched. A single abusive account must not be able to burn the
shared per-IP bucket for everyone behind the same NAT — a rowing club's members plausibly
share one office or gym IP.

This module reads no request state itself; the action passes the already-resolved IP in.
Core purity is preserved: `src/lib/booking.ts` and friends are untouched.

### 4.4 Where each rule lands

`RATE_LIMITS` in `src/lib/rate-limit-config.ts` stays the single tuning point. The
existing eight entries keep their §17 values. Four are added:

| Key | Value | Rationale |
|---|---|---|
| `clubRequestPerAccount` | 5 / hour | `requestClubAction` emails platform admins |
| `joinRequestPerAccount` | 20 / hour | `joinAction` emails the club owner |
| `logoUploadPerAccount` | 20 / hour | mints a Blob write token |
| `localePerIp` | 60 / min | the unguarded `setLocale` action |

Applied as:

| Surface | Rules | Behaviour when limited |
|---|---|---|
| `bookSeatAction` | `bookingPerAccount`, `bookingPerIp` | `{ status: 'error', error: 'rate_limited' }` |
| `cancelBookingAction` | `bookingPerAccount`, `bookingPerIp` | `{ status: 'error', error: 'rate_limited' }` |
| `requestClubAction` | `clubRequestPerAccount` | field-less form error |
| `joinAction` | `joinRequestPerAccount` | redirect back with `?error=rate_limited` |
| `setLocale` | `localePerIp` | returns without changing the cookie |
| `/api/club-logo/upload`, `/save` | `logoUploadPerAccount` | `429 { error: 'rate_limited' }` |
| every other server action | `apiBaselinePerIp` (proxy) | `429` + `Retry-After` |
| `/api/auth/**` | better-auth `customRules` | better-auth's own 429 |
| `/api/auth/sign-in/email` | `loginPerAccount` on **failures only** | 429 via `APIError` |

**Book and cancel share one bucket family** — `bookingPerAccount` counts both. §17 says
"booking submit", but a cancel/rebook loop is the same abuse surface (each cycle runs the
seating recompute and can fire a waitlist-promotion email), and splitting them would let
an attacker get 20/min by alternating. Deliberate extension of the spec.

**Manage/admin actions get no dedicated rule.** They are owner- or admin-gated, so abuse
requires an already-trusted account; the proxy baseline covers them.

### 4.5 The proxy baseline

`proxy.ts` becomes `async` and, **only for `request.method === 'POST'`**, consumes one
`apiBaselinePerIp` token before routing. GETs — every navigation, prefetch, and RSC
fetch — are untouched, so normal browsing costs zero Redis round-trips. Next 16's proxy
already runs on the Node.js runtime, so the REST client works there unchanged.

When the baseline trips, the proxy returns a bare `429` with a `Retry-After` header.

**Known UX caveat, accepted:** a raw 429 to a server-action POST is not an RSC payload,
so React's client runtime surfaces it as a generic "something went wrong" rather than a
toast. At 100/min per IP this only trips for scripted abuse, and the named-action limits
in §4.3 — which *do* produce a proper toast — are all far tighter, so a human hits those
first. Not worth a custom RSC error envelope.

### 4.6 better-auth

Three changes to `src/auth.ts`:

1. **`customRules`** implementing §17 per-endpoint, per-IP thresholds:
   `/sign-in/email` 20/min, `/sign-up/email` 5/hour, `/forget-password` and
   `/reset-password` 10/hour, `/send-verification-email` 10/hour. The flat
   `window: 60, max: 100` stays as the fallback for every other auth endpoint.

2. **`customStorage`** backed by the same Upstash client, so limits are shared across
   lambda instances instead of per-instance. better-auth 1.6.26's
   `BetterAuthRateLimitStorage` exposes an optional `consume(key, { window, max })`
   returning `{ allowed, retryAfter }` — the atomic path that "closes the concurrent-bypass
   gap of the separate get/set path" (its own words, verified in the installed
   `@better-auth/core@1.6.26` typings). We implement `consume` over `rateLimit()`, plus
   the still-required `get`/`set` over plain Redis JSON.
   `customStorage` is only wired **when KV is configured**; without it better-auth keeps
   its in-memory storage, which is correct for dev and test.

3. **Per-account failed-login limiting.** better-auth keys its own limits by IP, so §17's
   "5 failed attempts / 15 min per account" cannot be expressed as a `customRule`. It is
   implemented as a pair of hooks on `/sign-in/email`:
   - `hooks.before` — `rateLimitPeek` on `login:acct:<lowercased email>`; if already
     exhausted, throw `APIError('TOO_MANY_REQUESTS')`.
   - `hooks.after` — consume a token **only when the response indicates failure**.

   Peek-then-consume-on-failure is what makes the rule match the spec's word *failed*. A
   naive consume-on-every-attempt would lock out a member who legitimately signs in on
   six devices in fifteen minutes.

   The email is lowercased before keying so `Ali@x.com` and `ali@x.com` share a bucket.

### 4.7 Local testing

`@upstash/redis` speaks the Upstash **REST** protocol, not RESP, so a vanilla `redis`
container is not enough. `docker-compose.yml` gains two services behind a
`redis` compose profile — so the default `docker compose up -d` still starts only Postgres:

- `redis:8-alpine`
- `hiett/serverless-redis-http` (srh) on `:8079`, with a fixed dev token

`src/lib/rate-limit.integration.test.ts` runs against it, gated on
`describe.skipIf(!process.env.TEST_KV_REST_API_URL)` so `pnpm test` stays green without
Docker. It is the only place the Upstash path is exercised end to end: it proves the
atomicity claim by firing N concurrent `rateLimit` calls at a limit of K and asserting
exactly K succeed — the assertion the old `INCR`/`EXPIRE` implementation would fail.

## 5. Testing

| Level | What |
|---|---|
| unit | `parseClientIp` — chain, single, whitespace, `x-real-ip` fallback, absent |
| unit | in-memory limiter — consume, exhaust, window roll, `peek` does not consume, `resetAt` |
| unit | `enforceRateLimit` — passes all, rejects first, **does not consume the second bucket after the first rejects** |
| unit | fail-open — a limiter whose backend throws returns `success: true` |
| unit | proxy baseline decision — POST checked, GET skipped |
| integration | Upstash path via srh — atomicity under N concurrent calls, TTL is set |
| integration | booking action returns `rate_limited` after the 11th call in a window |

Every test threads an explicit frozen `now`; no test depends on the real clock.

## 6. Rollout

No migration. No schema change. Ships dark in dev/test (in-memory) and turns on in
production the moment `KV_REST_API_URL` and `KV_REST_API_TOKEN` are present, which they
already are via the Vercel Upstash integration.

If a limit proves too tight in production, `src/lib/rate-limit-config.ts` is the single
file to edit.

## 7. Deferred

- Vercel BotID / bot detection on the auth endpoints.
- Exponential backoff after repeated login lockouts (§17 mentions it; the fixed window
  is the floor, and escalation needs a durable per-account counter we do not want yet).
- Per-club quotas.
- A proper RSC-shaped 429 envelope for the proxy baseline (§4.5 caveat).
