import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { clubs } from './clubs';
import { sessions } from './schedule';
import { membershipRoleEnum, notificationTypeEnum } from './enums';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    type: notificationTypeEnum('type').notNull(),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notifications_idem_uq').on(t.userId, t.type, t.sessionId)],
);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
  actingAsRole: membershipRoleEnum('acting_as_role'),
  clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  target: text('target'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
