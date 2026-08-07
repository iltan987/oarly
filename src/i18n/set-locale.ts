'use server';
import { cookies } from 'next/headers';

import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { enforceRateLimit } from '@/lib/rate-limit-guard';
import { getClientIp } from '@/lib/request-ip';

import { type Locale, LOCALE_COOKIE } from './config';

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale) {
  // No auth guard exists on this action — anyone can POST it. Silently doing nothing is
  // the right refusal: the caller is a language switcher with no error surface, and a
  // human cannot reach 60 switches a minute.
  const verdict = await enforceRateLimit([
    { key: `locale:ip:${await getClientIp()}`, rule: RATE_LIMITS.localePerIp },
  ]);
  if (verdict.limited) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { maxAge: ONE_YEAR, path: '/', sameSite: 'lax' });
}
