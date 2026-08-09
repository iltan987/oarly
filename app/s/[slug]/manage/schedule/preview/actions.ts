'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { isDateISO } from '@/lib/date-iso';
import { clearDateOverride, setDateOverride } from '@/lib/date-overrides';
import { requireOwner } from '@/lib/membership';
import { dateOverrideSchema } from '@/lib/schemas';

export async function setOverrideAction(slug: string, formData: FormData): Promise<void> {
  const { club, user } = await requireOwner(slug, '/manage/schedule');
  const parsed = dateOverrideSchema.safeParse({
    dateISO: formData.get('dateISO'),
    isOpen: formData.get('isOpen') === 'open',
  });
  if (!parsed.success) return;
  await setDateOverride(db, club.id, parsed.data, user.id);
  revalidatePath(`/s/${slug}/manage/schedule/preview`);
}

export async function clearOverrideAction(slug: string, formData: FormData): Promise<void> {
  const { club, user } = await requireOwner(slug, '/manage/schedule');
  const dateISO = String(formData.get('dateISO') ?? '');
  // Validity, not shape: `date_overrides.date` is a `date` column, so `2026-02-31`
  // reached it as a 22008 that escaped this action to the error boundary.
  if (!isDateISO(dateISO)) return;
  await clearDateOverride(db, club.id, dateISO, user.id);
  revalidatePath(`/s/${slug}/manage/schedule/preview`);
}
