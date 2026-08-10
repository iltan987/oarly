'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { isDateISO } from '@/lib/date-iso';
import { clearDateOverride, setDateOverride } from '@/lib/date-overrides';
import { requireOwner } from '@/lib/membership';
import { dateOverrideSchema } from '@/lib/schemas';

import type { ManageActionResult } from '../../action-result';

/**
 * Both actions below bind a form-supplied date into a `date` column, so both guard
 * before the query. What the guards could NOT do while these returned `void` is tell
 * the owner: a refused date left the calendar exactly as it was, with no toast and no
 * explanation, so a malformed override was indistinguishable from one that applied.
 * `ManageActionResult` is what makes the refusal sayable.
 */
export async function setOverrideAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club, user } = await requireOwner(slug, '/manage/schedule');
  const parsed = dateOverrideSchema.safeParse({
    dateISO: formData.get('dateISO'),
    isOpen: formData.get('isOpen') === 'open',
  });
  if (!parsed.success) return { ok: false };
  await setDateOverride(db, club.id, parsed.data, user.id);
  revalidatePath(`/s/${slug}/manage/schedule/preview`);
  return { ok: true };
}

export async function clearOverrideAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club, user } = await requireOwner(slug, '/manage/schedule');
  const dateISO = String(formData.get('dateISO') ?? '');
  // Validity, not shape: `date_overrides.date` is a `date` column, so `2026-02-31`
  // reached it as a 22008 that escaped this action to the error boundary.
  if (!isDateISO(dateISO)) return { ok: false };
  await clearDateOverride(db, club.id, dateISO, user.id);
  revalidatePath(`/s/${slug}/manage/schedule/preview`);
  return { ok: true };
}
