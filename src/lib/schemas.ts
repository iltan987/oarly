import * as z from 'zod';

import { isDateISO } from '@/lib/date-iso';

// --- auth (client-side UX; Better Auth is the server authority) ---
export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export const signUpSchema = z.object({
  /*
   * The `.max()`es are the ONLY width these three values have anywhere. `first_name`,
   * `last_name` and `phone` are all `text` in `src/db/schema/auth.ts` — Postgres imposes
   * no limit on `text`, and Better Auth passes an additionalField straight through — so
   * without these a sign-up or an `/account` save would persist a value of any size.
   *
   * The numbers are taken, not invented, and no column width contradicts them (`text`
   * has none):
   *  - 80 for the two names: the `maxLength` the `/account` inputs already render
   *    (`app/account/account-form.tsx`), and this file's own width for a human-typed
   *    name or handle (`clubRequestSchema.name`, `socialSchema.handle`).
   *  - 40 for the phone: again the rendered `maxLength` on `/account`, and the width
   *    this file already gives the other phone number it validates
   *    (`clubProfileSchema.phone`, whose `clubs.phone` column is `text` too).
   *
   * `accountProfileSchema` PICKS these three rather than restating them, so the bound
   * added here is the bound `/account` enforces — see its doc comment below.
   */
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: z.string().min(1).max(40),
  email: z.email(),
  password: z.string().min(8),
  consent: z.literal(true), // KVKK gate — must be explicitly true
});

/**
 * The four answers offered for `gender`, in render order — the account form iterates this
 * rather than repeating the literals, so the option list and the schema cannot disagree.
 * `''` ("not set") is deliberately NOT one of them: see `accountProfileSchema` below.
 */
export const GENDER_OPTIONS = ['female', 'male', 'other', 'prefer_not_to_say'] as const;

/**
 * `payment_type`'s values, restated for the browser. See `accountProfileSchema`'s note on
 * why this is not imported from `@/db/schema/enums`; `schemas.test.ts` pins it to
 * `paymentTypeEnum.enumValues`.
 */
export const PAYMENT_TYPES = ['regular', 'multisport'] as const;

/**
 * The `/account` profile form — the only way any of these six columns is ever edited
 * after sign-up.
 *
 * `firstName` / `lastName` / `phone` are PICKED from `signUpSchema`, not restated. That
 * is the anti-drift mechanism: the same three values are collected at sign-up and edited
 * here, so if `phone` ever gains a format rule there, this inherits it with no edit.
 *
 * `birthday` and `gender` were never collected at sign-up, so EVERY existing row has them
 * NULL. `''` is how the form says "not set", and the action maps it to NULL — which keeps
 * "never answered" distinguishable from an explicit `prefer_not_to_say`. Fabricating a
 * value for a special-category-adjacent field would be wrong under KVKK, so there is no
 * default here and none in the UI.
 *
 * `refine(isDateISO)` rather than a shape regex, for the reason `dateOverrideSchema` gives:
 * `2026-02-31` matches `/^\d{4}-\d{2}-\d{2}$/`, is not a date, and reaches a `date` column
 * as 22008 — a 500 out of the action instead of the refusal the contract promises.
 *
 * `defaultPaymentType`'s literals are RESTATED, not imported from `paymentTypeEnum`. This
 * module is imported by client components (`app/(auth)/sign-up/sign-up-form.tsx`), and
 * `@/db/schema/enums` would pull `drizzle-orm/pg-core` into the browser bundle.
 * `schemas.test.ts` asserts these two equal `paymentTypeEnum.enumValues`, server-side, so
 * the copy cannot drift from the pg enum.
 */
export const accountProfileSchema = signUpSchema
  .pick({ firstName: true, lastName: true, phone: true })
  .extend({
    birthday: z.union([z.string().refine(isDateISO, 'YYYY-MM-DD'), z.literal('')]),
    gender: z.union([z.enum(GENDER_OPTIONS), z.literal('')]),
    defaultPaymentType: z.enum(PAYMENT_TYPES),
  });

export type AccountProfileInput = z.infer<typeof accountProfileSchema>;

export const forgotPasswordSchema = z.object({ email: z.email() });
export const resetPasswordSchema = z.object({ newPassword: z.string().min(8) });

// --- club forms (client UX mirror; server action re-parses these,
//     and pure-core enforces reserved/taken slug + owner existence) ---
export const clubRequestSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().min(3).max(40),
});
export const createClubSchema = clubRequestSchema.extend({
  ownerEmail: z.email(),
});

// --- club config (Plan 4): server actions re-parse these; pure-core adds the
//     cross-club FK checks the schema cannot express (e.g. skill level belongs
//     to the same club). ---
const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'invalid hex');

export const clubProfileSchema = z.object({
  name: z.string().min(2).max(80),
  tagline: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  phone: z.string().max(40).optional(),
  brandAccent: hexColor.optional(),
  headingFont: z.enum(['default', 'premium']).default('default'),
  logoUrl: z.union([z.url(), z.literal('')]).optional(),
});

// Logo persists on upload/remove via /api/club-logo/save (not the profile form),
// so it sticks immediately. Empty string clears the logo.
export const logoSaveSchema = z.object({
  slug: z.string().min(1),
  url: z.union([z.url(), z.literal('')]),
});

export const skillLevelNameSchema = z.object({ name: z.string().min(1).max(40) });

export const socialSchema = z.object({
  platform: z.string().min(1).max(40),
  handle: z.string().min(1).max(80),
});

export const boatSchema = z
  .object({
    name: z.string().min(1).max(60),
    seats: z.coerce.number().int().min(1).max(16),
    minSkillLevelId: z.uuid().nullable().default(null),
    allowedPayment: z.enum(['regular_only', 'multisport_only', 'both']),
    minAttendance: z.coerce.number().int().min(1).nullable().default(null),
  })
  .refine((v) => v.minAttendance === null || v.minAttendance <= v.seats, {
    message: 'min_attendance must be <= seats',
    path: ['minAttendance'],
  });

// --- scheduling config (5A): server actions re-parse these; pure-core adds the
//     cross-row checks (window overlap, even tiling, same-club/active boats,
//     lead-days rule) that zod cannot express. ---
export const windowBoatSchema = z.object({
  boatTypeId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(99),
});

export const windowSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'),
  defaultSessionMinutes: z.coerce.number().int().min(5).max(1440),
  boats: z.array(windowBoatSchema).min(1),
});

export const schedulingSettingsSchema = z
  .object({
    bookingOpenMode: z.enum(['always', 'lead']),
    bookingOpenLeadDays: z.coerce.number().int().min(1).max(365).nullable(),
    selfCancelEnabled: z.boolean(),
    cancelCutoffHours: z.coerce.number().int().min(0).max(720).nullable(),
    noshowPenalty: z.enum(['off', '2d', '1w', '2w', '1m', 'never']),
    multisportMode: z.enum(['equal', 'priority']),
    multisportEnabled: z.boolean(),
    openOnHolidays: z.boolean(),
    waitlistCapacity: z.coerce.number().int().min(0).max(999).nullable(),
  })
  .refine((v) => v.bookingOpenMode !== 'lead' || v.bookingOpenLeadDays !== null, {
    message: 'lead mode requires lead days',
    path: ['bookingOpenLeadDays'],
  });

export const dateOverrideSchema = z.object({
  // `refine(isDateISO)` and not a bare shape regex: the value is bound into a `date`
  // column, and `2026-02-31` matches the regex, is not a date, and raises 22008.
  dateISO: z.string().refine(isDateISO, 'YYYY-MM-DD'),
  isOpen: z.boolean(),
});
