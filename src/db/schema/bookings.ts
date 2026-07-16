import { sql } from 'drizzle-orm';
import {
boolean, index,
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
    index('bookings_session_status_idx').on(t.sessionId, t.status),
  ],
);

export const penalties = pgTable('penalties', {
  id: uuid('id').defaultRandom().primaryKey(),
  membershipId: uuid('membership_id').notNull().references(() => memberships.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  bannedUntil: timestamp('banned_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
