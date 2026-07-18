'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { clearDateOverride, setDateOverride } from '@/lib/date-overrides';
import { requireOwner } from '@/lib/membership';
import { dateOverrideSchema } from '@/lib/schemas';

export async function setOverrideAction(slug: string, formData: FormData): Promise<void> {
  const { club } = await requireOwner(slug, '/manage/schedule');
  const parsed = dateOverrideSchema.safeParse({
    dateISO: formData.get('dateISO'),
    isOpen: formData.get('isOpen') === 'open',
  });
  if (!parsed.success) return;
  await setDateOverride(db, club.id, parsed.data);
  revalidatePath(`/s/${slug}/manage/schedule/preview`);
}

export async function clearOverrideAction(slug: string, formData: FormData): Promise<void> {
  const { club } = await requireOwner(slug, '/manage/schedule');
  const dateISO = String(formData.get('dateISO') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return;
  await clearDateOverride(db, club.id, dateISO);
  revalidatePath(`/s/${slug}/manage/schedule/preview`);
}
