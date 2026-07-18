import { and, eq, sql } from 'drizzle-orm';

import type { DB } from '@/db';
import { sessions, slots } from '@/db/schema';

export type MaterializeBoat = { boatTypeId: string; capacity: number; minAttendance: number | null; quantity: number };
export type MaterializeInput = {
  clubId: string;
  dateISO: string;
  startAt: Date;
  endAt: Date;
  windowId: string;
  boats: MaterializeBoat[];
};
export type FoundSession = { id: string; boatTypeId: string; capacity: number };
export type FindOrCreateResult = { slotId: string; sessions: FoundSession[]; created: boolean };
export type MaterializedSlot = { slotId: string; sessions: { id: string; boatTypeId: string }[] };

/** The drizzle transaction handle type (first arg to `db.transaction(async (tx) => …)`). */
export type DbTx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Find-or-create the slot for one concrete block plus its full session set, INSIDE a caller's
 * transaction. Acquires a tx-scoped advisory lock keyed on (clubId, startAt) first, then inserts
 * the slot with ON CONFLICT DO NOTHING against slots_club_start_uq. The winner inserts the session
 * set (expanding quantity); a concurrent loser re-reads. Idempotent. This is the seam bookSeat
 * runs under so lock → materialize → seat all share one transaction.
 */
export async function findOrCreateSlotTx(tx: DbTx, input: MaterializeInput): Promise<FindOrCreateResult> {
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
        slotId, clubId: input.clubId, boatTypeId: b.boatTypeId, capacity: b.capacity, minAttendance: b.minAttendance,
      })),
    );
    // Guard: an empty VALUES clause throws on some drizzle versions. A boatless slot is valid
    // (just not bookable) — create it with no sessions.
    if (rows.length === 0) return { slotId, sessions: [], created: true };
    const created = await tx.insert(sessions).values(rows).returning({ id: sessions.id, boatTypeId: sessions.boatTypeId, capacity: sessions.capacity });
    return { slotId, sessions: created, created: true };
  }

  // Slot already existed (a concurrent caller won, or a prior materialization) — read it.
  const [existing] = await tx
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.clubId, input.clubId), eq(slots.startAt, input.startAt)));
  const existingSessions = await tx
    .select({ id: sessions.id, boatTypeId: sessions.boatTypeId, capacity: sessions.capacity })
    .from(sessions)
    .where(eq(sessions.slotId, existing.id));
  return { slotId: existing.id, sessions: existingSessions, created: false };
}

/**
 * Standalone find-or-create in its own transaction. Preserved for callers that only need to
 * materialize (e.g. an owner date-override in 5B). Booking uses findOrCreateSlotTx directly.
 */
export async function materializeSlot(db: DB, input: MaterializeInput): Promise<MaterializedSlot> {
  return db.transaction(async (tx) => {
    const r = await findOrCreateSlotTx(tx, input);
    return { slotId: r.slotId, sessions: r.sessions.map((s) => ({ id: s.id, boatTypeId: s.boatTypeId })) };
  });
}
