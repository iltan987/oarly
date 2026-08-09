'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { db } from '@/db';
import { env } from '@/env';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { enforceRateLimit } from '@/lib/rate-limit-guard';
import { getClientIp } from '@/lib/request-ip';
import { getCurrentUser } from '@/lib/session';
import { setUserLocale } from '@/lib/user-locale';

import { asLocale, type Locale, LOCALE_COOKIE } from './config';

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale) {
  // A Server Action is a public POST endpoint and its argument is attacker-controlled
  // whatever its TypeScript type says. Validated FIRST so junk cannot spend a
  // rate-limit token, and — more importantly — cannot reach the `user.locale` write.
  const next = asLocale(locale);
  if (!next) return;

  // No auth guard exists on this action — anyone can POST it. Silently doing nothing is
  // the right refusal: the caller is a language switcher with no error surface, and a
  // human cannot reach 60 switches a minute.
  const verdict = await enforceRateLimit([
    { key: `locale:ip:${await getClientIp()}`, rule: RATE_LIMITS.localePerIp },
  ]);
  if (verdict.limited) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, next, {
    maxAge: ONE_YEAR,
    path: '/',
    sameSite: 'lax',
    // Nothing client-side reads this cookie — the browser learns the locale from
    // NextIntlClientProvider, not from document.cookie.
    httpOnly: true,
    // Derived from our own origin, not NODE_ENV: a production-mode build served over
    // plain HTTP would mark the cookie Secure and the browser would drop it silently.
    secure: env.APP_URL.startsWith('https:'),
    // Without this the cookie is host-only, so a language chosen on a club subdomain
    // does not apply on the apex and vice versa — the language would appear to flip as
    // the user moves between their club and the account pages. Every other cookie in
    // the app is already cross-subdomain (see `advanced.crossSubDomainCookies` in
    // `src/auth.ts`, driven by the same variable).
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });

  // `user.locale` is what transactional email renders from; the cookie is what the UI
  // reads. One action sets both so they cannot disagree. Best-effort: the cookie is
  // already written and the page is about to re-render, so a failure reading the
  // session (`getCurrentUser` is itself a DB query through the same pool) or writing
  // the row must not throw back into a control that has no way to report it.
  try {
    const user = await getCurrentUser();
    if (user) {
      await setUserLocale(db, user.id, next);
    }
  } catch (error) {
    console.error('setLocale: failed to persist user.locale', error);
  }

  // NOT `router.refresh()` on the client: that re-renders only the current route and
  // leaves every other entry in the client Router Cache in the previous language, so
  // navigating Back shows the old one. Locale changes every string on every route, so
  // the invalidation is as wide as the change.
  revalidatePath('/', 'layout');
}
