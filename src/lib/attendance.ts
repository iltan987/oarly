import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';

import type { DB } from '@/db';
import { bookings, clubs, memberships, penalties, sessions, slots } from '@/db/schema';
import { logAudit } from '@/lib/audit';

import { applySeating, type Tx } from './booking';
import { penaltyEndsAt, resolveBan } from './penalty';
import { isUniqueViolation } from './pg-errors';

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

  // Only ever move status between 'approved' and 'banned', and only when the
  // membership is currently in one of those two states. Writing 'banned'
  // unconditionally would ban a rejected/pending membership; writing 'approved'
  // unconditionally on ban-lift would resurrect it.
  const status: 'banned' | 'approved' | undefined =
    currentStatus !== 'approved' && currentStatus !== 'banned' ? undefined
    : ban.permanent ? 'banned'
    : currentStatus === 'banned' ? 'approved'
    : undefined;
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
export async function markNoShow(db: DB, input: { clubId: string; bookingId: string; actorId: string; now?: Date }): Promise<MarkNoShowResult> {
  const now = input.now ?? new Date();
  try {
    return await markNoShowTx(db, input, now);
  } catch (err) {
    // The already_marked guard above handles the ordinary case; this is the
    // genuine race two concurrent marks of the same booking can hit between
    // their check and their insert.
    if (isUniqueViolation(err, 'penalties_booking_uq')) return { ok: false, error: 'already_marked' };
    throw err;
  }
}

async function markNoShowTx(db: DB, input: { clubId: string; bookingId: string; actorId: string }, now: Date): Promise<MarkNoShowResult> {
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

    // Same per-slot lock every other seat mutation in this repo takes, so a
    // concurrent owner action on this same (already-started) session — e.g.
    // ownerRemoveBooking on a different attendee — can't race the no_show
    // write and revert it via a stale applySeating re-evaluation. Safe to take
    // first here: the missed slot has already started (startAt <= now) while
    // every cascade slot below is strictly in the future, so ascending order
    // is preserved.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.clubId}), hashtext(${row.slotStartAt.toISOString()}))`);

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
        // The one cancellation the member did not ask for and cannot otherwise account
        // for: `cancelledReason` is what lets their bookings list say so instead of
        // showing a bare "İptal edildi" next to seats they still expected to row.
        //
        // Status-scoped, and here the predicate matters MOST. `future` was SELECTed above,
        // BEFORE any of these per-slot locks were taken, so between that read and this
        // write the member may have cancelled this very seat themselves. Under READ
        // COMMITTED a bare `eq(id, …)` would re-evaluate against the committed row and
        // still match — relabelling a voluntary cancellation as 'penalty', so the member's
        // bookings list tells them "Katılmadığın kaydedildiği için iptal edildi" about a
        // seat they gave up of their own accord. That is the accusation this whole slice
        // exists to avoid making.
        const [claimed] = await tx.update(bookings)
          .set({ status: 'cancelled', cancelledReason: 'penalty', queuePosition: null })
          .where(and(eq(bookings.id, f.bookingId), inArray(bookings.status, [...ACTIVE])))
          .returning({ id: bookings.id });
        // Somebody else ended this seat first. They held this same lock to do it, so their
        // `applySeating` has already run; re-running it would be a no-op and counting the
        // seat in `cancelled` would overstate the cascade in the member's penalty email.
        if (!claimed) continue;
        const { promotedUserId } = await applySeating(tx, f.sessionId, f.capacity, row.multisportMode);
        cancelled.push({ bookingId: f.bookingId, sessionId: f.sessionId });
        if (promotedUserId) promoted.push({ userId: promotedUserId, sessionId: f.sessionId });
      }
    }

    // Success path only: every early `return { ok: false, … }` above leaves no
    // audit row, and this insert shares the transaction so the absence and its
    // record commit together or not at all (spec §4.3).
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: 'attendance.noshow',
      target: input.bookingId,
      actingAsRole: 'owner',
    });

    return { ok: true, bannedUntil: ban.bannedUntil, permanent: ban.permanent, alreadyLapsed, cancelled, promoted };
  });
}

export type UndoNoShowResult =
  | { ok: true; bannedUntil: Date | null; permanent: boolean }
  | { ok: false; error: 'not_found' | 'not_marked' | 'restore_conflict' };

/**
 * Reverse a mistaken absence.
 *
 * Restores the booking, deletes its penalty row and recomputes the ban from
 * whatever remains — which may lift it, or may not, if another absence still
 * stands. Because `resolveBan` is a plain max, that recomputation needs no
 * replay of the order penalties were applied in.
 *
 * Seats the cascade cancelled are NOT restored: a promoted waitlister may now
 * genuinely hold that seat, and evicting them to repair the owner's slip only
 * moves the injustice. The owner re-seats by hand from the Bookings view.
 */
export async function undoNoShow(db: DB, input: { clubId: string; bookingId: string; actorId: string }): Promise<UndoNoShowResult> {
  try {
    return await undoNoShowTx(db, input);
  } catch (err) {
    // Restoring the booking can collide with another multisport booking the
    // member acquired for that same day while this one sat marked absent, or
    // (backstop for the in-transaction guard above, under true concurrency)
    // with another active row this member or someone else now holds in the
    // same session.
    if (isUniqueViolation(err, 'bookings_multisport_day_uq') || isUniqueViolation(err, 'bookings_active_uq')) {
      return { ok: false, error: 'restore_conflict' };
    }
    throw err;
  }
}

async function undoNoShowTx(db: DB, input: { clubId: string; bookingId: string; actorId: string }): Promise<UndoNoShowResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: bookings.id, userId: bookings.userId, clubId: bookings.clubId, status: bookings.status, sessionId: bookings.sessionId, slotStartAt: slots.startAt, capacity: sessions.capacity })
      .from(bookings)
      .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
      .innerJoin(slots, eq(slots.id, sessions.slotId))
      .where(eq(bookings.id, input.bookingId));
    if (!row || row.clubId !== input.clubId || !row.userId) return { ok: false, error: 'not_found' };
    if (row.status !== 'no_show') return { ok: false, error: 'not_marked' };

    const [membership] = await tx
      .select({ id: memberships.id, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.userId, row.userId), eq(memberships.clubId, input.clubId)));
    if (!membership) return { ok: false, error: 'not_found' };

    // Same per-slot advisory lock every other seat mutation on this session
    // takes (markNoShow, cancelBooking, ownerRemoveBooking): restoring this
    // booking to 'booked' changes the session's active count, and a concurrent
    // ownerRemoveBooking on another attendee of the same session calls
    // applySeating, which reads that count. Without the lock the two could
    // interleave — applySeating reading a stale count, or racing the write
    // back to 'booked' — the exact hazard markNoShow's own comment calls out
    // for its slot lock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.clubId}), hashtext(${row.slotStartAt.toISOString()}))`);

    // Re-validate before restoring: between the mark and this undo, an owner may
    // have seated someone else into the freed seat (ownerAddBooking waives the
    // booking-open gate, and bounds capacity on 'booked' rows only — the same
    // count as THIS function's capacity check below, not the ACTIVE set its
    // duplicate-row check uses; see the two-counts note) or the
    // waitlist may have been promoted into it (a second absence + removal can
    // empty a session and applySeating fills it — the removal path, not the
    // owner add, which promotes nobody). Either way the seat this
    // booking used to hold may no longer be free, or the member may already
    // hold a fresh active row here (the owner re-seating "the same person,
    // wrong row"). resolveSeating's sticky rule never demotes a booked row to
    // make room, so restoring unconditionally would either over-seat the
    // session or collide with `bookings_active_uq` — the latter is also
    // guarded as a backstop in the catch below.
    //
    // Two different counts, deliberately: the duplicate-row check considers
    // 'booked' AND 'waitlisted' together, because either would collide with
    // `bookings_active_uq` on restore. The capacity check counts 'booked'
    // ONLY — `capacity` bounds seated rows, not the queue behind them (that is
    // `resolveSeating`'s job), so a waitlisted row sitting alongside the freed
    // seat is not a reason to refuse the restore.
    const activeInSession = await tx
      .select({ id: bookings.id, userId: bookings.userId, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.sessionId, row.sessionId), inArray(bookings.status, [...ACTIVE])));
    const memberHasOtherActiveRow = activeInSession.some((a) => a.userId === row.userId && a.id !== row.id);
    const bookedCount = activeInSession.filter((a) => a.status === 'booked').length;
    if (memberHasOtherActiveRow || bookedCount >= row.capacity) {
      return { ok: false, error: 'restore_conflict' };
    }

    await tx.update(bookings).set({ status: 'booked' }).where(eq(bookings.id, row.id));
    await tx.delete(penalties).where(and(eq(penalties.bookingId, row.id), eq(penalties.membershipId, membership.id)));

    const ban = await recomputeBan(tx, membership.id, membership.status);

    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: 'attendance.noshow_undo',
      target: input.bookingId,
      actingAsRole: 'owner',
    });

    return { ok: true, bannedUntil: ban.bannedUntil, permanent: ban.permanent };
  });
}
