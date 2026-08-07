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
      const result = await rateLimit(
        `auth:${key}`,
        { name: AUTH_RULE_NAME, limit: r.max, windowSec: r.window },
        now,
      );
      return {
        allowed: result.success,
        retryAfter: result.success ? null : Math.max(1, Math.ceil((result.resetAt - now) / 1000)),
      };
    },
  };
})();
