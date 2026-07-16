import { createTranslator } from 'next-intl';
import { render } from 'react-email';

import { type Locale, locales } from '@/i18n/config';

import { ResetPasswordEmail } from './reset-password';
import { VerifyEmail } from './verify-email';

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

/** Templates render outside a request context, so we guard/default the locale ourselves. */
function toLocale(locale: string): Locale {
  return (locales as readonly string[]).includes(locale) ? (locale as Locale) : 'tr';
}

async function loadEmailsTranslator(locale: Locale) {
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages, namespace: 'emails' });
}

export async function renderVerifyEmail(
  locale: string,
  { url }: { url: string },
): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  const props = {
    heading: t('verify.heading'),
    body: t('verify.body'),
    button: t('verify.button'),
    url,
    locale: validLocale,
  };
  const element = VerifyEmail(props);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { subject: t('verify.subject'), html, text };
}

export async function renderResetEmail(
  locale: string,
  { url }: { url: string },
): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  const props = {
    heading: t('reset.heading'),
    body: t('reset.body'),
    button: t('reset.button'),
    url,
    locale: validLocale,
  };
  const element = ResetPasswordEmail(props);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { subject: t('reset.subject'), html, text };
}
