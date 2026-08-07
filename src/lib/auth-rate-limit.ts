import { Redis } from '@upstash/redis';

import { env } from '@/env';
import { rateLimit } from '@/lib/rate-limit';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { retryAfterSeconds } from '@/lib/rate-limit-guard';

type StoredRateLimit = { key: string; count: number; lastRequest: number };

const rule = (r: { limit: number; windowSec: number }) => ({ window: r.windowSec, max: r.limit });

/**
 * §17's per-endpoint, per-IP auth thresholds.
 *
 * These REPLACE better-auth's built-in special rules for the same paths rather than
 * stacking with them (dist/api/rate-limiter/index.mjs:301-318). The defaults given up are
 * 3/10s on sign-in and sign-up and 3/60s on the mail-sending endpoints.
 *
 * `/sign-up/email`, `/request-password-reset`, and `/send-verification-email` are net far
 * tighter than the defaults they replace over any window that matters (hours, per §17,
 * vs. the defaults' seconds-scale bursts).
 *
 * `/sign-in/email` is the one exception, and it is a KNOWN, ACCEPTED trade, not an
 * oversight: 20/60s is marginally LOOSER in burst shape than the 3/10s default it
 * replaces (3/10s permits 18/min and 1080/hour; 20/60s permits 20/min and 1200/hour — more
 * at every horizon, not less). This is accepted because 20/60s is §17's specified
 * `loginPerIp` value, and the real control against credential stuffing on this endpoint is
 * a per-ACCOUNT rule (`RATE_LIMITS.loginPerAccount`), which better-auth's IP-keyed limiter
 * cannot express. That per-account rule does NOT exist yet in this file — it is unused
 * anywhere in the repo at this commit and is expected to land as a `hooks.before` check in
 * a later task. Until it does, `/sign-in/email` is protected only by this IP-keyed rule,
 * which is a real (if modest) gap against a distributed attacker.
 */
export const authRateLimitRules = {
  '/sign-in/email': rule(RATE_LIMITS.loginPerIp),
  '/sign-up/email': rule(RATE_LIMITS.signupPerIp),
  '/request-password-reset': rule(RATE_LIMITS.passwordResetPerIp),
  '/reset-password': rule(RATE_LIMITS.passwordResetPerIp),
  '/send-verification-email': rule(RATE_LIMITS.passwordResetPerIp),
} satisfies Record<string, { window: number; max: number }>;

const AUTH_PREFIX = 'oarly:auth-rl';

/**
 * The `RateRule` name used for every call into `rateLimit()` from this file.
 *
 * A single constant is safe here — and NOT a bucket collision across auth endpoints —
 * because the `key` passed to `consume` below is better-auth's own rate-limit key, which
 * already folds in the request path: `createRateLimitKey(ip, path) => `${ip}|${path}``
 * (@better-auth/core@1.6.26, dist/utils/ip.mjs:226-228). `/sign-in/email` and
 * `/sign-up/email` traffic land under different `key` strings and therefore different
 * storage buckets even though they share this rule name.
 */
const AUTH_RULE_NAME = 'authEndpoint';

function kvRedis(): Redis | null {
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) return null;
  return new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN });
}

/**
 * The atomic path better-auth's limiter prefers (see the doc comment on
 * `authRateLimitStorage` below). Exported standalone — rather than only as a closure
 * inside the storage object — so it can be exercised directly in tests without needing KV
 * env vars configured, which is the only thing that makes the storage object itself
 * non-`undefined`.
 */
export async function authConsume(
  key: string,
  r: { window: number; max: number },
): Promise<{ allowed: boolean; retryAfter: number | null }> {
  const now = Date.now();
  const result = await rateLimit(`auth:${key}`, { name: AUTH_RULE_NAME, limit: r.max, windowSec: r.window }, now);
  return {
    allowed: result.success,
    retryAfter: result.success ? null : retryAfterSeconds(result.resetAt, now),
  };
}

/**
 * Shared storage for better-auth's own limiter.
 *
 * Without this, better-auth stores counters in per-process memory, so on Vercel the
 * effective limit is (configured limit x number of warm instances) — which is to say,
 * no limit at all. `consume` (`authConsume` above) is the atomic path better-auth prefers.
 *
 * `undefined` when KV is not configured, so dev and test keep better-auth's in-memory
 * storage instead of failing to construct a client.
 */
export const authRateLimitStorage = (() => {
  const redis = kvRedis();
  if (!redis) return undefined;
  return {
    // `get`/`set` below are DEAD CODE while `consume` is present: better-auth's own
    // `onRequestRateLimit` uses `consume` exclusively and never touches `get`/`set` when
    // it exists (dist/api/rate-limiter/index.mjs:342-347), and upstream's own
    // `FIXME(rate-limit-consume-required)` on the interface says the non-atomic get/set
    // fallback path is slated for removal entirely. They are implemented here only
    // because `BetterAuthRateLimitStorage` still requires both as members today.
    //
    // Because they are unreachable, their keyspace and TTL are deliberately NOT kept in
    // sync with `authConsume`'s: `get`/`set` read and write `oarly:auth-rl:<key>` with a
    // flat 1-hour TTL, while `consume` routes through `rateLimit()` into a completely
    // different keyspace (`oarly:rl:authEndpoint:auth:<key>`, TTL derived from each rule's
    // own window). If `consume` is ever removed upstream and this fallback path becomes
    // live, both of these need to be rebuilt against `authConsume`'s scheme, not patched
    // to match it — do not "fix" this mismatch without doing that migration.
    async get(key: string): Promise<StoredRateLimit | null> {
      return (await redis.get<StoredRateLimit>(`${AUTH_PREFIX}:${key}`)) ?? null;
    },
    async set(key: string, value: StoredRateLimit): Promise<void> {
      await redis.set(`${AUTH_PREFIX}:${key}`, value, { ex: 60 * 60 });
    },
    consume: authConsume,
  };
})();
