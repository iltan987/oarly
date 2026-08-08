'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { createWindow, deleteWindow, updateWindow, type WindowError } from '@/lib/schedule';
import { windowSchema } from '@/lib/schemas';
import { isUuid } from '@/lib/uuid';

export type WindowFormState = { status: 'idle' | 'ok' | 'error'; error: WindowError | null };

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/schedule`);
  revalidatePath(`/s/${slug}/manage`);
}

export async function saveWindowAction(slug: string, _prev: WindowFormState, formData: FormData): Promise<WindowFormState> {
  const { club, user } = await requireOwner(slug, '/manage/schedule');
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
  // Absent/empty means "create" — the field is only rendered when editing, so those
  // semantics are unchanged. PRESENT means "update THIS window", and that id is bound
  // into a `uuid` column, so a malformed one is a refusal rather than a silent create
  // of a second window.
  const windowId = String(formData.get('windowId') ?? '');
  if (windowId !== '' && !isUuid(windowId)) return { status: 'error', error: null };
  const result = windowId
    ? await updateWindow(db, { clubId: club.id, windowId, actorId: user.id, ...parsed.data })
    : await createWindow(db, club.id, parsed.data, user.id);
  if (!result.ok) return { status: 'error', error: result.error };
  refresh(slug);
  return { status: 'ok', error: null };
}

/**
 * Returns `void`, so it has no error contract at all: the form that drives it cannot
 * be told anything went wrong. That makes the guard below the ONLY thing between a
 * malformed `windowId` and a 22P02 escaping to the error boundary, taking the page
 * and any unsaved edits with it. (Widening this to `ManageActionResult` is worth
 * doing and is not this fix.)
 */
export async function deleteWindowAction(slug: string, formData: FormData): Promise<void> {
  const { club, user } = await requireOwner(slug, '/manage/schedule');
  const windowId = String(formData.get('windowId'));
  if (!isUuid(windowId)) return;
  await deleteWindow(db, { clubId: club.id, windowId, actorId: user.id });
  refresh(slug);
}
