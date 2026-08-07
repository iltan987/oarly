import { getIp } from 'better-auth/api';
import { describe, expect, it } from 'vitest';

import { auth } from '@/auth';

/**
 * Guards `advanced.ipAddress` in `src/auth.ts` against the "one global auth bucket"
 * failure mode.
 *
 * better-auth 1.6.26 keys its own rate limits on `${ip}|${path}`, where `ip` comes from
 * `getIp(request, options)`. When `getIp` cannot resolve a trustworthy address the limiter
 * substitutes the literal `NO_TRUSTED_IP_KEY` ('no-trusted-ip'), so every auth request on
 * the platform shares ONE bucket. With no `advanced.ipAddress` configured, that is exactly
 * what a comma-separated `x-forwarded-for` produces — `getIPFromHeader` bails out with
 * `if (forwardedIps.length !== 1) return null`.
 *
 * These tests drive the REAL `getIp` from the installed package against the REAL
 * `auth.options`, so they fail if the config block is removed, emptied, or narrowed.
 *
 * Why the assertions are "two chains resolve to two DIFFERENT addresses" rather than
 * "resolves to non-null": under vitest, `getIp` short-circuits an unresolvable address to
 * a constant `127.0.0.1` (`if (isTest() || isDevelopment()) return LOCALHOST_IP`, and
 * `nodeENV` is snapshotted at import so it cannot be stubbed away). A non-null assertion
 * would therefore pass vacuously with the config deleted. Distinctness cannot: the
 * localhost fallback is the same value for every request, so collapsing is observable as
 * "these two clients got the same key".
 */
function req(headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/auth/sign-in/email', { method: 'POST', headers });
}

const LOCALHOST_FALLBACK = '127.0.0.1';

describe('auth advanced.ipAddress', () => {
  it('resolves a chained x-forwarded-for instead of collapsing to the shared fallback key', () => {
    const a = getIp(req({ 'x-forwarded-for': '198.51.100.7, 203.0.113.9' }), auth.options);
    const b = getIp(req({ 'x-forwarded-for': '198.51.100.8, 203.0.113.10' }), auth.options);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // The load-bearing assertion: two distinct clients behind a chain must land in two
    // distinct rate-limit buckets. Unconfigured, both resolve to the same localhost
    // fallback here and to `null` -> 'no-trusted-ip' in production.
    expect(a).not.toBe(b);
    expect(a).not.toBe(LOCALHOST_FALLBACK);
    expect(b).not.toBe(LOCALHOST_FALLBACK);
  });

  it('still resolves a single-valued x-forwarded-for, the stock Vercel shape', () => {
    // The config must not regress the case that already worked.
    expect(getIp(req({ 'x-forwarded-for': '198.51.100.7' }), auth.options)).toBe('198.51.100.7');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent, matching parseClientIp precedence', () => {
    expect(getIp(req({ 'x-real-ip': '198.51.100.42' }), auth.options)).toBe('198.51.100.42');
  });

  it('prefers x-forwarded-for over x-real-ip, matching parseClientIp precedence', () => {
    const ip = getIp(req({ 'x-forwarded-for': '198.51.100.7', 'x-real-ip': '198.51.100.42' }), auth.options);
    expect(ip).toBe('198.51.100.7');
  });
});
