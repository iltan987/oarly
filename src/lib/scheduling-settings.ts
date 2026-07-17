import { eq } from 'drizzle-orm';

import type { DB } from '@/db';
import { clubs } from '@/db/schema';

export interface SchedulingSettingsInput {
  bookingOpenMode: 'always' | 'lead';
  bookingOpenLeadDays: number | null;
  selfCancelEnabled: boolean;
  cancelCutoffHours: number | null;
  noshowPenalty: 'off' | '2d' | '1w' | '2w' | '1m' | 'never';
  multisportMode: 'equal' | 'priority';
  openOnHolidays: boolean;
}
export type SchedulingResult = { ok: true } | { ok: false; error: 'invalid_lead' };

export async function getSchedulingSettings(db: DB, clubId: string): Promise<SchedulingSettingsInput> {
  const [c] = await db
    .select({
      bookingOpenMode: clubs.bookingOpenMode,
      bookingOpenLeadDays: clubs.bookingOpenLeadDays,
      selfCancelEnabled: clubs.selfCancelEnabled,
      cancelCutoffHours: clubs.cancelCutoffHours,
      noshowPenalty: clubs.noshowPenalty,
      multisportMode: clubs.multisportMode,
      openOnHolidays: clubs.openOnHolidays,
    })
    .from(clubs)
    .where(eq(clubs.id, clubId))
    .limit(1);
  if (!c) throw new Error(`club ${clubId} not found`);
  return c;
}

export async function updateSchedulingSettings(db: DB, clubId: string, input: SchedulingSettingsInput): Promise<SchedulingResult> {
  if (input.bookingOpenMode === 'lead' && (input.bookingOpenLeadDays === null || input.bookingOpenLeadDays < 1)) {
    return { ok: false, error: 'invalid_lead' };
  }
  await db
    .update(clubs)
    .set({
      bookingOpenMode: input.bookingOpenMode,
      bookingOpenLeadDays: input.bookingOpenMode === 'lead' ? input.bookingOpenLeadDays : null,
      selfCancelEnabled: input.selfCancelEnabled,
      cancelCutoffHours: input.cancelCutoffHours,
      noshowPenalty: input.noshowPenalty,
      multisportMode: input.multisportMode,
      openOnHolidays: input.openOnHolidays,
    })
    .where(eq(clubs.id, clubId));
  return { ok: true };
}
