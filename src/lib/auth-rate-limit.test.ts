import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RateLimitResult = { success: boolean; remaining: number; resetAt: number };
type RateLimitImpl = (
  key: string,
  rule: { name: string; limit: number; windowSec: number },
  now?: number,
) => Promise<RateLimitResult>;

// `authConsume` is a thin wrapper around `@/lib/rate-limit`'s `rateLimit()`, which already
// has its own exhaustive unit and fail-open coverage (rate-limit.test.ts). Mocking it here
// lets these tests drive `authConsume`'s MAPPING logic — success -> allowed, resetAt ->
// retryAfter, fail-open passthrough — with exact, arbitrary `RateResult`s, rather than
// re-deriving those same result shapes through the real in-memory or Upstash backends.
let rateLimitImpl: RateLimitImpl;

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: Parameters<RateLimitImpl>) => rateLimitImpl(...args),
}));

import { authConsume, authRateLimitRules } from '@/lib/auth-rate-limit';
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
    // All FIVE paths are asserted against their RATE_LIMITS source, not just three:
    // mutation-tested by swapping '/reset-password' to RATE_LIMITS.bookingPerIp
    // (60/60s instead of 10/3600s — a 600x hourly loosening on a password-reset
    // endpoint) and confirming this test then fails.
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
    expect(authRateLimitRules['/reset-password']).toEqual({
      window: RATE_LIMITS.passwordResetPerIp.windowSec,
      max: RATE_LIMITS.passwordResetPerIp.limit,
    });
    expect(authRateLimitRules['/send-verification-email']).toEqual({
      window: RATE_LIMITS.passwordResetPerIp.windowSec,
      max: RATE_LIMITS.passwordResetPerIp.limit,
    });
  });

  it('uses the §17 values', () => {
    expect(authRateLimitRules['/sign-up/email']).toEqual({ window: 3600, max: 5 });
    expect(authRateLimitRules['/sign-in/email']).toEqual({ window: 60, max: 20 });
  });
});

describe('authConsume', () => {
  const RULE = { window: 60, max: 5 };
  const NOW = 1_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows while the backend reports success', async () => {
    rateLimitImpl = async () => ({ success: true, remaining: 4, resetAt: NOW + 60_000 });
    expect(await authConsume('k', RULE)).toEqual({ allowed: true, retryAfter: null });
  });

  it('reports allowed:false with a positive integer retryAfter once exhausted', async () => {
    rateLimitImpl = async () => ({ success: false, remaining: 0, resetAt: NOW + 45_000 });
    const result = await authConsume('k', RULE);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(45);
  });

  it('never reports a retryAfter of 0 or negative, even when resetAt is at or before now', async () => {
    // Exercises the clock-skew floor `retryAfterSeconds` exists for: a rejected request
    // whose `resetAt` has already elapsed by the time this runs must still tell the
    // caller to wait at least 1 second — `0` (or negative) invites an immediate retry
    // that is still refused.
    //
    // Mutation-tested: reverting authConsume to inline `Math.max(0, Math.ceil(...))`
    // (the exact regression this test guards against) makes this assertion fail, since
    // Math.ceil((NOW - NOW) / 1000) is 0, not 1. Confirmed by hand.
    rateLimitImpl = async () => ({ success: false, remaining: 0, resetAt: NOW });
    const result = await authConsume('k', RULE);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(1);
  });

  it('fails open: forwards a fail-open success as allowed:true', async () => {
    // `rateLimit()` itself guarantees it never rejects and never throws — a KV outage
    // resolves `{ success: true, ... }` (see rate-limit.ts's own catch block and its
    // dedicated fail-open tests). This proves `authConsume` forwards that result as
    // `allowed: true` rather than, say, misreading `remaining === limit` as a rejection.
    rateLimitImpl = async () => ({ success: true, remaining: RULE.max, resetAt: NOW + RULE.window * 1000 });
    expect(await authConsume('k', RULE)).toEqual({ allowed: true, retryAfter: null });
  });
});
