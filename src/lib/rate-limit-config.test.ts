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
});
