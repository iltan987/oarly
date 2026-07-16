import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { type Locale, LOCALE_COOKIE, locales } from './config';
import { resolveLocale } from './resolve-locale';

/** Narrow an arbitrary string to a supported Locale, or undefined. */
export function asLocale(value: string | undefined | null): Locale | undefined {
  return value && (locales as readonly string[]).includes(value) ? (value as Locale) : undefined;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const override = asLocale(await requestLocale);
  const cookieStore = await cookies();
  const cookieLocale = asLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const acceptLanguage = (await headers()).get('accept-language') ?? '';
  const locale = override ?? cookieLocale ?? resolveLocale(acceptLanguage);
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
