import { parseUserInput } from 'better-auth/db';
import { describe, expect, it } from 'vitest';

import { auth } from '@/auth';
import { GENDER_OPTIONS, PAYMENT_TYPES, signUpSchema } from '@/lib/schemas';

/**
 * Guards `user.additionalFields[*].validator` in `src/auth.ts`.
 *
 * `src/lib/schemas.ts` is a CLIENT mirror: `signUpSchema` runs in the browser as the sign-up
 * form's zodResolver and never on the server. The endpoints that actually write these columns
 * — `POST /api/auth/sign-up/email`, `POST /api/auth/update-user`, and the Google profile
 * mapping — are Better Auth's own handlers, which never import that file. So a `.max()` there
 * bounds nothing on the server, and `first_name`/`last_name`/`phone` are `text` columns with
 * no width of their own.
 *
 * These tests drive the REAL `parseUserInput` from the installed package against the REAL
 * `auth.options` — the same function better-auth calls from `sign-up.mjs:164` and
 * `update-user.mjs:54` — so they fail if a `validator` is removed, emptied, or widened.
 *
 * `'update'` rather than `'create'` for most cases because that is the `/update-user` path and
 * it does not also demand every required core user field; one `'create'` case covers sign-up.
 */
const FIELD_BOUNDS = [
  ['firstName', 80],
  ['lastName', 80],
  ['phone', 40],
] as const;

function accepts(field: string, value: unknown, action: 'create' | 'update' = 'update'): boolean {
  try {
    parseUserInput(auth.options, { [field]: value }, action);
    return true;
  } catch {
    return false;
  }
}

describe('auth user.additionalFields validators', () => {
  it.each(FIELD_BOUNDS)('bounds %s at %i characters on /update-user', (field, max) => {
    expect(accepts(field, 'x'.repeat(max))).toBe(true);
    expect(accepts(field, 'x'.repeat(max + 1))).toBe(false);
  });

  // The sign-up door, which is the one `signUpSchema` visibly guards and does not actually own.
  it('bounds the same fields on sign-up, not only on update', () => {
    const base = { name: 'Ada Lovelace', email: 'ada@example.com' };
    expect(() => parseUserInput(auth.options, { ...base, firstName: 'x'.repeat(80) }, 'create')).not.toThrow();
    expect(() => parseUserInput(auth.options, { ...base, firstName: 'x'.repeat(81) }, 'create')).toThrow();
  });

  /**
   * The anti-drift pin between the two copies. `src/auth.ts` cannot `.pick()` from
   * `signUpSchema` the way `accountProfileSchema` does, so this compares them by BEHAVIOUR at
   * the boundary rather than by reading either number: change one side alone and the two
   * disagree at exactly one length.
   */
  it.each(FIELD_BOUNDS)('agrees with signUpSchema about %s at every boundary length', (field, max) => {
    const other = { firstName: 'A', lastName: 'B', phone: '5551112233', email: 'a@b.co', password: 'longenough', consent: true as const };
    for (const len of [1, max - 1, max, max + 1, max + 50]) {
      const value = 'x'.repeat(len);
      expect({ len, viaBetterAuth: accepts(field, value) }).toEqual({
        len,
        viaBetterAuth: signUpSchema.safeParse({ ...other, [field]: value }).success,
      });
    }
  });

  /**
   * `gender` is special-category-adjacent and its column is plain `text`, so before this a
   * crafted `/update-user` could store any string at all in it. NULL stays writable: it is how
   * "never answered" is represented, and it is not the same fact as `prefer_not_to_say`.
   */
  it.each(GENDER_OPTIONS)('accepts the offered gender %s', (gender) => {
    expect(accepts('gender', gender)).toBe(true);
  });
  it('accepts a null gender and refuses anything outside the offered answers', () => {
    expect(accepts('gender', null)).toBe(true);
    expect(accepts('gender', 'yes')).toBe(false);
    expect(accepts('gender', '')).toBe(false);
  });

  // `default_payment_type` is a pg ENUM, so an unpinned string reaches Postgres as 22P02 —
  // a 500 out of an auth endpoint rather than a refusal.
  it.each(PAYMENT_TYPES)('accepts the payment type %s', (paymentType) => {
    expect(accepts('defaultPaymentType', paymentType)).toBe(true);
  });
  it('refuses a payment type outside the pg enum', () => {
    expect(accepts('defaultPaymentType', 'invoice')).toBe(false);
  });
});
