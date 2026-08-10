import { and, desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RestrictionNotice } from '@/components/restriction-notice';
import { db } from '@/db';
import { boatTypes, bookings, sessions, slots } from '@/db/schema';
import { requireMemberView } from '@/lib/membership';
import { getRestriction } from '@/lib/restriction';

import { type BookingRow, BookingsList } from './bookings-list';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MyBookingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club, user, membership } = await requireMemberView(slug, '/bookings');
  const t = await getTranslations('booking');
  const now = new Date();

  /*
    This page is where the penalty's COLLATERAL damage is visible: `markNoShow` cancels
    every future seat the ban swallows, so a restricted member reads N cancelled rows.
    Without the notice above them that is N repetitions of a consequence with no
    statement of the restriction it belongs to.
  */
  const restriction = await getRestriction(db, membership, now);

  const rows = await db
    .select({ id: bookings.id, status: bookings.status, cancelledReason: bookings.cancelledReason, queuePosition: bookings.queuePosition, boatName: boatTypes.name, startAt: slots.startAt, endAt: slots.endAt })
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
      status: r.status, cancelledReason: r.cancelledReason, queuePosition: r.queuePosition,
      canCancel: club.selfCancelEnabled && activeStatuses.has(r.status) && r.startAt.getTime() > now.getTime() && cutoffOk,
    };
  };
  const upcoming = rows.filter((r) => r.startAt.getTime() > now.getTime() && activeStatuses.has(r.status)).map(toRow);
  const past = rows.filter((r) => !(r.startAt.getTime() > now.getTime() && activeStatuses.has(r.status))).map(toRow);

  return (
    // Flex column, not `mb-4` on the heading: a null `RestrictionNotice` produces no DOM
    // node and therefore no gap, where a margin-carrying wrapper would leave a hole.
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-xl font-semibold">{t('myTitle')}</h1>
      <RestrictionNotice restriction={restriction} timeZone={club.timezone} clubPhone={club.phone} variant="card" />
      {/*
        The SAME `restriction` the card above renders from — read once, used twice. Not a
        second `getRestriction` call: two reads of a time-sensitive state in one render can
        disagree across the instant a pause lapses, and the page would then show a card
        saying "paused" above an empty state offering to book (or the reverse).
      */}
      <BookingsList slug={slug} upcoming={upcoming} past={past} timeZone={club.timezone} restricted={restriction.state !== 'none'} />
    </div>
  );
}
