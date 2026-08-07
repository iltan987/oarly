import { beforeEach, describe, expect, it } from 'vitest';

import { rateLimit, resetRateLimitState } from '@/lib/rate-limit';
import { enforceRateLimit } from '@/lib/rate-limit-guard';

const ACCOUNT = { name: 'testAccount', limit: 2, windowSec: 60 };
const IP = { name: 'testIp', limit: 10, windowSec: 60 };
const T0 = 1_000_000;

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
