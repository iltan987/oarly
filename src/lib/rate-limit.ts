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
