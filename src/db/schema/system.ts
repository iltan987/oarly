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
    /**
     * `precision: 3` — MILLISECONDS — is load-bearing, not cosmetic.
     *
     * The keyset cursor of `/admin/audit` is `{ createdAt: Date; id: string }`, and
     * a JS `Date` cannot hold anything finer than a millisecond. At the Postgres
     * default (microseconds) a row stored at `…49.748926+00` came back as
     * `…49.748Z`, so the next page's `(created_at, id) < ($ts, $id)` excluded
     * everything between `…748000` and `…748926`. Truncation only ever rounds down,
     * so nothing was ever shown twice — the rows were simply gone, permanently and
     * silently, which is the worst failure an audit log can have.
     *
     * Matching the column to the cursor makes that round-trip lossless by
     * construction: sub-millisecond siblings now share a timestamp and `id` breaks
     * the tie, which is exactly what the keyset was always documented to do.
     * Microsecond fidelity has no operational value here; reachable rows do.
     */
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    // Matches the /admin/audit keyset page exactly: `WHERE (created_at, id) < (…)`
    // ORDER BY created_at DESC, id DESC. Column order and both DESC directions are
    // load-bearing — without them Postgres sorts the whole table on every page load,
    // and this table only ever grows (26 mutations write to it as of this cycle).
    // `id` is in the key because it breaks ties inside a single millisecond; a
    // created_at-only index would let the tiebreak fall back to a sort.
    //
    // `nullsFirst()` is not decoration. Drizzle's `.desc()` alone emits
    // `DESC NULLS LAST`, while `orderBy(desc(...))` emits a bare `DESC`, whose
    // Postgres default is NULLS FIRST. The two do not match, so the planner cannot
    // use the index for ordering and puts a Sort over the entire scan — measured on
    // this database as `Sort -> Bitmap Index Scan` where the query with the nulls
    // clause spelled out gives a plain `Index Only Scan`. That sort is precisely
    // the O(n) work the index exists to remove.
    index('audit_log_created_at_id_idx').on(t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    // The club-scoped browse. With only the index above, `club_id` is applied as a
    // post-index Filter: the scan walks the whole log from the head until it has
    // accumulated a page's worth of matches, so a low-volume club's history costs a
    // near-full pass. Leading with `club_id` turns that into an Index Cond. This is
    // the hot path for the club detail page, which asks for one club's last 20 rows
    // on every load.
    index('audit_log_club_created_at_id_idx').on(t.clubId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
  ],
);
