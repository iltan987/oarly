'use server';
import { cookies } from 'next/headers';

import { type Locale, LOCALE_COOKIE } from './config';

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale) {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { maxAge: ONE_YEAR, path: '/', sameSite: 'lax' });
}
