import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';

import type { DB } from '@/db';
import { bookings, clubs, memberships, penalties, sessions, slots } from '@/db/schema';

import { applySeating, type Tx } from './booking';
import { penaltyEndsAt, resolveBan } from './penalty';

const ACTIVE = ['booked', 'waitlisted'] as const;

export type MarkNoShowResult =
  | {
      ok: true;
      bannedUntil: Date | null;
      permanent: boolean;
      /** The ban ended before it was issued — the absence is recorded but restricts nothing. */
      alreadyLapsed: boolean;
      cancelled: { bookingId: string; sessionId: string }[];
      promoted: { userId: string; sessionId: string }[];
    }
  | { ok: false; error: 'not_found' | 'not_started' | 'not_booked' | 'already_marked' };

/** Recompute the membership's ban from its remaining penalty rows and persist it. */
async function recomputeBan(tx: Tx, membershipId: string, currentStatus: string): Promise<{ bannedUntil: Date | null; permanent: boolean }> {
  const rows = await tx
    .select({ bannedUntil: penalties.bannedUntil, permanent: penalties.permanent })
    .from(penalties)
    .where(eq(penalties.membershipId, membershipId));
  const ban = resolveBan(rows);

  // Only ever move status between 'approved' and 'banned'. Writing it
  // unconditionally would resurrect a rejected membership.
  const status: 'banned' | 'approved' | undefined =
    ban.permanent ? 'banned' : currentStatus === 'banned' ? 'approved' : undefined;
  await tx
    .update(memberships)
    .set(status ? { bannedUntil: ban.bannedUntil, status } : { bannedUntil: ban.bannedUntil })
    .where(eq(memberships.id, membershipId));
  return ban;
}

/**
 * Record that a seated member did not turn up, and apply the club's penalty.
 *
 * One transaction: mark the booking -> write the penalty row -> recompute the
 * membership ban -> cancel the member's seats that fall INSIDE the ban window,
 * promoting a waitlister into each.
 *
 * Two orderings are load-bearing. The cascade runs after the ban is computed
 * because the ban end is what bounds it. And the per-slot advisory locks are
 * taken in ascending start-time order because the cascade holds several at once
 * — unordered acquisition lets two owners marking concurrently deadlock.
 */
export async function markNoShow(db: DB, input: { clubId: string; bookingId: string; now?: Date }): Promise<MarkNoShowResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: bookings.id,
        userId: bookings.userId,
        clubId: bookings.clubId,
        status: bookings.status,
        sessionId: bookings.sessionId,
        slotStartAt: slots.startAt,
        timezone: clubs.timezone,
        policy: clubs.noshowPenalty,
        multisportMode: clubs.multisportMode,
      })
      .from(bookings)
      .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
      .innerJoin(slots, eq(slots.id, sessions.slotId))
      .innerJoin(clubs, eq(clubs.id, bookings.clubId))
      .where(eq(bookings.id, input.bookingId));

    if (!row || row.clubId !== input.clubId || !row.userId) return { ok: false, error: 'not_found' };
    if (row.status === 'no_show') return { ok: false, error: 'already_marked' };
    // A waitlisted member never held a seat, so absence is meaningless for them.
    if (row.status !== 'booked') return { ok: false, error: 'not_booked' };
    if (now.getTime() < row.slotStartAt.getTime()) return { ok: false, error: 'not_started' };

    const [membership] = await tx
      .select({ id: memberships.id, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.userId, row.userId), eq(memberships.clubId, input.clubId)));
    if (!membership) return { ok: false, error: 'not_found' };

    await tx.update(bookings).set({ status: 'no_show', queuePosition: null }).where(eq(bookings.id, row.id));

    const ends = penaltyEndsAt({ sessionStartAt: row.slotStartAt, timezone: row.timezone, policy: row.policy });
    const permanent = ends === 'permanent';
    const endsAt = permanent ? null : ends;
    await tx.insert(penalties).values({
      membershipId: membership.id,
      sessionId: row.sessionId,
      bookingId: row.id,
      reason: 'no_show',
      bannedUntil: endsAt,
      permanent,
    });

    const ban = await recomputeBan(tx, membership.id, membership.status);
    const alreadyLapsed = !permanent && endsAt != null && endsAt.getTime() <= now.getTime();

    const cancelled: { bookingId: string; sessionId: string }[] = [];
    const promoted: { userId: string; sessionId: string }[] = [];
    const banBites = ban.permanent || (ban.bannedUntil != null && ban.bannedUntil.getTime() > now.getTime());

    if (banBites) {
      // Scoped to THIS club: banned_until lives on the membership, so a ban here
      // says nothing about the member's standing at another club.
      const bounds = [
        eq(bookings.userId, row.userId),
        eq(bookings.clubId, input.clubId),
        inArray(bookings.status, [...ACTIVE]),
        gt(slots.startAt, now),
      ];
      // A ban ending Wednesday must not take away next Monday's seat — the member
      // would be free to book it again the moment the ban lifts.
      if (!ban.permanent) bounds.push(lt(slots.startAt, ban.bannedUntil!));

      const future = await tx
        .select({ bookingId: bookings.id, sessionId: bookings.sessionId, capacity: sessions.capacity, slotStartAt: slots.startAt })
        .from(bookings)
        .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
        .innerJoin(slots, eq(slots.id, sessions.slotId))
        .where(and(...bounds))
        .orderBy(asc(slots.startAt), asc(bookings.id));

      for (const f of future) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.clubId}), hashtext(${f.slotStartAt.toISOString()}))`);
        await tx.update(bookings).set({ status: 'cancelled', queuePosition: null }).where(eq(bookings.id, f.bookingId));
        const { promotedUserId } = await applySeating(tx, f.sessionId, f.capacity, row.multisportMode);
        cancelled.push({ bookingId: f.bookingId, sessionId: f.sessionId });
        if (promotedUserId) promoted.push({ userId: promotedUserId, sessionId: f.sessionId });
      }
    }

    return { ok: true, bannedUntil: ban.bannedUntil, permanent: ban.permanent, alreadyLapsed, cancelled, promoted };
  });
}
