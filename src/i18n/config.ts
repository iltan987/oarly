export const locales = ['tr', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'tr';
export const LOCALE_COOKIE = 'locale';

/**
 * Narrow an arbitrary string to a supported Locale, or undefined.
 *
 * Lives here, next to `locales`, rather than in `request.ts`: `set-locale.ts` needs it
 * to validate a Server Action argument, and importing the next-intl request config —
 * with its `next-intl/server` dependency and its dynamic `messages/*.json` import — into
 * an action just to reach a three-line type guard is the wrong direction of dependency.
 */
export function asLocale(value: string | undefined | null): Locale | undefined {
  return value && (locales as readonly string[]).includes(value) ? (value as Locale) : undefined;
}
