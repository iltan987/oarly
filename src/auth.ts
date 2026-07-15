import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email';
import { env } from '@/env';

const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Oarly — Şifre sıfırlama / Reset your password',
        text: `Şifrenizi sıfırlamak için tıklayın / Reset your password: ${url}`,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Oarly — E-posta doğrulama / Verify your email',
        text: `E-postanızı doğrulamak için tıklayın / Verify your email: ${url}`,
      });
    },
  },

  ...(googleEnabled
    ? {
        socialProviders: {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            mapProfileToUser: (profile: { given_name?: string; family_name?: string }) => ({
              firstName: profile.given_name,
              lastName: profile.family_name,
            }),
          },
        },
      }
    : {}),

  user: {
    additionalFields: {
      firstName: { type: 'string', required: false },
      lastName: { type: 'string', required: false },
      phone: { type: 'string', required: false },
      birthday: { type: 'date', required: false },
      gender: { type: 'string', required: false },
      defaultPaymentType: { type: 'string', required: false, defaultValue: 'regular' },
      locale: { type: 'string', required: false, defaultValue: 'tr' },
      theme: { type: 'string', required: false, defaultValue: 'system' },
      isAdmin: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
  },

  advanced: env.COOKIE_DOMAIN
    ? { crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } }
    : {},

  trustedOrigins: env.TRUSTED_ORIGINS,

  // Built-in per-endpoint limiter (our own limiter — Task 15 — covers app routes).
  rateLimit: { enabled: true, window: 60, max: 100 },

  plugins: [nextCookies()], // MUST be last
});
