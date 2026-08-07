import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { env } from '@/env';
import { accountKeyFor } from '@/lib/auth-rate-limit';
import { rateLimit, rateLimitReset, resetRateLimitState } from '@/lib/rate-limit';
import { RATE_LIMITS } from '@/lib/rate-limit-config';

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

/**
 * The tests above prove `@upstash/ratelimit` itself is atomic. They do NOT prove our
 * own `rateLimit`/`rateLimitReset` wiring (src/lib/rate-limit.ts) is correct, because
 * `rateLimit()` reads `env.KV_REST_API_*` at call time rather than accepting a client —
 * so exercising it means flipping the already-loaded `env` object into the Upstash
 * branch, the same way rate-limit.test.ts's "backend failure" suite does (`vi.stubEnv`
 * does not reach `@t3-oss/env-nextjs`'s snapshot; `Object.defineProperty` on `env`
 * itself does, because `env` is a `Proxy` with only a `get` trap).
 *
 * Two things here have never run against a real backend before this file:
 *   - `rateLimitReset`, which calls `Ratelimit#resetUsedTokens`, i.e. a Redis
 *     `SCAN`+`DEL` under a `MATCH` pattern. This is what lets a successful sign-in
 *     clear an account's failed-login count (auth-rate-limit.ts's `authRateLimitAfter`).
 *   - `accountKeyFor`'s glob-escaping (auth-rate-limit.ts's `globSafe`), added because
 *     that same `SCAN ... MATCH` pattern treats `*`, `?`, `[`, `]`, and `\` as
 *     wildcards. An unescaped `*` in a user-supplied email would make `resetUsedTokens`
 *     clear every OTHER bucket whose identifier happens to match the resulting glob —
 *     i.e. an unrelated member's failed-login count, wiping out a lockout that member
 *     earned honestly.
 */
describe.skipIf(!url || !token)('rate limiter — through our own rateLimit/rateLimitReset exports', () => {
  const originalKvUrl = env.KV_REST_API_URL;
  const originalKvToken = env.KV_REST_API_TOKEN;

  beforeEach(() => {
    resetRateLimitState();
    Object.defineProperty(env, 'KV_REST_API_URL', {
      value: url,
      configurable: true,
      writable: true,
      enumerable: true,
    });
    Object.defineProperty(env, 'KV_REST_API_TOKEN', {
      value: token,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(env, 'KV_REST_API_URL', {
      value: originalKvUrl,
      configurable: true,
      writable: true,
      enumerable: true,
    });
    Object.defineProperty(env, 'KV_REST_API_TOKEN', {
      value: originalKvToken,
      configurable: true,
      writable: true,
      enumerable: true,
    });
    resetRateLimitState();
  });

  it('rateLimitReset actually empties the bucket via a real SCAN+DEL', async () => {
    // Unique per test so a rerun never inherits a previous run's window.
    const key = `int-reset-${process.pid}-${performance.now()}`;
    const rule = { name: `integrationRule-${key}`, limit: 1, windowSec: 60 };

    expect((await rateLimit(key, rule)).success).toBe(true);
    expect((await rateLimit(key, rule)).success).toBe(false);

    await rateLimitReset(key, rule);

    // If resetUsedTokens silently no-opped against srh, this would still read false.
    expect((await rateLimit(key, rule)).success).toBe(true);
  });

  it('escapes glob metacharacters so resetting an attacker-controlled key cannot clear a sibling bucket', async () => {
    // Unique per test so a rerun never inherits a previous run's window, and so the two
    // manufactured emails below can't collide with a prior run's.
    const suffix = `${process.pid}-${performance.now()}`;
    // Chosen so that, WITHOUT escaping, the attacker identifier's embedded `*` would
    // glob-match the victim identifier: victim = "<suffix>x@evil.com" is exactly what
    // the pattern "<suffix>*@evil.com:*" (unescaped) matches. See globSafe's doc
    // comment in auth-rate-limit.ts.
    const attacker = accountKeyFor('/sign-in/email', { email: `${suffix}*@evil.com` });
    const victim = accountKeyFor('/sign-in/email', { email: `${suffix}x@evil.com` });
    if (!attacker || !victim) throw new Error('accountKeyFor did not match /sign-in/email with an email body');
    expect(attacker.key).not.toBe(victim.key);
    expect(attacker.rule).toEqual(RATE_LIMITS.loginPerAccount);

    // Exhaust the victim's bucket so a leaked reset is observable as success flipping
    // back to true, not just as "still within the limit".
    for (let i = 0; i < victim.rule.limit; i += 1) {
      expect((await rateLimit(victim.key, victim.rule)).success).toBe(true);
    }
    expect((await rateLimit(victim.key, victim.rule)).success).toBe(false);

    // `@upstash/ratelimit` keeps a process-local `ephemeralCache` that remembers an
    // identifier as blocked once it has seen one rejection, and answers later `.limit()`
    // calls for that SAME identifier from the cache without a Redis round trip. Left in
    // place, that cache would make the final assertion below pass regardless of whether
    // the escaping actually works, because the victim's identifier would already read
    // "blocked" locally. Dropping the memoized limiter (Redis-side data is untouched)
    // forces the re-check after the attacker's reset to hit real Redis.
    resetRateLimitState();

    // Consume one token under the attacker's own (escaped) identifier, then reset it —
    // mirroring what a successful sign-in from "*@evil.com" would trigger.
    await rateLimit(attacker.key, attacker.rule);
    await rateLimitReset(attacker.key, attacker.rule);

    // The victim's bucket must still be exhausted. If `*` had not been escaped, the
    // attacker's resetUsedTokens' MATCH pattern would also have swept the victim's key
    // and this would now read `true`.
    expect((await rateLimit(victim.key, victim.rule)).success).toBe(false);
  });
});
