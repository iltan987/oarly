import { boolean, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { clubs, skillLevels } from './clubs';
import { allowedPaymentEnum } from './enums';

export const boatTypes = pgTable('boat_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  seats: integer('seats').notNull(),
  minSkillLevelId: uuid('min_skill_level_id').references(() => skillLevels.id, { onDelete: 'set null' }),
  allowedPayment: allowedPaymentEnum('allowed_payment').notNull().default('both'),
  minAttendance: integer('min_attendance'),
  active: boolean('active').notNull().default(true),
});
