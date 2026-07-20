import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { addDaysISO, utcToClubDate } from '@/lib/date-tz';
import { requireOwner } from '@/lib/membership';
import { getDayRoster } from '@/lib/roster';

import { BookingsRoster } from './bookings-roster';
import { DateJump } from './date-jump';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export default async function ManageBookingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/bookings');
  const t = await getTranslations('manage.bookings');
  const sp = await searchParams;

  const today = utcToClubDate(new Date(), club.timezone).dateISO;
  const dateISO = sp.date && dateRe.test(sp.date) ? sp.date : today;

  const roster = await getDayRoster(db, { clubId: club.id, dateISO });

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
      {roster.closed ? (
        <p className="text-sm text-muted-foreground">{t('closed')}</p>
      ) : (
        <BookingsRoster slug={slug} sessions={roster.sessions} timezone={club.timezone} />
      )}
    </div>
  );
}
