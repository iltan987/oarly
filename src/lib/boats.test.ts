import { describe, expect, it } from 'vitest';

import { clampAllowedPayment } from './boats';

describe('clampAllowedPayment', () => {
  it('leaves every value alone while the club still has MultiSport', () => {
    for (const allowedPayment of ['regular_only', 'multisport_only', 'both'] as const) {
      expect(clampAllowedPayment({ allowedPayment }, true)).toEqual({ allowedPayment });
    }
  });

  // The stranded-boat state spec §5.2 exists to prevent: `multisport_only` at a club
  // with no MultiSport contract has no valid payment type left, so the boat silently
  // stops being bookable. The boat editor hides the field, but `allowedPayment` still
  // arrives from FormData — this is the server-side half of that invariant.
  it('coerces multisport_only to regular_only at a club with MultiSport off', () => {
    expect(clampAllowedPayment({ allowedPayment: 'multisport_only' }, false)).toEqual({ allowedPayment: 'regular_only' });
  });

  // `both` already permits cash, so it is not stranded. Rewriting it would destroy a
  // setting the owner was never shown — the same defect the boat editor's hidden
  // input had.
  it('leaves both and regular_only alone at a club with MultiSport off', () => {
    expect(clampAllowedPayment({ allowedPayment: 'both' }, false)).toEqual({ allowedPayment: 'both' });
    expect(clampAllowedPayment({ allowedPayment: 'regular_only' }, false)).toEqual({ allowedPayment: 'regular_only' });
  });

  it('carries the rest of the boat input through untouched', () => {
    const input = { name: 'Quad', seats: 4, minSkillLevelId: null, minAttendance: 2, allowedPayment: 'multisport_only' as const };
    expect(clampAllowedPayment(input, false)).toEqual({ ...input, allowedPayment: 'regular_only' });
  });
});
