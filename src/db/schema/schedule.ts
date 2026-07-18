import {
  boolean, date, index, integer, pgTable, time, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

import { boatTypes } from './boats';
import { clubs } from './clubs';
import { sessionStatusEnum, slotStatusEnum } from './enums';

export const scheduleWindows = pgTable('schedule_windows', {
  id: uuid('id').defaultRandom().primaryKey(),
  clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  weekday: integer('weekday').notNull(), // 0 = Sunday … 6 = Saturday
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  defaultSessionMinutes: integer('default_session_minutes').notNull(),
});

export const windowBoats = pgTable('window_boats', {
  id: uuid('id').defaultRandom().primaryKey(),
  windowId: uuid('window_id').notNull().references(() => scheduleWindows.id, { onDelete: 'cascade' }),
  boatTypeId: uuid('boat_type_id').notNull().references(() => boatTypes.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull().default(1),
});

export const slots = pgTable(
  'slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    fromWindowId: uuid('from_window_id').references(() => scheduleWindows.id, { onDelete: 'set null' }),
    status: slotStatusEnum('status').notNull().default('scheduled'),
  },
  (t) => [
    uniqueIndex('slots_club_start_uq').on(t.clubId, t.startAt),
    index('slots_status_idx').on(t.status),
  ],
);

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  slotId: uuid('slot_id').notNull().references(() => slots.id, { onDelete: 'cascade' }),
  clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  boatTypeId: uuid('boat_type_id').notNull().references(() => boatTypes.id, { onDelete: 'restrict' }),
  capacity: integer('capacity').notNull(),
  minAttendance: integer('min_attendance'),
  status: sessionStatusEnum('status').notNull().default('open'),
  isOverride: boolean('is_override').notNull().default(false),
});
