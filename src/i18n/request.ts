import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, type Locale } from './config';
import { resolveLocale } from './resolve-locale';

export default getRequestConfig(async ({ locale: override }) => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value as Locale | undefined;
  const acceptLanguage = (await headers()).get('accept-language') ?? '';
  const locale = (override as Locale) || cookieLocale || resolveLocale(acceptLanguage);
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
