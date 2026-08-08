import type { DbOrTx } from '@/db';
import { auditLog } from '@/db/schema';

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
