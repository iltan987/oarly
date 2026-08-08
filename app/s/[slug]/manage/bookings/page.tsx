import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { isDateISO } from '@/lib/date-iso';
import { addDaysISO, utcToClubDate } from '@/lib/date-tz';
import { requireOwner } from '@/lib/membership';
import { penaltyEndsAt } from '@/lib/penalty';
import { getDayRoster } from '@/lib/roster';

import { BookingsRoster } from './bookings-roster';
import { DateJump } from './date-jump';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ManageBookingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/bookings');
  const t = await getTranslations('manage.bookings');
  const sp = await searchParams;

  const today = utcToClubDate(new Date(), club.timezone).dateISO;
  // Validity, not shape. `/^\d{4}-\d{2}-\d{2}$/` accepted `2026-02-31`, which is a
  // 22008 at the `date` column, and `2026-13-45`, which `addDaysISO` turned into
  // "NaN-NaN-NaN" in this page's own prev/next links. A stale bookmark is enough to
  // reach it — no crafted POST (see `isDateISO`).
  const dateISO = isDateISO(sp.date) ? sp.date : today;

  const roster = await getDayRoster(db, { clubId: club.id, dateISO });

  const now = new Date();
  const sessions = roster.sessions.map((s) => {
    const ends = penaltyEndsAt({ sessionStartAt: s.startAt, timezone: club.timezone, policy: club.noshowPenalty });
    const permanent = ends === 'permanent';
    const endsAt = permanent ? null : ends;
    return {
      ...s,
      banEndsAt: endsAt,
      banPermanent: permanent,
      banLapsed: !permanent && endsAt != null && endsAt.getTime() <= now.getTime(),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-center gap-2">
        <Link aria-label={t('prevDay')} className={buttonVariants({ size: 'icon-sm', variant: 'ghost' })} href={`/manage/bookings?date=${addDaysISO(dateISO, -1)}`}>
          <ChevronLeftIcon />
        </Link>
        <DateJump dateISO={dateISO} />
        <Link aria-label={t('nextDay')} className={buttonVariants({ size: 'icon-sm', variant: 'ghost' })} href={`/manage/bookings?date=${addDaysISO(dateISO, 1)}`}>
          <ChevronRightIcon />
        </Link>
      </div>
      {/*
        A closed day can still hold bookings made before it was closed —
        computeCalendar surfaces those persisted slots read-only rather than dropping
        them, so the roster must still render or the owner would have no way to see or
        remove the members who are holding those seats. Seating a NEW member stays
        blocked on a closed day (BookingsRoster hides the add form), which is the
        invariant ownerAddBooking's override comment relies on.
      */}
      {roster.closed && <p className="text-sm text-muted-foreground">{t('closed')}</p>}
      <BookingsRoster slug={slug} sessions={sessions} timezone={club.timezone} closed={roster.closed} multisportEnabled={club.multisportEnabled} />
    </div>
  );
}
