'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { createWindow, deleteWindow, updateWindow, type WindowError } from '@/lib/schedule';
import { windowSchema } from '@/lib/schemas';
import { isUuid } from '@/lib/uuid';

import type { ManageActionResult } from '../action-result';

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
 * The `isUuid` guard is what keeps a malformed `windowId` from reaching a `uuid` bind
 * as a 22P02 that escapes to the error boundary, taking the page and any unsaved edits
 * with it. Returning `ManageActionResult` is what lets the form SAY so: a refusal now
 * reaches `useActionState` as `{ ok: false }` instead of being indistinguishable from
 * a delete that worked.
 *
 * `deleteWindow` returning false is the same class of thing — the row was already gone
 * (another tab, another owner), so nothing was deleted and no audit row was written.
 * That is a failure the owner must see, and a `void` return could not express it.
 *
 * It STILL refreshes, though, and the ordering below is deliberate. The phantom row is
 * on the owner's screen right now; the toast says "try again"; and trying again calls
 * `deleteWindow` on the same missing row, gets false, and says "try again" once more —
 * an unrecoverable loop that only a manual reload breaks. Revalidating first makes the
 * retry the copy asks for a retry that can actually succeed: the row leaves, and the
 * refusal is reported once. Only the malformed-id guard skips the refresh, because
 * nothing on screen is stale in that case.
 */
export async function deleteWindowAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club, user } = await requireOwner(slug, '/manage/schedule');
  const windowId = String(formData.get('windowId'));
  if (!isUuid(windowId)) return { ok: false };
  const deleted = await deleteWindow(db, { clubId: club.id, windowId, actorId: user.id });
  refresh(slug);
  return deleted ? { ok: true } : { ok: false };
}
