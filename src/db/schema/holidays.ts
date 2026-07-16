import { boolean, date, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { clubs } from './clubs';
import { holidaySourceEnum, holidayStatusEnum } from './enums';

export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    date: date('date').notNull(),
    name: text('name').notNull(),
    source: holidaySourceEnum('source').notNull().default('auto'),
    status: holidayStatusEnum('status').notNull().default('pending'),
    year: integer('year').notNull(),
  },
  (t) => [uniqueIndex('holidays_date_name_uq').on(t.date, t.name)],
);

export const clubHolidayOverrides = pgTable(
  'club_holiday_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    isOpen: boolean('is_open').notNull(),
  },
  (t) => [uniqueIndex('club_holiday_overrides_club_date_uq').on(t.clubId, t.date)],
);
