import { createTranslator } from 'next-intl';
import { render } from 'react-email';

import { type Locale, locales } from '@/i18n/config';

import { BookingNoticeEmail } from './booking-notice';
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

type BookingWhen = { clubName: string; boatName: string; startAt: Date; endAt: Date; timezone: string };

/** Human date + time range in the club's timezone, e.g. "Monday, 20 July, 08:00–09:00". */
function formatWhen(locale: Locale, tz: string, startAt: Date, endAt: Date): string {
  const day = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(startAt);
  const clock = (d: Date) => new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${day}, ${clock(startAt)}–${clock(endAt)}`;
}

function baseRows(t: Awaited<ReturnType<typeof loadEmailsTranslator>>, data: BookingWhen, locale: Locale) {
  return [
    { label: t('booking.labels.club'), value: data.clubName },
    { label: t('booking.labels.boat'), value: data.boatName },
    { label: t('booking.labels.when'), value: formatWhen(locale, data.timezone, data.startAt, data.endAt) },
  ];
}

async function renderNotice(locale: Locale, subject: string, heading: string, intro: string, rows: { label: string; value: string }[]): Promise<RenderedEmail> {
  const element = BookingNoticeEmail({ heading, intro, rows, locale });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

export async function renderBookingConfirmation(
  locale: string,
  data: BookingWhen & { outcome: 'seated' | 'waitlisted'; queuePosition: number | null },
): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  const rows = baseRows(t, data, validLocale);
  if (data.outcome === 'waitlisted') rows.push({ label: t('booking.labels.queuePosition'), value: String(data.queuePosition ?? '') });
  const heading = data.outcome === 'seated' ? t('booking.confirmation.headingSeated') : t('booking.confirmation.headingWaitlisted');
  const intro = data.outcome === 'seated' ? t('booking.confirmation.introSeated') : t('booking.confirmation.introWaitlisted');
  return renderNotice(validLocale, t('booking.confirmation.subject'), heading, intro, rows);
}

export async function renderWaitlistPromotion(locale: string, data: BookingWhen): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  return renderNotice(validLocale, t('booking.promotion.subject'), t('booking.promotion.heading'), t('booking.promotion.intro'), baseRows(t, data, validLocale));
}

export async function renderBookingCancellation(locale: string, data: BookingWhen): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  return renderNotice(validLocale, t('booking.cancellation.subject'), t('booking.cancellation.heading'), t('booking.cancellation.intro'), baseRows(t, data, validLocale));
}
