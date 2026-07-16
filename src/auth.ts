import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { renderResetEmail, renderVerifyEmail } from '@/emails';
import { sendEmail } from '@/lib/email';
import { env, trustedOrigins } from '@/env';

/** Better Auth doesn't type our `locale` additionalField on the user object. */
function userLocale(user: object): 'tr' | 'en' {
  return (user as { locale?: string }).locale === 'en' ? 'en' : 'tr';
}

const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      const locale = userLocale(user);
      const { subject, html, text } = await renderResetEmail(locale, { url });
      await sendEmail({ to: user.email, subject, html, text });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const locale = userLocale(user);
      const { subject, html, text } = await renderVerifyEmail(locale, { url });
      await sendEmail({ to: user.email, subject, html, text });
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

  trustedOrigins,

  // Built-in per-endpoint limiter (our own limiter — Task 15 — covers app routes).
  rateLimit: { enabled: true, window: 60, max: 100 },

  plugins: [nextCookies()], // MUST be last
});
