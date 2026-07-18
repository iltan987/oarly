import { and, eq, sql } from 'drizzle-orm';

import type { DB } from '@/db';
import { sessions, slots } from '@/db/schema';

export type MaterializeInput = {
  clubId: string;
  dateISO: string;
  startAt: Date;
  endAt: Date;
  windowId: string;
  boats: { boatTypeId: string; capacity: number; minAttendance: number | null; quantity: number }[];
};
export type MaterializedSlot = { slotId: string; sessions: { id: string; boatTypeId: string }[] };

/**
 * Find-or-create the slot for one concrete time-block plus its full session set.
 * Race-safe: a transaction-scoped advisory lock keyed on (clubId, startAt) serializes
 * concurrent first-materializations, and the slot insert uses ON CONFLICT DO NOTHING against
 * the slots_club_start_uq unique index. Idempotent — repeated calls converge on one slot.
 * This is the seam 5C's booking action calls immediately before seating.
 */
export async function materializeSlot(db: DB, input: MaterializeInput): Promise<MaterializedSlot> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.clubId}), hashtext(${input.startAt.toISOString()}))`,
    );

    const inserted = await tx
      .insert(slots)
      .values({ clubId: input.clubId, date: input.dateISO, startAt: input.startAt, endAt: input.endAt, fromWindowId: input.windowId })
      .onConflictDoNothing({ target: [slots.clubId, slots.startAt] })
      .returning({ id: slots.id });

    if (inserted.length > 0) {
      const slotId = inserted[0].id;
      const rows = input.boats.flatMap((b) =>
        Array.from({ length: b.quantity }, () => ({
          slotId,
          clubId: input.clubId,
          boatTypeId: b.boatTypeId,
          capacity: b.capacity,
          minAttendance: b.minAttendance,
        })),
      );
      const created = await tx.insert(sessions).values(rows).returning({ id: sessions.id, boatTypeId: sessions.boatTypeId });
      return { slotId, sessions: created };
    }

    // Slot already existed (a concurrent caller won) — read it and its sessions.
    const [existing] = await tx
      .select({ id: slots.id })
      .from(slots)
      .where(and(eq(slots.clubId, input.clubId), eq(slots.startAt, input.startAt)));
    const existingSessions = await tx
      .select({ id: sessions.id, boatTypeId: sessions.boatTypeId })
      .from(sessions)
      .where(eq(sessions.slotId, existing.id));
    return { slotId: existing.id, sessions: existingSessions };
  });
}
