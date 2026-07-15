import { describe, it, expect } from 'vitest';
import {
  paymentTypeEnum,
  noshowPenaltyEnum,
  bookingStatusEnum,
  allowedPaymentEnum,
} from '@/db/schema/enums';

describe('enums', () => {
  it('payment types are regular|multisport', () => {
    expect(paymentTypeEnum.enumValues).toEqual(['regular', 'multisport']);
  });
  it('no-show penalties match the spec', () => {
    expect(noshowPenaltyEnum.enumValues).toEqual(['off', '2d', '1w', '2w', '1m', 'never']);
  });
  it('booking statuses include waitlisted and attendance outcomes', () => {
    expect(bookingStatusEnum.enumValues).toEqual([
      'booked', 'waitlisted', 'cancelled', 'no_show', 'attended',
    ]);
  });
  it('allowed payment expresses boat eligibility', () => {
    expect(allowedPaymentEnum.enumValues).toEqual(['regular_only', 'multisport_only', 'both']);
  });
});
