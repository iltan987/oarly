import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import * as z from 'zod';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { renderResetEmail, renderVerifyEmail } from '@/emails';
import { deriveTrustedOrigins, env } from '@/env';
import { locales } from '@/i18n/config';
import {
  authRateLimitAfter,
  authRateLimitBefore,
  authRateLimitRules,
  authRateLimitStorage,
} from '@/lib/auth-rate-limit';
import { recordSignupConsent } from '@/lib/consent';
import { isDateISO } from '@/lib/date-iso';
import { sendEmail } from '@/lib/email';
import { GENDER_OPTIONS, PAYMENT_TYPES } from '@/lib/schemas';
import { THEMES } from '@/lib/theme';

/**
 * Derived here rather than in `src/env.ts` because that module is imported by a client
 * component (`forgot-password-form.tsx`, for `NEXT_PUBLIC_APP_URL`) and a module-scope read
 * of a `server:` key throws in the browser during module evaluation. See the note above
 * `deriveTrustedOrigins`. This file is server-only, so the read is safe here.
 */
const trustedOrigins = deriveTrustedOrigins(env.TRUSTED_ORIGINS, env.APP_URL);

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
    /*
     * `validator.input` is where these columns are actually bounded, and it is the only
     * place that binds every writer.
     *
     * `src/lib/schemas.ts` is the CLIENT's mirror: `signUpSchema` reaches the browser as a
     * zodResolver and never runs on the server, and `accountProfileSchema` only guards the
     * `/account` server action. Neither is in the path of `POST /api/auth/sign-up/email`,
     * `POST /api/auth/update-user`, or the Google profile mapping below — all three write
     * these columns directly, and `first_name`/`last_name`/`phone` are `text`, so before
     * this they took a value of any length and `gender` took any string at all.
     *
     * Better Auth 1.6.26 applies these: `parseInputData` (better-auth/dist/db/schema.mjs:78)
     * runs `validator.input` through the Standard Schema interface and raises a 400
     * VALIDATION_ERROR on a failure, and it is reached from `parseUserInput` on both sign-up
     * (create) and update-user (update) and from
     * `parseAdditionalUserInputFromProviderProfile` for the OAuth path. `undefined` skips
     * validation, which is what keeps a partial `/update-user` working.
     *
     * The widths are `signUpSchema`'s, deliberately the same numbers — see that file for
     * where they come from. Consequence worth knowing: a Google account whose `given_name`
     * exceeds 80 characters is refused rather than truncated, because silently mangling
     * someone's own name is the worse of the two failures.
     *
     * `gender`, `defaultPaymentType`, `locale` and `theme` are pinned to the same constants
     * the UI renders from, so a crafted `/update-user` cannot put an unknown answer in a
     * KVKK-sensitive column or a non-enum string in front of the `payment_type` pg enum.
     * `.nullable()` on `gender` keeps "never answered" writable.
     *
     * `locale` and `theme` were the two fields this block argued about and then left out.
     * Both are `text NOT NULL` (`src/db/schema/auth.ts:25-26`), so `/update-user` wrote an
     * arbitrary-length string into either — no `.nullable()`, because NULL is not a value
     * they can hold. The blast radius is small, and that is the whole argument for binding
     * them rather than against: `userLocale()` above narrows on READ and
     * `next-themes` is handed `theme` client-side, so a junk value is invisible until
     * something starts trusting the column. `locales` is `@/i18n/config`'s, the same list
     * `asLocale` narrows to and the same one `messages/{tr,en}.json` exist for; `THEMES` is
     * `@/lib/theme`'s, the three `user-menu.tsx` renders as radio items. Neither import
     * pulls anything client-only into this module.
     *
     * `birthday` is validated here too, and NOT because Better Auth coerces it — a coercion
     * that cannot reject is not a validation, and this one cannot reject. `/update-user`'s
     * body schema is `z.record(z.string(), z.any())` (update-user.mjs:11) with no per-field
     * typing, so `parseInputData` copies the value through verbatim; the only date handling
     * is `value = new Date(value)` inside a `try` in
     * `@better-auth/core/dist/db/adapter/factory.mjs:115-117`, and `new Date('banana')`
     * returns Invalid Date WITHOUT throwing, so that catch never fires. `date('birthday')`
     * builds drizzle's `PgDateString`, which has no `mapToDriverValue`, so the Invalid Date
     * reaches node-postgres and `prepareValue` serialises it — measured — as
     * `0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN`, which Postgres rejects as 22007. That is a 500
     * out of an auth endpoint where the contract promises a refusal, and it is the same class
     * `dateOverrideSchema` and `accountProfileSchema` already guard with `isDateISO`.
     *
     * `Date` is accepted alongside the string because a programmatic caller may pass one, and
     * `isDateISO` rather than a shape regex because `2026-02-31` matches the shape, is not a
     * date, and lands as 22008.
     *
     * ONE THING THIS BOUND DOES NOT FIX, stated because the path above is documented in
     * detail and would otherwise imply it does: once the value is valid, the coercion still
     * hands a `Date` to a `date` column through pg's LOCAL-offset serialisation. Measured
     * under `TZ=America/New_York`, `1990-04-17` leaves `prepareValue` as
     * `1990-04-16T20:00:00.000-04:00` and Postgres stores 1990-04-16 — off by one on any
     * server west of UTC. It is pre-existing and unreachable from this app's own UI
     * (`saveAccountAction` writes the string straight through drizzle's `PgDateString`,
     * which does not build a `Date` at all); it would bite the first caller to write a
     * birthday through Better Auth. Passing `YYYY-MM-DD` rather than a `Date` avoids it.
     */
    additionalFields: {
      firstName: { type: 'string', required: false, validator: { input: z.string().max(80) } },
      lastName: { type: 'string', required: false, validator: { input: z.string().max(80) } },
      phone: { type: 'string', required: false, validator: { input: z.string().max(40) } },
      birthday: { type: 'date', required: false, validator: { input: z.union([z.date(), z.string().refine(isDateISO, 'YYYY-MM-DD'), z.null()]) } },
      gender: { type: 'string', required: false, validator: { input: z.enum(GENDER_OPTIONS).nullable() } },
      defaultPaymentType: { type: 'string', required: false, defaultValue: 'regular', validator: { input: z.enum(PAYMENT_TYPES) } },
      locale: { type: 'string', required: false, defaultValue: 'tr', validator: { input: z.enum(locales) } },
      theme: { type: 'string', required: false, defaultValue: 'system', validator: { input: z.enum(THEMES) } },
      isAdmin: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
  },

  advanced: {
    /**
     * How better-auth derives the client IP it keys its own rate limits on.
     *
     * WITHOUT this block better-auth 1.6.26 trusts `x-forwarded-for` ONLY when the header
     * holds a single value — `if (forwardedIps.length !== 1) return null;` in
     * `@better-auth/core/dist/utils/ip.mjs` (`getIPFromHeader`). On `null` its limiter
     * substitutes the literal `NO_TRUSTED_IP_KEY` (`better-auth/dist/api/rate-limiter/
     * index.mjs`, `resolveRateLimitConfig`), so the rate-limit key stops being
     * `${ip}|${path}` and becomes `no-trusted-ip|${path}`: EVERY auth request on the
     * platform lands in ONE bucket. `/sign-in/email` would be 20 sign-ins per minute for
     * the whole SaaS, with zero per-IP protection. Dormant on stock Vercel, whose edge
     * sets a single-valued header — and live the moment anything is put in front of it
     * (Cloudflare, a corporate proxy, a CDN), which is a deployment change, not a code
     * change, and would fail silently as "sign-in is mysteriously flaky".
     *
     * Setting `trustedProxies` to a non-empty list of valid CIDRs is what switches
     * `getIPFromHeader` out of that single-value-only mode: it then walks the chain from
     * the RIGHT, skipping hops that match the list, and returns the first one that does
     * not. We deliberately list a range that can never match a real hop, so nothing is
     * actually trusted and the walk always stops at the rightmost entry — the address our
     * own edge observed, i.e. the only entry in the chain a remote client cannot append
     * to. `192.0.2.0/24` is RFC 5737 TEST-NET-1, reserved for documentation and not
     * globally routable, which is exactly why it is safe as that sentinel (it is also the
     * range better-auth's own option docs use in their example). The effect is: a chained
     * header still yields a real per-IP key instead of collapsing the platform into one
     * bucket.
     *
     * `ipAddressHeaders` is stated explicitly rather than left at its `['x-forwarded-for']`
     * default so the header PRECEDENCE matches `src/lib/request-ip.ts` (forwarded-for
     * first, `x-real-ip` as the fallback) — Vercel sets both single-valued, so the
     * fallback also covers a forwarded-for we cannot parse at all.
     *
     * TRUST ASSUMPTION, same one as `src/lib/request-ip.ts`'s file header: this is only
     * safe because Vercel's edge overwrites these headers on every inbound request, so a
     * client cannot spoof them. Run this app with no proxy in front and per-IP limits
     * become bypassable by rotating the header — here as much as there.
     *
     * NOTE the deliberate divergence from `parseClientIp`: that function takes the
     * LEFTMOST chain entry (the client, per the XFF convention) because it keys our own
     * limits; better-auth cannot express leftmost-wins, so it keys on the rightmost.
     *
     * On stock Vercel the two AGREE — the header is single-valued, so leftmost ===
     * rightmost — and that is the deployed configuration these limits are sized for.
     *
     * Behind an ADDITIONAL proxy they do not merely differ, they differ in a way that
     * weakens this dimension, and the difference is the reason this comment exists. XFF is
     * append-only, so the rightmost entry is the hop nearest our edge — the CDN or proxy
     * PoP address, NOT the client. Every client arriving through one PoP then shares one
     * bucket, and better-auth's per-IP rules degrade from per-client to per-proxy-node:
     * `/sign-in/email` at 20/min would be 20/min for everyone behind that PoP. That is a
     * milder version of the failure this config exists to prevent (with no config at all,
     * better-auth rejects any multi-value chain and keys EVERYTHING to one literal
     * fallback), so it is still strictly better than not setting it — but it is not
     * equivalent to per-client limiting, and anyone putting Cloudflare or a CDN in front
     * of this app must revisit it.
     *
     * What is unaffected either way: the per-IDENTITY auth rules — `loginPerAccount`,
     * `passwordResetPerEmail`, and the verification-resend rule — key on the email from
     * the request body, never on an address. Per this codebase's sizing rule (see
     * `src/lib/rate-limit-config.ts`) those are the controls that actually bound abuse;
     * the per-IP dimension only blunts a single-source flood.
     *
     * Do not "align" the two by trusting broad ranges — trusting a range that covers real
     * clients is what would make the chain spoofable.
     */
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
      trustedProxies: ['192.0.2.0/24'],
    },
    ...(env.COOKIE_DOMAIN
      ? { crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } }
      : {}),
  },

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
