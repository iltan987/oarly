import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { memberships, user } from '@/db/schema';
import { addDaysISO, utcToClubDate } from '@/lib/date-tz';
import { requireOwner } from '@/lib/membership';
import { getDayRoster } from '@/lib/roster';

import { BookingsRoster } from './bookings-roster';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function activeMembers(rows: { userId: string; name: string; bannedUntil: Date | null }[]): { userId: string; name: string }[] {
  const now = Date.now();
  return rows
    .filter((m) => m.bannedUntil == null || m.bannedUntil.getTime() <= now)
    .map((m) => ({ userId: m.userId, name: m.name }));
}

export default async function ManageBookingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/bookings');
  const t = await getTranslations('manage.bookings');
  const sp = await searchParams;

  const today = utcToClubDate(new Date(), club.timezone).dateISO;
  const dateISO = sp.date && dateRe.test(sp.date) ? sp.date : today;

  const roster = await getDayRoster(db, { clubId: club.id, dateISO });
  const memberRows = await db
    .select({ userId: memberships.userId, name: user.name, status: memberships.status, bannedUntil: memberships.bannedUntil })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(memberships.clubId, club.id), eq(memberships.status, 'approved')));
  const members = activeMembers(memberRows);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Link className={buttonVariants({ size: 'sm', variant: 'ghost' })} href={`/manage/bookings?date=${addDaysISO(dateISO, -1)}`}>{t('prevDay')}</Link>
        <span className="font-heading text-sm font-semibold">{dateISO}</span>
        <Link className={buttonVariants({ size: 'sm', variant: 'ghost' })} href={`/manage/bookings?date=${addDaysISO(dateISO, 1)}`}>{t('nextDay')}</Link>
      </div>
      {roster.closed ? (
        <p className="text-sm text-muted-foreground">{t('closed')}</p>
      ) : (
        <BookingsRoster slug={slug} sessions={roster.sessions} members={members} timezone={club.timezone} />
      )}
    </div>
  );
}
