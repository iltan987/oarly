import { describe, it, expect } from 'vitest';
import { signUpSchema, createClubSchema } from './schemas';

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
