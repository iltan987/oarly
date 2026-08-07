import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { renderResetEmail, renderVerifyEmail } from '@/emails';
import { env, trustedOrigins } from '@/env';
import {
  authRateLimitAfter,
  authRateLimitBefore,
  authRateLimitRules,
  authRateLimitStorage,
} from '@/lib/auth-rate-limit';
import { recordSignupConsent } from '@/lib/consent';
import { sendEmail } from '@/lib/email';

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
    // A sign-in attempt by an unverified user is rejected with EMAIL_NOT_VERIFIED
    // (better-auth/dist/api/routes/sign-in.mjs:312-325). Without this flag the
    // attempt is a dead end: the original link may already have expired and nothing
    // re-sends one. With it, the same request that fails also mails a fresh link,
    // and the sign-in form routes the user to /verify-email to say so.
    sendOnSignIn: true,
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
            // Google's `locale` is a BCP-47 tag ("en", "en-GB", "tr"); we only speak
            // tr/en, and 'tr' is the app default, so anything non-English maps to 'tr'.
            // Without this the OAuth path leaves `locale` at its column default and
            // every email to an English-speaking Google user arrives in Turkish.
            mapProfileToUser: (profile: { given_name?: string; family_name?: string; locale?: string }) => ({
              firstName: profile.given_name,
              lastName: profile.family_name,
              locale: profile.locale?.toLowerCase().startsWith('en') ? 'en' : 'tr',
            }),
          },
        },
      }
    : {}),

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
      requireLocalEmailVerified: true,
    },
  },

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

  rateLimit: {
    enabled: true,
    // Fallback for every auth endpoint not named in authRateLimitRules.
    window: 60,
    max: 100,
    customRules: authRateLimitRules,
    // Shared across lambda instances when KV is configured; better-auth's own in-memory
    // storage otherwise, which is correct for dev and test.
    ...(authRateLimitStorage ? { customStorage: authRateLimitStorage } : {}),
  },

  // §17's identity-keyed limits that the IP-keyed `rateLimit` block above cannot express:
  // 5 failed sign-ins per ACCOUNT per 15 min, and 3 password-reset requests per EMAIL per
  // hour. See the doc comments on `authRateLimitBefore`/`authRateLimitAfter` in
  // @/lib/auth-rate-limit for why consumption happens in `before` and clearing in `after`.
  hooks: {
    before: authRateLimitBefore,
    after: authRateLimitAfter,
  },

  // KVKK acknowledgment may only be recorded when the user actually affirmed
  // the KVKK checkbox, which exists solely on the email/password sign-up form
  // (app/(auth)/sign-up/sign-up-form.tsx). This hook fires for EVERY account
  // creation path (credential AND social), so it must be gated on
  // `context.path` to fire only for the credential sign-up endpoint
  // (`/sign-up/email`) — social/OAuth account creation (e.g. Google) runs
  // through the `/callback/:id` endpoint instead and must NOT write a
  // consent row, since no checkbox was ever shown there. That path's proper
  // aydınlatma/consent handling is deferred to the lawyer-gated KVKK plan.
  //
  // Signal verified against the installed better-auth@1.6.23 /
  // @better-auth/core@1.6.23 sources:
  //   - `databaseHooks.user.create.after` is typed as
  //     `(user, context: GenericEndpointContext | null) => Promise<void>`
  //     (@better-auth/core/src/types/init-options.ts:1295-1298), where
  //     `GenericEndpointContext = EndpointContext<string, any> & { context: AuthContext }`
  //     (@better-auth/core/src/types/context.ts:81-85), and `EndpointContext`
  //     carries a `path: Path` field (better-call/dist/endpoint.d.mts:224-236).
  //   - At runtime, `db/with-hooks.mjs` resolves this `context` via
  //     `getCurrentAuthContext()` and passes it to the `after` hook
  //     (better-auth/dist/db/with-hooks.mjs:7,38). `api/dispatch.mjs` sets
  //     `internalContext.path = endpoint.path` before running the handler
  //     inside that same async context (better-auth/dist/api/dispatch.mjs:199,205-231).
  //   - The credential sign-up endpoint is declared as
  //     `createAuthEndpoint("/sign-up/email", ...)` and calls
  //     `internalAdapter.createUser(...)` directly inside its handler
  //     (better-auth/dist/api/routes/sign-up.mjs:21,220).
  //   - The social/OAuth callback endpoint is declared as
  //     `createAuthEndpoint("/callback/:id", ...)` (better-auth/dist/api/routes/callback.mjs:21)
  //     and calls `handleOAuthUserInfo(c, ...)` from within that same handler
  //     (callback.mjs:141), which calls `internalAdapter.createOAuthUser(...)`
  //     (better-auth/dist/oauth2/link-account.mjs:97) — a distinct adapter
  //     method used only for social account creation.
  //   Net effect: `context.path` reliably reads `/sign-up/email` for
  //   credential sign-up and `/callback/:id` for social sign-up, so gating on
  //   it (with a `context == null` fail-closed default) correctly scopes the
  //   consent write to the credential path only.
  databaseHooks: {
    user: {
      create: {
        after: async (user, context) => {
          if (context?.path !== '/sign-up/email') return;
          await recordSignupConsent(db, user.id);
        },
      },
    },
  },

  plugins: [nextCookies()], // MUST be last
});
