import { match } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';
import { locales, defaultLocale, type Locale } from './config';

export function resolveLocale(acceptLanguage: string): Locale {
  if (!acceptLanguage) return defaultLocale;
  const requested = new Negotiator({
    headers: { 'accept-language': acceptLanguage },
  }).languages();
  try {
    return match(requested, locales as unknown as string[], defaultLocale) as Locale;
  } catch {
    return defaultLocale;
  }
}
