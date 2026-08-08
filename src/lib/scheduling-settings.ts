import { and, eq } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, clubs } from '@/db/schema';
import { logAudit } from '@/lib/audit';

export interface SchedulingSettingsInput {
  bookingOpenMode: 'always' | 'lead';
  bookingOpenLeadDays: number | null;
  selfCancelEnabled: boolean;
  cancelCutoffHours: number | null;
  noshowPenalty: 'off' | '2d' | '1w' | '2w' | '1m' | 'never';
  multisportMode: 'equal' | 'priority';
  multisportEnabled: boolean;
  openOnHolidays: boolean;
  waitlistCapacity: number | null;
}
export type SchedulingResult =
  | { ok: true; convertedBoats: number }
  | { ok: false; error: 'invalid_lead' };

export async function getSchedulingSettings(db: DB, clubId: string): Promise<SchedulingSettingsInput> {
  const [c] = await db
    .select({
      bookingOpenMode: clubs.bookingOpenMode,
      bookingOpenLeadDays: clubs.bookingOpenLeadDays,
      selfCancelEnabled: clubs.selfCancelEnabled,
      cancelCutoffHours: clubs.cancelCutoffHours,
      noshowPenalty: clubs.noshowPenalty,
      multisportMode: clubs.multisportMode,
      multisportEnabled: clubs.multisportEnabled,
      openOnHolidays: clubs.openOnHolidays,
      waitlistCapacity: clubs.waitlistCapacity,
    })
    .from(clubs)
    .where(eq(clubs.id, clubId))
    .limit(1);
  if (!c) throw new Error(`club ${clubId} not found`);
  return c;
}

/**
 * Unlike every other mutation in this module's neighbours, this one has no
 * "row not found" branch: the UPDATE below matches zero rows for an unknown
 * `clubId` and says nothing about it. Since the audit row was added, such a call
 * **throws** rather than returning `{ ok: true }` — `audit_log.club_id` is a real
 * foreign key to `clubs.id`, so the audit insert fails and takes the whole
 * transaction with it.
 *
 * That is the safe direction (a settings change for a club that does not exist
 * can never commit unattributed), and it is unreachable in production because
 * `requireOwner` has already loaded a live club. It is documented and pinned by a
 * test rather than "fixed" into a typed error, because the throw is a genuine
 * invariant violation, not an expected outcome the caller should branch on.
 */
export async function updateSchedulingSettings(
  db: DB,
  clubId: string,
  input: SchedulingSettingsInput,
  actorId: string,
): Promise<SchedulingResult> {
  if (input.bookingOpenMode === 'lead' && (input.bookingOpenLeadDays === null || input.bookingOpenLeadDays < 1)) {
    return { ok: false, error: 'invalid_lead' };
  }
  return db.transaction(async (tx) => {
    await tx
      .update(clubs)
      .set({
        bookingOpenMode: input.bookingOpenMode,
        bookingOpenLeadDays: input.bookingOpenMode === 'lead' ? input.bookingOpenLeadDays : null,
        selfCancelEnabled: input.selfCancelEnabled,
        cancelCutoffHours: input.cancelCutoffHours,
        noshowPenalty: input.noshowPenalty,
        multisportMode: input.multisportMode,
        multisportEnabled: input.multisportEnabled,
        openOnHolidays: input.openOnHolidays,
        waitlistCapacity: input.waitlistCapacity,
      })
      .where(eq(clubs.id, clubId));

    // Disabling MultiSport must not strand a boat with no valid payment type
    // left: convert this club's multisport_only boats to regular_only in the
    // same transaction as the flag write. `both` needs no change — it already
    // permits cash. Re-enabling does not convert them back (see spec §5.2/§5.3).
    let convertedBoats = 0;
    if (!input.multisportEnabled) {
      const result = await tx
        .update(boatTypes)
        .set({ allowedPayment: 'regular_only' })
        .where(and(eq(boatTypes.clubId, clubId), eq(boatTypes.allowedPayment, 'multisport_only')));
      convertedBoats = result.rowCount ?? 0;
    }

    // Inside the existing transaction: these policies bind every member of the
    // club, so the record of who changed them commits with the change (spec §4.3).
    await logAudit(tx, { actorUserId: actorId, clubId, action: 'club.policies_update', target: clubId, actingAsRole: 'owner' });
    return { ok: true, convertedBoats };
  });
}
