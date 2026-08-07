import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env } from '@/env';
import type { RateRule } from '@/lib/rate-limit-config';

export type RateResult = {
  success: boolean;
  remaining: number;
  /**
   * Millisecond epoch at which the current window expires.
   *
   * The two backends anchor this differently, and callers must not assume otherwise.
   * The in-memory fallback anchors at first use: a bucket's window lasts exactly
   * `windowSec` from whichever request opened it, tracked via the injected `now`. The
   * Upstash-backed limiter anchors to epoch-aligned buckets
   * (`floor(Date.now() / windowMs)`), so `resetAt` is the next epoch boundary — usually
   * less than a full window away — and does NOT depend on which request happened to be
   * first. On the Upstash path the injected `now` argument is ignored by the underlying
   * library entirely; it is only used by this function's own `catch` and
   * timeout-normalization branches, both of which are fallback values, not real window
   * state. A test that freezes `now` only controls behaviour on the in-memory path.
   */
  resetAt: number;
};

/** Namespaces our keys inside a KV database that may be shared with other features. */
const PREFIX = 'oarly:rl';

/**
 * The identifier both backends store state under. Folding the rule's own `name` into it
 * is load-bearing, not decoration: the Upstash path's Redis key is built from this
 * identifier plus a bucket number under `PREFIX`, which is the same literal string for
 * every rule, and the in-memory `buckets` map is keyed on it directly. Without the rule
 * folded in, two different rules called with the same caller-supplied `key` (e.g. an
 * account id reused across a login rule and a booking rule) would silently share one
 * counter.
 *
 * Discriminating on `rule.name` rather than `rule.limit`/`rule.windowSec` is deliberate:
 * `RATE_LIMITS` already has multiple rules with identical thresholds (e.g.
 * `joinRequestPerAccount` and `logoUploadPerAccount` are both
 * `{ limit: 20, windowSec: 60 * 60 }`), so keying on the values would have reproduced the
 * exact collision this function exists to prevent. `name` is
 * kept in sync with each rule's own `RATE_LIMITS` key by
 * `rate-limit-config.test.ts`.
 */
function storageKey(key: string, rule: RateRule): string {
  return `${rule.name}:${key}`;
}

// --- in-memory fixed-window fallback (dev, test, CI) ---
// Single-threaded JS makes check-and-increment atomic here for free.
const buckets = new Map<string, { count: number; resetAt: number }>();

function inMemory(key: string, rule: RateRule, now: number): RateResult {
  const storedKey = storageKey(key, rule);
  const bucket = buckets.get(storedKey);
  if (!bucket || now >= bucket.resetAt) {
    const resetAt = now + rule.windowSec * 1000;
    buckets.set(storedKey, { count: 1, resetAt });
    return { success: true, remaining: rule.limit - 1, resetAt };
  }
  if (bucket.count >= rule.limit) return { success: false, remaining: 0, resetAt: bucket.resetAt };
  bucket.count += 1;
  return { success: true, remaining: rule.limit - bucket.count, resetAt: bucket.resetAt };
}

// --- Upstash-backed limiter (production) ---
// `Ratelimit` instances are memoized at module scope, each with its own ephemeral cache.
// Both must live outside any request handler: that is the only way Fluid Compute's
// instance reuse can reject an already-blocked identifier without paying a Redis round
// trip.
//
// The memo is keyed on `${limit}:${windowSec}` — the limiter's own configuration — NOT on
// the rule name, so rules that happen to share thresholds SHARE one `Ratelimit` and one
// ephemeral cache Map. That is deliberate and safe, but for a reason worth stating: the
// identifier every caller passes to `.limit()` is `storageKey(key, rule)`, which is
// name-prefixed, and the ephemeral cache is keyed on that identifier. So two rules sharing
// an instance still occupy disjoint regions of the shared cache (and of Redis), and a
// blocked identifier under one rule cannot leak a false block into another. Constructing a
// second identical `Ratelimit` per name would only add an instance and a cache, never
// change a verdict.
//
// The two schemes have therefore DIVERGED on purpose: the memo discriminates on
// behaviour, the storage key discriminates on identity. Do not "align" them by keying the
// memo on `rule.name` under the impression that isolation depends on it, and do not key
// storage on thresholds — that direction is a real collision (see `storageKey`).
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
    const result = await limiterFor(rule).limit(storageKey(key, rule));
    // `@upstash/ratelimit`'s own `timeout` option (set in limiterFor) does NOT throw when
    // the Redis call is slow — it RESOLVES `{ success: true, limit: 0, remaining: 0,
    // reset: 0, reason: 'timeout' }` (see applyTimeout in the installed dist/index.mjs).
    // That is the library's own fail-open, but its zeroed-out fields violate this
    // module's contract on `resetAt`, so our `catch` below never sees it — it has to be
    // normalized here to the same sane defaults the catch path returns.
    if (result.reason === 'timeout' || result.reset <= 0) {
      return { success: true, remaining: rule.limit, resetAt: now + rule.windowSec * 1000 };
    }
    return { success: result.success, remaining: result.remaining, resetAt: result.reset };
  } catch (error) {
    console.error('rateLimit: backend unavailable, allowing request', error);
    return { success: true, remaining: rule.limit, resetAt: now + rule.windowSec * 1000 };
  }
}

/** Empty `key`'s bucket. Used when a successful sign-in clears an account's failed-attempt count. */
export async function rateLimitReset(key: string, rule: RateRule): Promise<void> {
  if (!upstashConfigured()) {
    buckets.delete(storageKey(key, rule));
    return;
  }
  try {
    await limiterFor(rule).resetUsedTokens(storageKey(key, rule));
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
