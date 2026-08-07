import { sql } from 'drizzle-orm';
import {
boolean, date, index,
integer,   pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { clubs, memberships } from './clubs';
import { bookingSourceEnum, bookingStatusEnum, paymentTypeEnum } from './enums';
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
  },
  (t) => [uniqueIndex('penalties_booking_uq').on(t.bookingId)],
);
