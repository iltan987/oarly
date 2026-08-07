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
//
// `rateLimit` is the only export overridden; `resetRateLimitState` and `rateLimitReset`
// are passed through to the real module via `importOriginal` so the
// `authRateLimitBefore`/`authRateLimitAfter` tests below can exercise the actual in-memory
// bucket (multi-attempt counting, reset-on-success) rather than a canned response.
// `mockState.realRateLimit` captures the unmocked implementation so those tests can point
// `mockState.rateLimitImpl` at real bucket semantics instead of a fixed `RateLimitResult`.
// Held in a `vi.hoisted` object (rather than plain top-level `let`s) because the
// `vi.mock` factory below is itself hoisted above ordinary statements and may not
// reference top-level variables that aren't declared through `vi.hoisted`.
const mockState = vi.hoisted(() => ({
  rateLimitImpl: undefined as unknown as RateLimitImpl,
  realRateLimit: undefined as unknown as RateLimitImpl,
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<{ rateLimit: RateLimitImpl }>();
  mockState.realRateLimit = actual.rateLimit;
  return {
    ...actual,
    rateLimit: (...args: Parameters<RateLimitImpl>) => mockState.rateLimitImpl(...args),
  };
});

import { APIError } from 'better-auth/api';

import {
  accountKeyFor,
  authConsume,
  authRateLimitAfter,
  authRateLimitBefore,
  authRateLimitRules,
} from '@/lib/auth-rate-limit';
import { resetRateLimitState } from '@/lib/rate-limit';
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
    mockState.rateLimitImpl = async () => ({ success: true, remaining: 4, resetAt: NOW + 60_000 });
    expect(await authConsume('k', RULE)).toEqual({ allowed: true, retryAfter: null });
  });

  it('reports allowed:false with a positive integer retryAfter once exhausted', async () => {
    mockState.rateLimitImpl = async () => ({ success: false, remaining: 0, resetAt: NOW + 45_000 });
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
    mockState.rateLimitImpl = async () => ({ success: false, remaining: 0, resetAt: NOW });
    const result = await authConsume('k', RULE);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(1);
  });

  it('fails open: forwards a fail-open success as allowed:true', async () => {
    // `rateLimit()` itself guarantees it never rejects and never throws — a KV outage
    // resolves `{ success: true, ... }` (see rate-limit.ts's own catch block and its
    // dedicated fail-open tests). This proves `authConsume` forwards that result as
    // `allowed: true` rather than, say, misreading `remaining === limit` as a rejection.
    mockState.rateLimitImpl = async () => ({ success: true, remaining: RULE.max, resetAt: NOW + RULE.window * 1000 });
    expect(await authConsume('k', RULE)).toEqual({ allowed: true, retryAfter: null });
  });
});

describe('accountKeyFor', () => {
  it('keys a sign-in by lowercased email and clears on success', () => {
    expect(accountKeyFor('/sign-in/email', { email: 'Ali@Example.COM', password: 'x' })).toEqual({
      key: 'login:acct:ali@example.com',
      rule: RATE_LIMITS.loginPerAccount,
      clearOnSuccess: true,
    });
  });

  it('keys a password-reset request by email and does NOT clear on success', () => {
    // Succeeding at "please email me a reset link" repeatedly IS the abuse, so a
    // successful request must still count against the mailbox's budget.
    expect(accountKeyFor('/request-password-reset', { email: 'bob@example.com' })).toEqual({
      key: 'pwreset:email:bob@example.com',
      rule: RATE_LIMITS.passwordResetPerEmail,
      clearOnSuccess: false,
    });
  });

  it('returns null for paths it does not govern', () => {
    expect(accountKeyFor('/sign-up/email', { email: 'a@b.com' })).toBeNull();
    expect(accountKeyFor('/get-session', {})).toBeNull();
  });

  it('returns null when the body carries no usable email', () => {
    expect(accountKeyFor('/sign-in/email', {})).toBeNull();
    expect(accountKeyFor('/sign-in/email', { email: '' })).toBeNull();
    expect(accountKeyFor('/sign-in/email', { email: 42 })).toBeNull();
    expect(accountKeyFor('/sign-in/email', null)).toBeNull();
    expect(accountKeyFor('/sign-in/email', undefined)).toBeNull();
  });

  it('trims surrounding whitespace before keying', () => {
    expect(accountKeyFor('/sign-in/email', { email: '  ali@example.com  ' })?.key)
      .toBe('login:acct:ali@example.com');
  });
});

describe('authRateLimitBefore / authRateLimitAfter', () => {
  beforeEach(() => {
    // Point the mocked `rateLimit` at the real in-memory implementation so these tests
    // exercise actual bucket accumulation instead of a canned `authConsume`-style stub.
    mockState.rateLimitImpl = mockState.realRateLimit;
    resetRateLimitState();
  });

  const ctxFor = (path: string, body: unknown, returned?: unknown) =>
    ({ path, body, context: { returned } }) as never;

  it('rejects the sixth sign-in attempt for one account', async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }))).resolves.toBeUndefined();
    }
    await expect(authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }))).rejects.toThrow();
  });

  it('a successful attempt clears the count', async () => {
    for (let i = 0; i < 5; i += 1) {
      await authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }));
    }
    await authRateLimitAfter(ctxFor('/sign-in/email', { email: 'a@b.com' }, { user: { id: 'u1' } }));
    await expect(authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }))).resolves.toBeUndefined();
  });

  it('a failed attempt does not clear the count', async () => {
    const failure = new APIError('UNAUTHORIZED', { message: 'bad password' });
    for (let i = 0; i < 5; i += 1) {
      await authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }));
      await authRateLimitAfter(ctxFor('/sign-in/email', { email: 'a@b.com' }, failure));
    }
    await expect(authRateLimitBefore(ctxFor('/sign-in/email', { email: 'a@b.com' }))).rejects.toThrow();
  });
});
