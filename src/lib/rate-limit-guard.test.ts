import { beforeEach, describe, expect, it } from 'vitest';

import { rateLimit, resetRateLimitState } from '@/lib/rate-limit';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { enforceBaseline, enforceRateLimit, retryAfterSeconds } from '@/lib/rate-limit-guard';

const ACCOUNT = { name: 'testAccount', limit: 2, windowSec: 60 };
const IP = { name: 'testIp', limit: 10, windowSec: 60 };
const T0 = 1_000_000;

describe('retryAfterSeconds', () => {
  // The in-memory backend only ever returns `success: false` while `now < resetAt`
  // strictly, so `enforceRateLimit`'s own tests can never exercise the floor for real —
  // `resetAt - now` is always >= 1ms there. The floor exists for the KV-backed path,
  // where `resetAt` is epoch-anchored independent of the caller's `now`, so clock skew
  // can make `resetAt <= now`. These cases pin that directly.
  it('floors at 1 when resetAt equals now', () => {
    expect(retryAfterSeconds(1_000, 1_000)).toBe(1);
  });

  it('floors at 1 when resetAt is in the past (clock skew)', () => {
    expect(retryAfterSeconds(1_000 - 5_000, 1_000)).toBe(1);
  });

  it('floors at 1 for a 1ms-away reset', () => {
    expect(retryAfterSeconds(1_000 + 1, 1_000)).toBe(1);
  });

  it('reports 45 for a 45s-away reset', () => {
    expect(retryAfterSeconds(1_000 + 45_000, 1_000)).toBe(45);
  });

  it('rounds a sub-second remainder up to 60', () => {
    expect(retryAfterSeconds(1_000 + 59_999, 1_000)).toBe(60);
  });
});

describe('enforceRateLimit', () => {
  beforeEach(() => { resetRateLimitState(); });

  it('passes when every bucket has room', async () => {
    const verdict = await enforceRateLimit(
      [{ key: 'acct', rule: ACCOUNT }, { key: 'ip', rule: IP }],
      T0,
    );
    expect(verdict).toEqual({ limited: false });
  });

  it('reports the seconds until the exhausted window resets', async () => {
    await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0);
    await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0);
    const verdict = await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0 + 15_000);
    expect(verdict).toEqual({ limited: true, retryAfterSec: 45 });
  });

  it('never reports a retryAfterSec below 1', async () => {
    await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0);
    await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0);
    // 1ms before the window closes: ceil() of a sub-second remainder must not be 0,
    // because a `Retry-After: 0` invites an immediate retry that is still refused.
    const verdict = await enforceRateLimit([{ key: 'acct', rule: ACCOUNT }], T0 + 59_999);
    expect(verdict).toEqual({ limited: true, retryAfterSec: 1 });
  });

  it('does NOT consume from later buckets once an earlier one rejects', async () => {
    const checks = [{ key: 'acct', rule: ACCOUNT }, { key: 'shared-ip', rule: IP }];
    await enforceRateLimit(checks, T0);            // ip: 1 consumed
    await enforceRateLimit(checks, T0);            // ip: 2 consumed
    await enforceRateLimit(checks, T0);            // acct exhausted -> ip untouched
    await enforceRateLimit(checks, T0);            // acct exhausted -> ip untouched

    // If the short-circuit were missing, `shared-ip` would be at 4 rather than 2.
    // Probe it directly: 8 more tokens must remain in a limit of 10.
    for (let i = 0; i < 8; i += 1) {
      expect((await rateLimit('shared-ip', IP, T0)).success).toBe(true);
    }
    expect((await rateLimit('shared-ip', IP, T0)).success).toBe(false);
  });

  it('treats an empty check list as unlimited', async () => {
    expect(await enforceRateLimit([], T0)).toEqual({ limited: false });
  });
});

describe('enforceBaseline', () => {
  // Derived from the config, not hardcoded: this rule is deliberately tuned (100 -> 1000,
  // so a whole club behind one NAT cannot exhaust it at slot-open), and a literal here
  // would turn every future tuning into a spurious failure in a file that is not about
  // thresholds at all.
  const BASELINE = RATE_LIMITS.apiBaselinePerIp.limit;

  beforeEach(() => { resetRateLimitState(); });

  const req = (method: string, ip?: string) => ({
    method,
    headers: new Headers(ip ? { 'x-forwarded-for': ip } : {}),
  });

  it('does not consume anything for a GET', async () => {
    for (let i = 0; i < BASELINE * 2; i += 1) {
      expect(await enforceBaseline(req('GET', '203.0.113.7'), T0)).toEqual({ limited: false });
    }
  });

  it('consumes on POST and rejects past the §17 baseline', async () => {
    for (let i = 0; i < BASELINE; i += 1) {
      expect(await enforceBaseline(req('POST', '203.0.113.7'), T0)).toEqual({ limited: false });
    }
    const verdict = await enforceBaseline(req('POST', '203.0.113.7'), T0);
    expect(verdict).toEqual({ limited: true, retryAfterSec: 60 });
  });

  it('buckets by IP, so one exhausted client does not block another', async () => {
    for (let i = 0; i < BASELINE; i += 1) await enforceBaseline(req('POST', '203.0.113.7'), T0);
    expect(await enforceBaseline(req('POST', '203.0.113.7'), T0)).toMatchObject({ limited: true });
    expect(await enforceBaseline(req('POST', '198.51.100.4'), T0)).toEqual({ limited: false });
  });

  it('falls back to a single shared bucket when no IP header is present', async () => {
    for (let i = 0; i < BASELINE; i += 1) await enforceBaseline(req('POST'), T0);
    expect(await enforceBaseline(req('POST'), T0)).toMatchObject({ limited: true });
  });
});
