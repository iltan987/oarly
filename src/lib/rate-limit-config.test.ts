import { describe, expect, it } from 'vitest';

import { RATE_LIMITS } from '@/lib/rate-limit-config';

describe('RATE_LIMITS', () => {
  it('gives every rule a name matching its own object key', () => {
    // This is what stops the two from drifting apart: `storageKey` (rate-limit.ts) keys
    // storage on `rule.name`, not on the property name used to look the rule up, so a
    // typo'd or copy-pasted `name` would silently alias one rule's counter onto
    // another's without this test catching it.
    for (const [key, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.name).toBe(key);
    }
  });

  it('keeps the proxy baseline above every named per-minute per-IP rule', () => {
    // `apiBaselinePerIp` is charged in proxy.ts on EVERY non-/api POST, so it stacks on
    // top of whatever named rule the action itself applies. If it ever drops to or below a
    // named per-IP rule, IT becomes the real ceiling and the named rule's tuning silently
    // stops meaning anything — which is exactly how a 100/min baseline turned a 60/min
    // booking rule into a 60/min ceiling for a whole club.
    expect(RATE_LIMITS.apiBaselinePerIp.windowSec).toBe(RATE_LIMITS.bookingPerIp.windowSec);
    expect(RATE_LIMITS.apiBaselinePerIp.limit).toBeGreaterThan(RATE_LIMITS.bookingPerIp.limit);
    expect(RATE_LIMITS.apiBaselinePerIp.limit).toBeGreaterThan(RATE_LIMITS.localePerIp.limit);
  });

  it('leaves enough headroom between the shared per-IP booking bucket and the private per-account one', () => {
    // The premise the design rests on: a per-IP bucket is shared by an entire club behind
    // one NAT, so it must not be reachable by a plausible number of members each acting
    // within their own per-account budget. At a 6:1 ratio six members at their permitted
    // rate exhausted it. 40 members x 2 outings is the target shape, so the ratio must
    // leave room for at least 40 members' full per-minute budget.
    const ratio = RATE_LIMITS.bookingPerIp.limit / RATE_LIMITS.bookingPerAccount.limit;
    expect(ratio).toBeGreaterThanOrEqual(40);
  });
});
