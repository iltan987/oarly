'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { createWindow, deleteWindow, updateWindow, type WindowError } from '@/lib/schedule';
import { windowSchema } from '@/lib/schemas';

export type WindowFormState = { status: 'idle' | 'ok' | 'error'; error: WindowError | null };

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/schedule`);
  revalidatePath(`/s/${slug}/manage`);
}

export async function saveWindowAction(slug: string, _prev: WindowFormState, formData: FormData): Promise<WindowFormState> {
  const { club } = await requireOwner(slug, '/manage/schedule');
  const boatTypeIds = formData.getAll('boatTypeId').map(String);
  const quantities = formData.getAll('quantity').map((q) => Number(q));
  const parsed = windowSchema.safeParse({
    weekday: formData.get('weekday'),
    startTime: formData.get('startTime'),
    endTime: formData.get('endTime'),
    defaultSessionMinutes: formData.get('defaultSessionMinutes'),
    boats: boatTypeIds.map((boatTypeId, i) => ({ boatTypeId, quantity: quantities[i] })),
  });
  if (!parsed.success) return { status: 'error', error: null }; // shows the generic message
  const windowId = formData.get('windowId');
  const result = windowId
    ? await updateWindow(db, { clubId: club.id, windowId: String(windowId), ...parsed.data })
    : await createWindow(db, club.id, parsed.data);
  if (!result.ok) return { status: 'error', error: result.error };
  refresh(slug);
  return { status: 'ok', error: null };
}

export async function deleteWindowAction(slug: string, formData: FormData): Promise<void> {
  const { club } = await requireOwner(slug, '/manage/schedule');
  await deleteWindow(db, { clubId: club.id, windowId: String(formData.get('windowId')) });
  refresh(slug);
}
