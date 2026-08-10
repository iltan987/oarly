import { createTranslator } from 'next-intl';
import { render } from 'react-email';

import { type Locale, locales } from '@/i18n/config';

import { BookingNoticeEmail } from './booking-notice';
import { ClubDecisionEmail } from './club-decision';
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

export async function renderOwnerRemoval(locale: string, data: BookingWhen): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  return renderNotice(validLocale, t('booking.ownerRemoval.subject'), t('booking.ownerRemoval.heading'), t('booking.ownerRemoval.intro'), baseRows(t, data, validLocale));
}

export async function renderNoShowPenalty(
  locale: string,
  data: BookingWhen & { bannedUntil: Date | null; cancelledCount: number },
): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  const rows = baseRows(t, data, validLocale);
  if (data.bannedUntil) {
    rows.push({
      label: t('booking.labels.bannedUntil'),
      value: new Intl.DateTimeFormat(validLocale, { timeZone: data.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(data.bannedUntil),
    });
  }
  if (data.cancelledCount > 0) {
    rows.push({ label: t('booking.labels.cancelledBookings'), value: String(data.cancelledCount) });
  }
  // One notice, not three: the cascade would otherwise fire a cancellation email
  // per seat alongside this one, all within a second, leaving the member to
  // reassemble the story themselves.
  const intro = data.bannedUntil ? t('booking.noShow.intro') : t('booking.noShow.introNoBan');
  return renderNotice(validLocale, t('booking.noShow.subject'), t('booking.noShow.heading'), intro, rows);
}

/**
 * The other half of `renderNoShowPenalty`: the club has reversed the restriction the
 * member was told about, and they can book again.
 *
 * NO booking rows, because there is no booking — a suspension is a fact about the
 * membership, and it may have been imposed weeks ago over a session nobody remembers. The
 * club row alone is what the member needs to know which of their clubs this is about.
 *
 * WHAT THE COPY DELIBERATELY DOES NOT DO, because it is the whole point of the email:
 * it does not apologise on the club's behalf, congratulate the member, or suggest the
 * original penalty was a mistake. The owner may be reinstating somebody who genuinely
 * missed sessions, and mail that treats that as an error corrected puts words in the
 * club's mouth. It states the restriction is over and that they can book again. Pinned in
 * `booking-emails.test.ts`.
 *
 * Register: `emails.*` is formal throughout its booking family, and this member has
 * already had `renderNoShowPenalty`'s formal mail about the same restriction. See
 * `src/i18n/tr-member-register.test.ts`, which scopes the app's informal rule to the UI
 * namespaces and records the email channel's own settled register as a separate decision.
 */
export async function renderPenaltyLift(locale: string, data: { clubName: string }): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  return renderNotice(
    validLocale,
    t('booking.penaltyLift.subject'),
    t('booking.penaltyLift.heading'),
    t('booking.penaltyLift.intro'),
    [{ label: t('booking.labels.club'), value: data.clubName }],
  );
}

export async function renderClubDecision(
  locale: string,
  data: { clubName: string; decision: 'approved' | 'rejected'; note: string | null; url: string | null },
): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  const approved = data.decision === 'approved';
  const subject = approved ? t('clubApproved.subject') : t('clubRejected.subject');
  const heading = approved
    ? t('clubApproved.heading', { clubName: data.clubName })
    : t('clubRejected.heading', { clubName: data.clubName });
  const intro = approved ? t('clubApproved.intro') : t('clubRejected.intro');
  const noteLabel = approved ? t('clubApproved.noteLabel') : t('clubRejected.noteLabel');
  const element = ClubDecisionEmail({
    heading,
    intro,
    noteLabel,
    note: data.note,
    button: approved ? t('clubApproved.button') : null,
    url: approved ? data.url : null,
    locale: validLocale,
  });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
