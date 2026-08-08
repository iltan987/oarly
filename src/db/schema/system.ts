import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { clubs } from './clubs';
import { membershipRoleEnum, notificationTypeEnum } from './enums';
import { sessions } from './schedule';

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

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    actingAsRole: membershipRoleEnum('acting_as_role'),
    clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Matches the /admin/audit keyset page exactly: `WHERE (created_at, id) < (…)`
  // ORDER BY created_at DESC, id DESC. Column order and both DESC directions are
  // load-bearing — without them Postgres sorts the whole table on every page load,
  // and this table only ever grows (26 mutations write to it as of this cycle).
  // `id` is in the key because it breaks ties inside a single millisecond; a
  // created_at-only index would let the tiebreak fall back to a sort.
  (t) => [index('audit_log_created_at_id_idx').on(t.createdAt.desc(), t.id.desc())],
);
