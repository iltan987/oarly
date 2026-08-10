import { describe, expect, it } from 'vitest';

import { paymentTypeEnum } from '@/db/schema/enums';

import { accountProfileSchema, boatSchema, clubProfileSchema, createClubSchema, dateOverrideSchema, GENDER_OPTIONS, PAYMENT_TYPES, schedulingSettingsSchema, signUpSchema, skillLevelNameSchema, socialSchema, windowBoatSchema, windowSchema } from './schemas';

describe('schemas', () => {
  it('signUpSchema requires consent === true and an 8+ char password', () => {
    const base = { firstName: 'A', lastName: 'B', phone: '5551112233', email: 'a@b.co', password: 'longenough' };
    expect(signUpSchema.safeParse({ ...base, consent: true }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, consent: true, password: 'short' }).success).toBe(false);
  });
  /**
   * `first_name`, `last_name` and `phone` are `text` columns, so these `.max()`es are the
   * only width these values have. Asserted at the bound AND one over it: a `.max(80)`
   * lost in a refactor still passes an "accepts 80" assertion on its own.
   */
  it.each([['firstName', 80], ['lastName', 80], ['phone', 40]] as const)(
    'signUpSchema bounds %s at %i characters', (field, max) => {
      const base = { firstName: 'A', lastName: 'B', phone: '5551112233', email: 'a@b.co', password: 'longenough', consent: true as const };
      expect(signUpSchema.safeParse({ ...base, [field]: 'x'.repeat(max) }).success).toBe(true);
      expect(signUpSchema.safeParse({ ...base, [field]: 'x'.repeat(max + 1) }).success).toBe(false);
    },
  );
  it('createClubSchema validates name/slug length and owner email', () => {
    expect(createClubSchema.safeParse({ name: 'Boğaziçi', slug: 'bogazici', ownerEmail: 'o@c.co' }).success).toBe(true);
    expect(createClubSchema.safeParse({ name: 'x', slug: 'bogazici', ownerEmail: 'o@c.co' }).success).toBe(false);
    expect(createClubSchema.safeParse({ name: 'Boğaziçi', slug: 'bogazici', ownerEmail: 'nope' }).success).toBe(false);
  });
});

describe('accountProfileSchema', () => {
  const base = {
    firstName: 'İltan', lastName: 'Caner', phone: '5551112233',
    birthday: '1990-04-17', gender: 'male' as const, defaultPaymentType: 'regular' as const,
  };

  /**
   * The reason `PAYMENT_TYPES` is allowed to be a second copy of the pg enum at all.
   * `src/lib/schemas.ts` is imported by client components, so importing
   * `@/db/schema/enums` there would pull `drizzle-orm/pg-core` into the browser bundle;
   * this test is the thing that stops the copy from drifting. Order is asserted too —
   * the form renders the radio options in this order.
   */
  it('keeps PAYMENT_TYPES identical to the payment_type pg enum', () => {
    expect([...PAYMENT_TYPES]).toEqual([...paymentTypeEnum.enumValues]);
  });

  it('accepts a fully filled profile', () => {
    const r = accountProfileSchema.safeParse(base);
    expect(r).toMatchObject({ success: true, data: base });
  });

  /**
   * `birthday` and `gender` are nullable and were NEVER collected at sign-up, so '' has to
   * parse: it is how the form says "not set", and the action turns it into NULL. Asserting
   * the parsed VALUE, not just `success` — a schema that silently coerced '' to some
   * default would still report success and would destroy the unset/answered distinction.
   */
  it("accepts '' for birthday and gender and preserves it as ''", () => {
    const r = accountProfileSchema.safeParse({ ...base, birthday: '', gender: '' });
    expect(r).toMatchObject({ success: true, data: { birthday: '', gender: '' } });
  });

  // '' must NOT be a way through for defaultPaymentType: the column is NOT NULL and
  // always has a real value, so the UI never offers "not set" for it either.
  it("rejects '' for defaultPaymentType, which is NOT NULL", () => {
    expect(accountProfileSchema.safeParse({ ...base, defaultPaymentType: '' }).success).toBe(false);
  });

  // Shape is not validity: these match /^\d{4}-\d{2}-\d{2}$/ and reach the `date` column
  // as 22008, escaping the action to the error boundary. Same class as dateOverrideSchema.
  it.each(['2026-02-31', '2026-13-45', '1900-02-29', '17/04/1990', '1990-4-7'])(
    'rejects the malformed birthday %s', (birthday) => {
      expect(accountProfileSchema.safeParse({ ...base, birthday }).success).toBe(false);
    },
  );
  it('still accepts a real leap-day birthday', () => {
    expect(accountProfileSchema.safeParse({ ...base, birthday: '2024-02-29' }).success).toBe(true);
  });

  it('rejects a gender outside the four offered answers', () => {
    expect(accountProfileSchema.safeParse({ ...base, gender: 'yes' }).success).toBe(false);
    expect(GENDER_OPTIONS).toEqual(['female', 'male', 'other', 'prefer_not_to_say']);
  });
  it.each(GENDER_OPTIONS)('accepts the offered gender %s', (gender) => {
    expect(accountProfileSchema.safeParse({ ...base, gender }).success).toBe(true);
  });

  /**
   * The `.pick()` is live in both directions, and both halves matter:
   *  - the three picked rules still apply here (an empty name/phone is refused), so the
   *    account form cannot blank out what sign-up required; and
   *  - the fields NOT picked are absent, so this never demands an `email`, `password` or
   *    `consent` that the account form does not and must not submit.
   */
  it.each(['firstName', 'lastName', 'phone'])('inherits signUpSchema\'s rule for %s', (field) => {
    expect(accountProfileSchema.safeParse({ ...base, [field]: '' }).success).toBe(false);
  });

  /**
   * The upper bound half of the same inheritance, at the bound and one over it. This is
   * about the `.pick()` and not about the numbers: a restated `z.string().min(1).max(80)`
   * here would satisfy these three cases, so the identity assertion below is the one that
   * would actually fail — `.pick()` reuses the very field schema object, a restatement
   * cannot.
   */
  it.each([['firstName', 80], ['lastName', 80], ['phone', 40]] as const)(
    'inherits signUpSchema\'s bound for %s at %i characters', (field, max) => {
      expect(accountProfileSchema.safeParse({ ...base, [field]: 'x'.repeat(max) }).success).toBe(true);
      expect(accountProfileSchema.safeParse({ ...base, [field]: 'x'.repeat(max + 1) }).success).toBe(false);
    },
  );
  it.each(['firstName', 'lastName', 'phone'] as const)(
    'takes %s from signUpSchema by reference, not by restating it', (field) => {
      expect(accountProfileSchema.shape[field]).toBe(signUpSchema.shape[field]);
    },
  );
  it('does not carry email, password or consent across from signUpSchema', () => {
    expect(accountProfileSchema.safeParse(base).success).toBe(true);
    expect(Object.keys(accountProfileSchema.shape).sort()).toEqual(
      ['birthday', 'defaultPaymentType', 'firstName', 'gender', 'lastName', 'phone'],
    );
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
  const base = { bookingOpenMode: 'always', bookingOpenLeadDays: null, selfCancelEnabled: true, cancelCutoffHours: null, noshowPenalty: 'off', multisportMode: 'equal', multisportEnabled: true, openOnHolidays: false, waitlistCapacity: null } as const;
  it('accepts always mode with null lead days', () => {
    expect(schedulingSettingsSchema.safeParse(base).success).toBe(true);
  });
  it('accepts lead mode with a positive lead-days count', () => {
    expect(schedulingSettingsSchema.safeParse({ ...base, bookingOpenMode: 'lead', bookingOpenLeadDays: '3' }).success).toBe(true);
  });
  it('rejects lead mode with null lead days', () => {
    expect(schedulingSettingsSchema.safeParse({ ...base, bookingOpenMode: 'lead', bookingOpenLeadDays: null }).success).toBe(false);
  });
  it('accepts a waitlist capacity and treats it as optional', () => {
    expect(schedulingSettingsSchema.safeParse({ ...base, waitlistCapacity: 4 }).success).toBe(true);
    expect(schedulingSettingsSchema.safeParse({ ...base, waitlistCapacity: null }).success).toBe(true);
    expect(schedulingSettingsSchema.safeParse({ ...base, waitlistCapacity: 0 }).success).toBe(true);
  });
  it('rejects a negative or absurd waitlist capacity', () => {
    expect(schedulingSettingsSchema.safeParse({ ...base, waitlistCapacity: -1 }).success).toBe(false);
    expect(schedulingSettingsSchema.safeParse({ ...base, waitlistCapacity: 1000 }).success).toBe(false);
  });
});

describe('dateOverrideSchema', () => {
  it('accepts a valid ISO date and boolean', () => {
    expect(dateOverrideSchema.safeParse({ dateISO: '2026-07-20', isOpen: true }).success).toBe(true);
  });
  it('rejects a malformed date', () => {
    expect(dateOverrideSchema.safeParse({ dateISO: '2026/07/20', isOpen: true }).success).toBe(false);
  });
  it('rejects a non-boolean isOpen', () => {
    expect(dateOverrideSchema.safeParse({ dateISO: '2026-07-20', isOpen: 'yes' }).success).toBe(false);
  });
  // Shape is not validity. These match /^\d{4}-\d{2}-\d{2}$/ and reach a `date`
  // column as `date/time field value out of range` (22008), which escapes the action
  // to the error boundary instead of returning the refusal the contract promises.
  it.each(['2026-02-31', '2026-13-45', '2026-04-31', '1900-02-29', '2026-01-00'])(
    'rejects the well-shaped non-date %s', (dateISO) => {
      expect(dateOverrideSchema.safeParse({ dateISO, isOpen: true }).success).toBe(false);
    },
  );
  it('still accepts a real leap day', () => {
    expect(dateOverrideSchema.safeParse({ dateISO: '2024-02-29', isOpen: true }).success).toBe(true);
  });
});
