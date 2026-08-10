import { sql } from 'drizzle-orm';
import {
boolean, date, index,
integer,   pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { clubs, memberships } from './clubs';
import { bookingCancelReasonEnum, bookingSourceEnum, bookingStatusEnum, paymentTypeEnum } from './enums';
import { sessions } from './schedule';

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    paymentType: paymentTypeEnum('payment_type').notNull(),
    status: bookingStatusEnum('status').notNull().default('booked'),
    // Why the cancellation happened, for the member's own bookings list — `status` alone
    // renders a penalty cascade and a self-cancel as the same "İptal edildi".
    //
    // NULLABLE, and with NO default, on purpose. Two populations genuinely have no
    // recorded reason: every row that predates this column, and every row that is not
    // cancelled at all. `NOT NULL DEFAULT 'member'` would fill both in with a claim —
    // it would retro-label every historical owner removal and penalty cascade as a
    // self-cancellation, inventing exactly the fact this column exists to record. The
    // UI treats 'member' and NULL identically for that reason.
    //
    // Write-once, and that is enforced rather than merely observed. Two halves:
    //
    // 1. Nothing moves a row back OUT of 'cancelled', so the value is never cleared:
    //    `applySeating` only ever reads booked/waitlisted rows, `undoNoShow` restores a
    //    'no_show' row and refuses anything else, and a re-book inserts a fresh row
    //    because `bookings_active_uq` is partial on booked/waitlisted. There is no
    //    `cancelledReason: null` write anywhere and nothing needs one.
    //
    // 2. Nothing OVERWRITES it either — but only because all three writers scope their
    //    UPDATE with `inArray(status, ACTIVE)` as well as the primary key. That is not
    //    decoration. Each writer's "still active?" guard runs on a SELECT taken before
    //    the per-slot advisory lock, and under READ COMMITTED a blocked UPDATE
    //    re-evaluates its WHERE against the newly committed row version, where a bare
    //    `eq(id, …)` would still match. Drop the status predicate from any of the three
    //    and a race between a member's own cancellation and the markNoShow cascade
    //    relabels one as the other. See the comments at those three call sites.
    //
    // Being nullable-with-no-default and being write-once are the same design: the column
    // holds a recorded fact or nothing, and never a guess.
    cancelledReason: bookingCancelReasonEnum('cancelled_reason'),
    queuePosition: integer('queue_position'),
    slotIndex: integer('slot_index'),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    source: bookingSourceEnum('source').notNull().default('member'),
    hidden: boolean('hidden').notNull().default(false),
    guestName: text('guest_name'),
    idempotencyKey: text('idempotency_key'),
    // The slot's club-local calendar day, denormalized so the MultiSport daily
    // limit can be a DB-level unique index. NOT NULL on purpose: a nullable
    // column would make the partial index silently inert (NULL-distinct) for any
    // insert path that forgot to set it.
    bookingDate: date('booking_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One active seat per user per session (guests have null user_id → not constrained).
    uniqueIndex('bookings_active_uq')
      .on(t.sessionId, t.userId)
      .where(sql`${t.status} in ('booked', 'waitlisted')`),
    // A retry with the same idempotency key never creates a second booking.
    uniqueIndex('bookings_idem_uq')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    // A MultiSport card allows one session per DAY, across every club — so this
    // index is deliberately not club-scoped. Covering `waitlisted` as well as
    // `booked` stops a member holding a waitlist spot at one club and a seat at
    // another; it also makes waitlist promotion a no-op for this index, since a
    // promoted row neither enters nor leaves the predicate.
    uniqueIndex('bookings_multisport_day_uq')
      .on(t.userId, t.bookingDate)
      .where(sql`${t.paymentType} = 'multisport' and ${t.status} in ('booked', 'waitlisted')`),
    index('bookings_session_status_idx').on(t.sessionId, t.status),
  ],
);

export const penalties = pgTable(
  'penalties',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    membershipId: uuid('membership_id').notNull().references(() => memberships.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    // The booking this penalty came from. Nullable so a future manually-issued
    // penalty (no session, no booking) still fits; the unique index tolerates
    // many nulls via NULL-distinct semantics.
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    bannedUntil: timestamp('banned_until', { withTimezone: true }),
    // A `never` penalty has no end date, which would otherwise be
    // indistinguishable from an `off`-policy row that records the absence but
    // imposes no ban. resolveBan needs to tell them apart.
    permanent: boolean('permanent').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * When an owner reversed this penalty. NULL means it still counts.
     *
     * A lift MARKS rather than deletes, and the distinction is the whole reason this
     * column exists rather than a `DELETE FROM penalties`. Reversing a suspension is
     * precisely the decision an owner is later asked to account for, and a delete erases
     * both halves of the account: what the member did, and that somebody undid it. The
     * row keeps its `reason`, its `session_id` and its `booking_id`; the audit row
     * (`member.penalty_lift`) names who lifted it and when.
     *
     * Every read that asks "is this member restricted?" must exclude these rows —
     * `recomputeBan` (`src/lib/attendance.ts`), which is what `resolveBan` folds, and
     * `getRestrictions` (`src/lib/restriction.ts`), which explains the restriction to
     * the member. A read that forgets is a lift that does not lift.
     *
     * Deliberately NOT indexed. Every read of this table is already narrowed by
     * `membership_id` through `penalties_membership_idx`, and one member's penalty rows
     * are a handful — a second index would be paid for on every mark to save nothing.
     */
    liftedAt: timestamp('lifted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('penalties_booking_uq').on(t.bookingId),
    // Every read of this table is by membership: `recomputeBan` folds one member's rows
    // after each mark/undo, and `getRestrictions` explains a restriction from them. The
    // only index before this one was on `booking_id`, so both were sequential scans.
    index('penalties_membership_idx').on(t.membershipId),
  ],
);
