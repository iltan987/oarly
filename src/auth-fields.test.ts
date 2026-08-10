import { parseUserInput } from 'better-auth/db';
import { describe, expect, it } from 'vitest';

import { auth } from '@/auth';
import { locales } from '@/i18n/config';
import { GENDER_OPTIONS, PAYMENT_TYPES, signUpSchema } from '@/lib/schemas';
import { THEMES } from '@/lib/theme';

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

  /**
   * `birthday` is the door coercion does NOT close. `/update-user` types its body as
   * `z.record(z.string(), z.any())`, and better-auth's only date handling is
   * `new Date(value)` in a `try` — which never throws for garbage, because `new Date('banana')`
   * returns Invalid Date. That Invalid Date reaches node-postgres (drizzle's `PgDateString`
   * has no `mapToDriverValue`) and serialises to `0NaN-NaN-NaN…`, i.e. a Postgres 22007 and a
   * 500 out of an auth endpoint.
   *
   * `2026-02-31` is in the rejected set for the reason `dateOverrideSchema` gives: it matches
   * `/^\d{4}-\d{2}-\d{2}$/`, is not a date, and lands as 22008 rather than as a refusal.
   */
  it.each(['1990-04-17', '2024-02-29'])('accepts the real date %s', (birthday) => {
    expect(accepts('birthday', birthday)).toBe(true);
  });
  it('accepts a Date and a null birthday', () => {
    expect(accepts('birthday', new Date('1990-04-17'))).toBe(true);
    expect(accepts('birthday', null)).toBe(true);
  });
  it.each(['banana', '2026-02-31', '2026-13-45', '17/04/1990', '1990-4-7', ''])(
    'refuses the non-date birthday %s', (birthday) => {
      expect(accepts('birthday', birthday)).toBe(false);
    },
  );

  // `default_payment_type` is a pg ENUM, so an unpinned string reaches Postgres as 22P02 —
  // a 500 out of an auth endpoint rather than a refusal.
  it.each(PAYMENT_TYPES)('accepts the payment type %s', (paymentType) => {
    expect(accepts('defaultPaymentType', paymentType)).toBe(true);
  });
  it('refuses a payment type outside the pg enum', () => {
    expect(accepts('defaultPaymentType', 'invoice')).toBe(false);
  });

  /**
   * `locale` and `theme` are the two fields the block above argued about and then left
   * unbound. Both columns are `text NOT NULL`, so `/update-user` took any string of any
   * length in either — no `.nullable()` case to cover, because NULL is not a value they
   * can hold.
   *
   * The sets are asserted from the app's own constants rather than restated here, so
   * adding a locale (or a fourth theme) cannot leave this file testing a stale list. The
   * REFUSALS are the half that would otherwise be vacuous: `'de'` and `'sepia'` are
   * plausible near-misses, and the long string is the unbounded-write shape itself.
   */
  it.each(locales)('accepts the supported locale %s', (locale) => {
    expect(accepts('locale', locale)).toBe(true);
  });
  it.each(THEMES)('accepts the offered theme %s', (theme) => {
    expect(accepts('theme', theme)).toBe(true);
  });
  it('refuses a locale or theme the app does not have, at any length', () => {
    expect(accepts('locale', 'de')).toBe(false);
    expect(accepts('locale', 'x'.repeat(5000))).toBe(false);
    expect(accepts('theme', 'sepia')).toBe(false);
    expect(accepts('theme', 'x'.repeat(5000))).toBe(false);
    // Empty is the one a `.max()`-only bound would have let through.
    expect(accepts('locale', '')).toBe(false);
    expect(accepts('theme', '')).toBe(false);
  });
});
