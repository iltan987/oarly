import { rateLimit } from '@/lib/rate-limit';
import type { RateRule } from '@/lib/rate-limit-config';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { parseClientIp } from '@/lib/request-ip';

export type RateCheck = { key: string; rule: RateRule };
export type RateVerdict = { limited: false } | { limited: true; retryAfterSec: number };

/**
 * Seconds until `resetAt`, floored at 1.
 *
 * The floor matters on the KV-backed path: Upstash anchors `resetAt` to an epoch-aligned
 * boundary that is independent of the caller's `now`, so clock skew between the caller
 * and Redis can put `now` at or past `resetAt` even for a request that was just rejected
 * — `resetAt - now` can be zero or negative. A `Retry-After: 0` (or negative) header
 * invites an immediate retry that is still refused, so this never reports less than 1.
 */
export function retryAfterSeconds(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

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
      return { limited: true, retryAfterSec: retryAfterSeconds(result.resetAt, now) };
    }
  }
  return { limited: false };
}

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
