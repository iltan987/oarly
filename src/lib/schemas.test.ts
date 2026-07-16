import { describe, expect, it } from 'vitest';

import { boatSchema, clubProfileSchema, createClubSchema, signUpSchema, skillLevelNameSchema, socialSchema } from './schemas';

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
