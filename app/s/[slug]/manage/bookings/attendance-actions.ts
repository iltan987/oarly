'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import * as z from 'zod';

import { db } from '@/db';
import { markNoShow, undoNoShow } from '@/lib/attendance';
import { requireOwner } from '@/lib/membership';
import { notifyNoShowPenalty, notifyWaitlistPromotion } from '@/lib/notify';

/**
 * Richer than ManageActionResult so the toast can report how many seats the cascade
 * took, and — mirroring RemoveActionResult's `not_active` — so a repeat mark of an
 * already-absent booking reads as benign rather than as a generic failure.
 */
export type MarkActionResult = { ok: true; cancelled: number } | { ok: false; error?: 'already_marked' };

/** Richer than ManageActionResult so the toast can distinguish a lost-race restore from a generic error. */
export type UndoActionResult = { ok: true } | { ok: false; error?: 'restore_conflict' };

const bookingSchema = z.object({ bookingId: z.uuid() });

export async function markNoShowAction(slug: string, _prev: MarkActionResult | null, formData: FormData): Promise<MarkActionResult> {
  const { club, user } = await requireOwner(slug, '/manage/bookings');
  const parsed = bookingSchema.safeParse({ bookingId: formData.get('bookingId') });
  if (!parsed.success) return { ok: false };

  const result = await markNoShow(db, { clubId: club.id, bookingId: parsed.data.bookingId, actorId: user.id });
  if (!result.ok) return result.error === 'already_marked' ? { ok: false, error: 'already_marked' } : { ok: false };

  revalidatePath(`/s/${slug}/manage/bookings`);
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);

  // One combined notice to the penalised member — the per-seat cancellation
  // emails are deliberately suppressed on this path, because three unrelated
  // emails arriving at once read as a bug. Promoted waitlisters still get their
  // ordinary promotion mail: from their side nothing unusual happened.
  after(async () => {
    await notifyNoShowPenalty(db, { bookingId: parsed.data.bookingId, bannedUntil: result.bannedUntil, cancelledCount: result.cancelled.length });
    for (const p of result.promoted) await notifyWaitlistPromotion(db, p);
  });

  return { ok: true, cancelled: result.cancelled.length };
}

export async function undoNoShowAction(slug: string, _prev: UndoActionResult | null, formData: FormData): Promise<UndoActionResult> {
  const { club, user } = await requireOwner(slug, '/manage/bookings');
  const parsed = bookingSchema.safeParse({ bookingId: formData.get('bookingId') });
  if (!parsed.success) return { ok: false };

  const result = await undoNoShow(db, { clubId: club.id, bookingId: parsed.data.bookingId, actorId: user.id });
  if (!result.ok) return result.error === 'restore_conflict' ? { ok: false, error: 'restore_conflict' } : { ok: false };

  revalidatePath(`/s/${slug}/manage/bookings`);
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);
  return { ok: true };
}
