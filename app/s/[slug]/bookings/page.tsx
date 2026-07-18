import { and, desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { boatTypes, bookings, sessions, slots } from '@/db/schema';
import { requireMember } from '@/lib/membership';

import { type BookingRow, BookingsList } from './bookings-list';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MyBookingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club, user } = await requireMember(slug, '/bookings');
  const t = await getTranslations('booking');
  const now = new Date();

  const rows = await db
    .select({ id: bookings.id, status: bookings.status, queuePosition: bookings.queuePosition, boatName: boatTypes.name, startAt: slots.startAt, endAt: slots.endAt })
    .from(bookings)
    .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
    .innerJoin(slots, eq(slots.id, sessions.slotId))
    .innerJoin(boatTypes, eq(boatTypes.id, sessions.boatTypeId))
    .where(and(eq(bookings.userId, user.id), eq(bookings.clubId, club.id)))
    .orderBy(desc(slots.startAt));

  const activeStatuses = new Set(['booked', 'waitlisted']);
  const toRow = (r: (typeof rows)[number]): BookingRow => {
    const cutoffOk = club.cancelCutoffHours == null || now.getTime() < r.startAt.getTime() - club.cancelCutoffHours * 3600_000;
    return {
      id: r.id, boatName: r.boatName, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString(),
      status: r.status, queuePosition: r.queuePosition,
      canCancel: club.selfCancelEnabled && activeStatuses.has(r.status) && r.startAt.getTime() > now.getTime() && cutoffOk,
    };
  };
  const upcoming = rows.filter((r) => r.startAt.getTime() > now.getTime() && activeStatuses.has(r.status)).map(toRow);
  const past = rows.filter((r) => !(r.startAt.getTime() > now.getTime() && activeStatuses.has(r.status))).map(toRow);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-lg font-semibold">{t('myTitle')}</h1>
        <Link href={`/s/${slug}/book`} className="text-sm underline">{t('back')}</Link>
      </div>
      <BookingsList slug={slug} upcoming={upcoming} past={past} timeZone={club.timezone} />
    </div>
  );
}
