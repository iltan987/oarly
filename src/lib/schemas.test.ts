import { describe, expect, it } from 'vitest';

import { boatSchema, clubProfileSchema, createClubSchema, schedulingSettingsSchema, signUpSchema, skillLevelNameSchema, socialSchema, windowBoatSchema, windowSchema } from './schemas';

describe('schemas', () => {
  it('signUpSchema requires consent === true and an 8+ char password', () => {
    const base = { firstName: 'A', lastName: 'B', phone: '5551112233', email: 'a@b.co', password: 'longenough' };
    expect(signUpSchema.safeParse({ ...base, consent: true }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, consent: true, password: 'short' }).success).toBe(false);
  });
  it('createClubSchema validates name/slug length and owner email', () => {
    expect(createClubSchema.safeParse({ name: 'Boğaziçi', slug: 'bogazici', ownerEmail: 'o@c.co' }).success).toBe(true);
    expect(createClubSchema.safeParse({ name: 'x', slug: 'bogazici', ownerEmail: 'o@c.co' }).success).toBe(false);
    expect(createClubSchema.safeParse({ name: 'Boğaziçi', slug: 'bogazici', ownerEmail: 'nope' }).success).toBe(false);
  });
});

describe('clubProfileSchema', () => {
  it('accepts a valid profile', () => {
    expect(clubProfileSchema.safeParse({ name: 'Bebek', brandAccent: '#0E9E93', headingFont: 'default' }).success).toBe(true);
  });
  it('rejects a bad hex accent', () => {
    expect(clubProfileSchema.safeParse({ name: 'Bebek', brandAccent: 'teal' }).success).toBe(false);
  });
  it('rejects a too-short name', () => {
    expect(clubProfileSchema.safeParse({ name: 'B' }).success).toBe(false);
  });
});

describe('skillLevelNameSchema', () => {
  it('accepts a name, rejects empty', () => {
    expect(skillLevelNameSchema.safeParse({ name: 'Başlangıç' }).success).toBe(true);
    expect(skillLevelNameSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('socialSchema', () => {
  it('requires platform and handle', () => {
    expect(socialSchema.safeParse({ platform: 'instagram', handle: 'bebekrowing' }).success).toBe(true);
    expect(socialSchema.safeParse({ platform: '', handle: 'x' }).success).toBe(false);
  });
});

describe('boatSchema', () => {
  it('accepts a valid boat', () => {
    expect(boatSchema.safeParse({ name: 'Quad', seats: 4, allowedPayment: 'both' }).success).toBe(true);
  });
  it('rejects seats < 1', () => {
    expect(boatSchema.safeParse({ name: 'Quad', seats: 0, allowedPayment: 'both' }).success).toBe(false);
  });
  it('rejects minAttendance greater than seats', () => {
    expect(boatSchema.safeParse({ name: 'Double', seats: 2, allowedPayment: 'both', minAttendance: 3 }).success).toBe(false);
  });
  it('rejects a non-uuid minSkillLevelId', () => {
    expect(boatSchema.safeParse({ name: 'Quad', seats: 4, allowedPayment: 'both', minSkillLevelId: 'nope' }).success).toBe(false);
  });
});

describe('windowBoatSchema', () => {
  it('accepts a valid boat row and coerces quantity', () => {
    const r = windowBoatSchema.safeParse({ boatTypeId: '11111111-1111-1111-8111-111111111111', quantity: '2' });
    expect(r.success).toBe(true);
    // eslint-disable-next-line vitest/no-conditional-expect
    if (r.success) expect(r.data.quantity).toBe(2);
  });
  it('rejects quantity < 1', () => {
    expect(windowBoatSchema.safeParse({ boatTypeId: '11111111-1111-1111-8111-111111111111', quantity: 0 }).success).toBe(false);
  });
  it('rejects a non-uuid boatTypeId', () => {
    expect(windowBoatSchema.safeParse({ boatTypeId: 'nope', quantity: 1 }).success).toBe(false);
  });
});

describe('windowSchema', () => {
  const boat = { boatTypeId: '11111111-1111-1111-8111-111111111111', quantity: 1 };
  it('accepts a valid window and coerces weekday/minutes', () => {
    const r = windowSchema.safeParse({ weekday: '1', startTime: '08:00', endTime: '11:00', defaultSessionMinutes: '60', boats: [boat] });
    expect(r.success).toBe(true);
    // eslint-disable-next-line vitest/no-conditional-expect
    if (r.success) { expect(r.data.weekday).toBe(1); expect(r.data.defaultSessionMinutes).toBe(60); }
  });
  it('rejects an out-of-range weekday', () => {
    expect(windowSchema.safeParse({ weekday: 7, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [boat] }).success).toBe(false);
  });
  it('rejects a malformed time', () => {
    expect(windowSchema.safeParse({ weekday: 1, startTime: '8am', endTime: '11:00', defaultSessionMinutes: 60, boats: [boat] }).success).toBe(false);
  });
  it('rejects an empty boats array', () => {
    expect(windowSchema.safeParse({ weekday: 1, startTime: '08:00', endTime: '11:00', defaultSessionMinutes: 60, boats: [] }).success).toBe(false);
  });
});

describe('schedulingSettingsSchema', () => {
  const base = { bookingOpenMode: 'always', bookingOpenLeadDays: null, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', openOnHolidays: false } as const;
  it('accepts always mode with null lead days', () => {
    expect(schedulingSettingsSchema.safeParse(base).success).toBe(true);
  });
  it('accepts lead mode with a positive lead-days count', () => {
    expect(schedulingSettingsSchema.safeParse({ ...base, bookingOpenMode: 'lead', bookingOpenLeadDays: '3' }).success).toBe(true);
  });
  it('rejects lead mode with null lead days', () => {
    expect(schedulingSettingsSchema.safeParse({ ...base, bookingOpenMode: 'lead', bookingOpenLeadDays: null }).success).toBe(false);
  });
});
