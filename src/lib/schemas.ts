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
