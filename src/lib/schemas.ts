import * as z from 'zod';

// --- auth (client-side UX; Better Auth is the server authority) ---
export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export const signUpSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(1),
  email: z.email(),
  password: z.string().min(8),
  consent: z.literal(true), // KVKK gate — must be explicitly true
});
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
    openOnHolidays: z.boolean(),
  })
  .refine((v) => v.bookingOpenMode !== 'lead' || v.bookingOpenLeadDays !== null, {
    message: 'lead mode requires lead days',
    path: ['bookingOpenLeadDays'],
  });
