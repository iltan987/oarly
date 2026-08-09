import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactElement } from 'react';

import { StatusPill } from '@/components/booking-status-badge';
import type { Restriction } from '@/lib/restriction';
import { cn } from '@/lib/utils';

/**
 * What a restricted member is told, and in what order.
 *
 * Before this component the entire member-facing explanation of a penalty was one
 * word — a red "Suspended" pill — while the OWNER who imposed it read four
 * carefully-worded strings saying exactly what was about to happen
 * (`manage.bookings.confirmAbsentBan` and friends). The person the sanction lands on
 * got the least information about it.
 *
 * Three things, in this order, and the order is the point:
 *
 * 1. **When it lifts** (paused only), with the TIME, not just the date. "12 August"
 *    reads as "some time that day"; "12 August at 07:00" is a fact a member can plan
 *    around. The hour is the penalty's real end — `penaltyEndsAt` anchors the ban to
 *    the missed session's wall-clock hour precisely so it does not drift.
 * 2. **Why** — the session they were marked absent for. This is what turns the notice
 *    from a verdict into a consequence, and it is the ONLY way a member can notice the
 *    owner marked the wrong person.
 * 3. **What to do** (suspended only) — a suspension does not lift by itself, so the
 *    only useful next step is a phone call.
 *
 * Deliberately absent: penalty counts, the club's `noshowPenalty` setting, and how
 * close the member is to a worse penalty. Explain the restriction that exists; a
 * disciplinary dashboard is a different (and worse) product.
 */
export type RestrictionNoticeVariant = 'card' | 'inline';

/** A phone number split into the three strings the view needs: never a `clubs.phone` row. */
type PhoneLink = { text: string; href: string; label: string };

/**
 * `tel:` accepts digits, `+`, and a handful of separators; Turkish numbers are stored
 * with whatever spacing the owner typed. Strip everything but the digits and a leading
 * `+` so the href dials, and keep the ORIGINAL string as the visible label so the member
 * still recognises the number their club published.
 */
function telHref(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `tel:${phone.trimStart().startsWith('+') ? '+' : ''}${digits}`;
}

/**
 * The rendering half, split out so `@testing-library/react` can mount it: an async
 * server component cannot be rendered by RTL at all, and one nested in a prop renders
 * as an empty div with no error. `BookCalendar` is tested through the same split.
 *
 * Every prop is a plain string (or null). Nothing here formats a date, reads a locale,
 * or knows what a `Restriction` is — hand it strings and it is a pure function of them.
 */
export function RestrictionNoticeView({
  state,
  title,
  lead,
  cause,
  contact,
  phone,
  variant,
}: {
  state: 'paused' | 'suspended';
  title: string;
  lead: string;
  cause: string | null;
  /** The "only the club can lift this" sentence. Null unless this is a suspension on a card. */
  contact: string | null;
  phone: PhoneLink | null;
  variant: RestrictionNoticeVariant;
}): ReactElement {
  const isCard = variant === 'card';
  const toneText = state === 'paused' ? 'text-warn' : 'text-bad';

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col text-left',
        isCard
          ? cn(
              'w-full items-start gap-2 rounded-card border p-4',
              state === 'paused' ? 'border-warn/30 bg-warn-bg' : 'border-bad/30 bg-bad-bg',
            )
          : 'gap-0.5',
      )}
    >
      {isCard ? (
        <StatusPill tone={state === 'paused' ? 'warn' : 'bad'}>{title}</StatusPill>
      ) : (
        // No pill inline: the apex row is 320px wide with an avatar and a link already in
        // it, and a badge on its own line costs more height than the sentence it labels.
        <span className={cn('text-xs font-semibold', toneText)}>{title}</span>
      )}

      <p className={cn(isCard ? 'text-sm font-medium' : 'text-xs', toneText)}>{lead}</p>

      {cause ? (
        <p className={cn(isCard ? 'text-sm text-foreground/80' : 'text-xs text-muted-foreground')}>{cause}</p>
      ) : null}

      {contact ? (
        <p className="text-sm text-foreground/80">
          {contact}
          {phone ? (
            <>
              {' '}
              {/*
                `aria-label` CONTAINS the visible text (WCAG 2.5.3, Label in Name): the
                number stays the link's visible label so a member recognises it, and the
                accessible name adds only what a screen reader cannot infer from digits.
              */}
              <a href={phone.href} aria-label={phone.label} className="font-medium text-foreground underline underline-offset-2">
                {phone.text}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The async half. Formats in the CLUB's timezone, which is why this cannot be a client
 * component and why the dates are not ICU date skeletons: on the apex root page the
 * timezone varies per row, so it is not the request timezone and next-intl's global
 * `timeZone` cannot supply it. `{date}` and `{time}` are plain string placeholders
 * filled here, exactly as `book-calendar.tsx` already formats slot times.
 *
 * Returns `null` for `{ state: 'none' }` so every caller can render it unconditionally
 * and never repeat the "is this member restricted" test the model already owns.
 */
export async function RestrictionNotice({
  restriction,
  timeZone,
  clubPhone,
  variant = 'card',
}: {
  restriction: Restriction;
  timeZone: string;
  clubPhone?: string | null;
  variant?: RestrictionNoticeVariant;
}): Promise<ReactElement | null> {
  if (restriction.state === 'none') return null;

  const t = await getTranslations('restriction');
  const f = await getFormatter();

  const day = (d: Date) => f.dateTime(d, { day: 'numeric', month: 'long', timeZone });
  const clock = (d: Date) => f.dateTime(d, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });

  const lead =
    restriction.state === 'paused'
      ? t('pausedUntil', { date: day(restriction.endsAt), time: clock(restriction.endsAt) })
      : t('suspendedBody');

  const { cause } = restriction;
  const causeText =
    cause == null
      ? null
      : cause.reason !== 'no_show'
        ? t('causeOther')
        : cause.sessionStartAt == null
          ? t('causeNoShowUndated')
          : t('causeNoShow', { date: day(cause.sessionStartAt), time: clock(cause.sessionStartAt) });

  // "Contact the club" only where there is a club to contact and a suspension to lift.
  // A paused member needs no phone call — the sentence above already told them the date.
  const showContact = restriction.state === 'suspended' && variant === 'card';
  const phone = showContact && clubPhone ? clubPhone.trim() : '';

  return (
    <RestrictionNoticeView
      state={restriction.state}
      title={t(restriction.state === 'paused' ? 'pausedTitle' : 'suspendedTitle')}
      lead={lead}
      cause={causeText}
      contact={showContact ? t('contact') : null}
      phone={phone ? { text: phone, href: telHref(phone), label: t('callClub', { phone }) } : null}
      variant={variant}
    />
  );
}
