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
