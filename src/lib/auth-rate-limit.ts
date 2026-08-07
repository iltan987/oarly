import { Redis } from '@upstash/redis';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';

import { env } from '@/env';
import { rateLimit, rateLimitReset } from '@/lib/rate-limit';
import { RATE_LIMITS, type RateRule } from '@/lib/rate-limit-config';
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
 * oversight: 20/60s is LOOSER in burst shape than the 3/10s default it replaces at every
 * horizon that matters — the worst case is the 10-second one `authRateLimitRules` itself
 * can't see: the default permits 3 in any 10s slice, a fixed 20/60s window permits up to
 * 20 in the first 10s of its window, a 6.7x loosening. At the minute and hour horizons it
 * is milder but still a loosening (3/10s permits 18/min and 1080/hour; 20/60s permits
 * 20/min and 1200/hour). This is accepted because 20/60s is §17's specified `loginPerIp`
 * value, and the real control against credential stuffing on this endpoint is the
 * per-ACCOUNT rule below (`RATE_LIMITS.loginPerAccount`, applied by `authRateLimitBefore`/
 * `authRateLimitAfter`), which better-auth's IP-keyed limiter cannot express. With that
 * hook wired into `hooks.before`/`hooks.after` in `src/auth.ts`, `/sign-in/email` is
 * protected by BOTH dimensions: this IP-keyed rule (real accounts sharing one address) and
 * the identity-keyed one (one account attacked from many addresses) — the distributed
 * attacker gap once documented here is closed.
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
 * Escapes characters that are meaningful to Redis' glob-style key matching, so a key built
 * from user-controlled email text can't widen what `rateLimitReset` clears.
 *
 * This is NOT cosmetic: `@upstash/ratelimit`'s `resetTokens` builds
 * `pattern = [identifier, '*'].join(':')` and feeds it straight into a `SCAN ... MATCH
 * pattern` Lua script (`@upstash/ratelimit@2.0.8` dist/index.mjs, the `fixedWindow`
 * limiter's `resetTokens`). `*`, `?`, `[`, `]`, and `\` are all valid RFC 5322 email
 * local-part characters. Left unescaped, a successful sign-in from `*@evil.com` would
 * build the identifier `login:acct:*@evil.com`, and `resetTokens`'s own `:*` suffix plus
 * Redis' glob rules would make that pattern match — and DELETE — every OTHER
 * `login:acct:<anything>@evil.com` bucket, clearing accounts that never attempted, let
 * alone won, a sign-in. `%` is escaped FIRST (to `%25`) so the encoding stays injective:
 * without that ordering, a literal `%2a` a user typed and an escaped `*` (also `%2a`)
 * would collide into the same key.
 */
function globSafe(s: string): string {
  return s.replace(/%/g, '%25').replace(/[*?[\]\\]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
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
  const safeEmail = globSafe(email);
  if (path === '/sign-in/email') {
    return { key: `login:acct:${safeEmail}`, rule: RATE_LIMITS.loginPerAccount, clearOnSuccess: true };
  }
  if (path === '/request-password-reset') {
    return { key: `pwreset:email:${safeEmail}`, rule: RATE_LIMITS.passwordResetPerEmail, clearOnSuccess: false };
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
