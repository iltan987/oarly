import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { asLocale, LOCALE_COOKIE } from './config';
import { resolveLocale } from './resolve-locale';

export default getRequestConfig(async ({ requestLocale }) => {
  const override = asLocale(await requestLocale);
  const cookieStore = await cookies();
  const cookieLocale = asLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const acceptLanguage = (await headers()).get('accept-language') ?? '';
  const locale = override ?? cookieLocale ?? resolveLocale(acceptLanguage);
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
