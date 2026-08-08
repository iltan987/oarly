import type { DbOrTx } from '@/db';
import { auditLog } from '@/db/schema';

export type ActingAsRole = 'owner' | 'member' | 'admin';

export type AuditEntry = {
  actorUserId: string;
  clubId?: string;
  action: string;
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
