import { and, desc, eq, like, type SQL, sql } from 'drizzle-orm';

import type { DbOrTx } from '@/db';
import { auditLog, clubs, user } from '@/db/schema';

export type ActingAsRole = 'owner' | 'member' | 'admin';

/**
 * The closed vocabulary of audit actions, mirroring the table in spec §4.2.
 *
 * This is a union rather than `string` so a typo is a compile error. The
 * vocabulary was previously enforced only by tests, which meant `member.aprove`
 * would compile, ship, and produce a row nobody could ever filter for — the log
 * would look healthy while quietly losing that action.
 *
 * Adding a member here is a deliberate act: it must correspond to a mutation an
 * owner or admin performs against another person, or against configuration that
 * binds other people (spec §4.2). Member self-service is never audited.
 */
export type AuditAction =
  // Membership decisions
  | 'member.approve'
  | 'member.reject'
  | 'member.skill_assign'
  // Attendance and penalties
  | 'attendance.noshow'
  | 'attendance.noshow_undo'
  // Bookings acted on by an owner
  | 'booking.owner_add'
  | 'booking.owner_remove'
  // Club configuration
  | 'club.policies_update'
  | 'club.profile_update'
  | 'boat.create'
  | 'boat.update'
  | 'boat.set_active'
  | 'skill_level.create'
  | 'skill_level.rename'
  | 'skill_level.reorder'
  | 'skill_level.delete'
  | 'window.create'
  | 'window.update'
  | 'window.delete'
  | 'date_override.set'
  | 'date_override.clear'
  // Platform admin
  | 'club.create'
  | 'club.activate'
  | 'club.suspend'
  | 'club.approve'
  | 'club.reject'
  | 'club.transfer_owner'
  | 'user.admin_grant'
  | 'user.admin_revoke';

export type AuditEntry = {
  actorUserId: string;
  clubId?: string;
  action: AuditAction;
  target?: string;
  actingAsRole?: ActingAsRole;
};

/**
 * Append one audit row. Takes `DbOrTx` so callers pass their own `tx` directly:
 * the row must commit with the mutation or not at all, and a mutation that
 * succeeded with no audit row is the exact failure an audit log exists to prevent.
 */
export async function logAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    clubId: entry.clubId ?? null,
    action: entry.action,
    target: entry.target ?? null,
    actingAsRole: entry.actingAsRole ?? null,
  });
}

export type AuditRow = {
  id: string;
  createdAt: Date;
  /**
   * Deliberately `string`, not `AuditAction`: this is what the `text` column holds.
   * Narrowing a value that came back OUT of the database to the union would be a
   * claim the database cannot make — rows written before the vocabulary closed,
   * or by a future version, must still render rather than be a lie in the types.
   * `AuditAction` remains the closed vocabulary for everything going IN.
   */
  action: string;
  /**
   * Free text holding an id — a boat id, a membership id, or (for
   * `date_override.*`) a DATE, which repeats across clubs. It is rendered
   * verbatim and never resolved; any lookup by target must also filter by
   * `clubId` or it merges two clubs' history.
   */
  target: string | null;
  actingAsRole: ActingAsRole | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  clubId: string | null;
  clubName: string | null;
};

export type AuditCursor = { createdAt: Date; id: string };
export type AuditFilters = { clubId?: string; actorUserId?: string; actionPrefix?: string };

export const AUDIT_PAGE_SIZE = 50;

/**
 * Newest-first audit page.
 *
 * Keyset, not offset: the log grows at the head, so an offset would shift every
 * page boundary between clicks and show rows twice or not at all. `(created_at, id)`
 * is a total order — `id` breaks ties inside the same millisecond.
 *
 * Both joins are LEFT joins on purpose. `actor_user_id` and `club_id` are
 * `on delete set null`, and a row whose actor or club is gone is still evidence
 * (spec §4.4). An inner join here would silently delete history.
 */
export async function listAuditRows(
  db: DbOrTx,
  opts: { filters?: AuditFilters; cursor?: AuditCursor | null; limit?: number } = {},
): Promise<{ rows: AuditRow[]; nextCursor: AuditCursor | null }> {
  const limit = opts.limit ?? AUDIT_PAGE_SIZE;
  const f = opts.filters ?? {};
  const conds: SQL[] = [];
  if (f.clubId) conds.push(eq(auditLog.clubId, f.clubId));
  if (f.actorUserId) conds.push(eq(auditLog.actorUserId, f.actorUserId));
  if (f.actionPrefix) {
    // Escape LIKE metacharacters so an operator pasting `skill_level.` gets a
    // literal match instead of a wildcard.
    const escaped = f.actionPrefix.replace(/[\\%_]/g, (c) => `\\${c}`);
    conds.push(like(auditLog.action, `${escaped}%`));
  }
  if (opts.cursor) {
    conds.push(
      sql`(${auditLog.createdAt}, ${auditLog.id}) < (${opts.cursor.createdAt}::timestamptz, ${opts.cursor.id}::uuid)`,
    );
  }

  // `limit + 1` answers "is there a next page" without a second count(*) over a
  // table that only ever grows.
  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      action: auditLog.action,
      target: auditLog.target,
      actingAsRole: auditLog.actingAsRole,
      actorUserId: auditLog.actorUserId,
      actorName: user.name,
      actorEmail: user.email,
      clubId: auditLog.clubId,
      clubName: clubs.name,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorUserId))
    .leftJoin(clubs, eq(clubs.id, auditLog.clubId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null;
  return { rows: page, nextCursor };
}
