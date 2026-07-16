import { auditLog } from '@/db/schema';
import type { DB } from '@/lib/membership';

export async function logAudit(
  db: DB,
  entry: { actorUserId: string; clubId?: string; action: string; target?: string; actingAsRole?: 'owner' | 'member' },
): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    clubId: entry.clubId ?? null,
    action: entry.action,
    target: entry.target ?? null,
    actingAsRole: entry.actingAsRole ?? null,
  });
}
