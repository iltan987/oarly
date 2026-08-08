import { describe, expect, it } from 'vitest';

import { defaultPaymentFor, paymentChoicesFor } from './member-calendar';

/**
 * These two are pure, but until now they were exercised only through
 * `computeMemberCalendar` in an integration test — which `pnpm vitest run` skips.
 * Deleting the `if (!clubMultisportEnabled)` guard from either one therefore left
 * the whole fast unit loop green, on the branch whose entire point is that guard.
 */
describe('paymentChoicesFor', () => {
  it('offers cash only at a club with no MultiSport contract, whatever the boat allows', () => {
    expect(paymentChoicesFor('regular_only', false)).toEqual(['regular']);
    expect(paymentChoicesFor('both', false)).toEqual(['regular']);
    // Task 2 converts these away at write time; narrowing here is the defensive half,
    // and is what keeps a stale row from offering an unbookable choice.
    expect(paymentChoicesFor('multisport_only', false)).toEqual(['regular']);
  });

  it('follows the boat allow-list at a club that has MultiSport', () => {
    expect(paymentChoicesFor('regular_only', true)).toEqual(['regular']);
    expect(paymentChoicesFor('multisport_only', true)).toEqual(['multisport']);
    expect(paymentChoicesFor('both', true)).toEqual(['regular', 'multisport']);
  });
});

describe('defaultPaymentFor', () => {
  it('defaults to cash at a club with no MultiSport contract, ignoring the member preference', () => {
    for (const allowed of ['regular_only', 'multisport_only', 'both'] as const) {
      expect(defaultPaymentFor(allowed, 'multisport', false)).toBe('regular');
      expect(defaultPaymentFor(allowed, 'regular', false)).toBe('regular');
    }
  });

  it('honours the boat allow-list, then the member preference, at a club that has MultiSport', () => {
    expect(defaultPaymentFor('regular_only', 'multisport', true)).toBe('regular');
    expect(defaultPaymentFor('multisport_only', 'regular', true)).toBe('multisport');
    expect(defaultPaymentFor('both', 'multisport', true)).toBe('multisport');
    expect(defaultPaymentFor('both', 'regular', true)).toBe('regular');
  });

  // The picker's default must be one of the picker's options, or the form submits a
  // value the server will reject.
  it('always defaults to a payment type it also offers', () => {
    for (const allowed of ['regular_only', 'multisport_only', 'both'] as const) {
      for (const enabled of [true, false]) {
        for (const pref of ['regular', 'multisport'] as const) {
          expect(paymentChoicesFor(allowed, enabled)).toContain(defaultPaymentFor(allowed, pref, enabled));
        }
      }
    }
  });
});
