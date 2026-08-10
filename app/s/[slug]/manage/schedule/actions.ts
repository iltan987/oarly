'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { createWindow, deleteWindow, updateWindow, type WindowError } from '@/lib/schedule';
import { windowSchema } from '@/lib/schemas';
import { isUuid } from '@/lib/uuid';

import type { ManageActionResult } from '../action-result';

/**
 * The three fields the owner TYPES into a window form, exactly as submitted.
 *
 * The boat rows are absent because they are React state in `window-form.tsx` (a hidden input
 * per row, driven by `rows`), and a form reset does not touch React state.
 */
export type WindowFormValues = {
  startTime: string;
  endTime: string;
  defaultSessionMinutes: string;
};

/**
 * `values` is present on every refusal for the reason `manage/action-result.ts` sets out:
 * React 19 resets an uncontrolled form after ANY completed form action, so without the echo
 * a refusal snapped `startTime`, `endTime` and `defaultSessionMinutes` back to the stored
 * window while the form stayed open showing the error.
 *
 * This form is squarely over that file's line, and by ordinary use rather than by a crafted
 * payload: `end_before_start`, `uneven_tiling` and `overlap` are all plain owner mistakes,
 * and each one destroyed all three fields at once. `<input type="time">` does not stop an end
 * before a start, and `(end - start) % defaultSessionMinutes !== 0` (`src/lib/schedule.ts:59`)
 * means an 08:00-10:00 window in 45-minute sessions — 120 minutes, which 45 does not divide —
 * is refused.
 */
export type WindowFormState = {
  status: 'idle' | 'ok' | 'error';
  error: WindowError | null;
  values?: WindowFormValues;
};

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/schedule`);
  revalidatePath(`/s/${slug}/manage`);
}

export async function saveWindowAction(slug: string, _prev: WindowFormState, formData: FormData): Promise<WindowFormState> {
  const { club, user } = await requireOwner(slug, '/manage/schedule');
  const submitted: WindowFormValues = {
    startTime: String(formData.get('startTime') ?? ''),
    endTime: String(formData.get('endTime') ?? ''),
    defaultSessionMinutes: String(formData.get('defaultSessionMinutes') ?? ''),
  };
  const refuse = (error: WindowError | null): WindowFormState => ({ status: 'error', error, values: submitted });
  const boatTypeIds = formData.getAll('boatTypeId').map(String);
  const quantities = formData.getAll('quantity').map((q) => Number(q));
  const parsed = windowSchema.safeParse({
    weekday: formData.get('weekday'),
    startTime: formData.get('startTime'),
    endTime: formData.get('endTime'),
    defaultSessionMinutes: formData.get('defaultSessionMinutes'),
    boats: boatTypeIds.map((boatTypeId, i) => ({ boatTypeId, quantity: quantities[i] })),
  });
  if (!parsed.success) return refuse(null); // null error shows the generic message
  // Absent/empty means "create" — the field is only rendered when editing, so those
  // semantics are unchanged. PRESENT means "update THIS window", and that id is bound
  // into a `uuid` column, so a malformed one is a refusal rather than a silent create
  // of a second window.
  const windowId = String(formData.get('windowId') ?? '');
  if (windowId !== '' && !isUuid(windowId)) return refuse(null);
  const result = windowId
    ? await updateWindow(db, { clubId: club.id, windowId, actorId: user.id, ...parsed.data })
    : await createWindow(db, club.id, parsed.data, user.id);
  if (!result.ok) return refuse(result.error);
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
