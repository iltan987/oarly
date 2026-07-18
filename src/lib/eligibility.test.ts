import { describe, expect, it } from 'vitest';

import { checkEligibility } from './eligibility';

const base = {
  membershipStatus: 'approved' as const,
  bannedUntil: null as Date | null,
  memberSkillRank: null as number | null,
  boatMinSkillRank: null as number | null,
  boatAllowedPayment: 'both' as const,
  paymentType: 'regular' as const,
  now: new Date('2026-07-17T00:00:00Z'),
};

describe('checkEligibility', () => {
  it('passes when approved, no skill min, payment allowed', () => {
    expect(checkEligibility(base)).toEqual({ ok: true });
  });

  it('rejects a non-approved membership', () => {
    expect(checkEligibility({ ...base, membershipStatus: 'pending' })).toEqual({ ok: false, reason: 'not_approved' });
    expect(checkEligibility({ ...base, membershipStatus: null })).toEqual({ ok: false, reason: 'not_approved' });
  });

  it('rejects while a ban is active but passes once it has lapsed', () => {
    expect(checkEligibility({ ...base, bannedUntil: new Date('2026-07-18T00:00:00Z') })).toEqual({ ok: false, reason: 'banned' });
    expect(checkEligibility({ ...base, bannedUntil: new Date('2026-07-16T00:00:00Z') })).toEqual({ ok: true });
  });

  it('rejects when the member rank is below the boat minimum or unset', () => {
    expect(checkEligibility({ ...base, boatMinSkillRank: 2, memberSkillRank: 1 })).toEqual({ ok: false, reason: 'skill_too_low' });
    expect(checkEligibility({ ...base, boatMinSkillRank: 2, memberSkillRank: null })).toEqual({ ok: false, reason: 'skill_too_low' });
    expect(checkEligibility({ ...base, boatMinSkillRank: 2, memberSkillRank: 2 })).toEqual({ ok: true });
    expect(checkEligibility({ ...base, boatMinSkillRank: 2, memberSkillRank: 3 })).toEqual({ ok: true });
  });

  it('enforces payment allow-list', () => {
    expect(checkEligibility({ ...base, boatAllowedPayment: 'regular_only', paymentType: 'multisport' })).toEqual({ ok: false, reason: 'payment_not_allowed' });
    expect(checkEligibility({ ...base, boatAllowedPayment: 'multisport_only', paymentType: 'regular' })).toEqual({ ok: false, reason: 'payment_not_allowed' });
    expect(checkEligibility({ ...base, boatAllowedPayment: 'multisport_only', paymentType: 'multisport' })).toEqual({ ok: true });
  });

  it('applies rules in order: membership before skill', () => {
    expect(checkEligibility({ ...base, membershipStatus: 'banned', boatMinSkillRank: 9, memberSkillRank: 0 })).toEqual({ ok: false, reason: 'not_approved' });
  });
});
