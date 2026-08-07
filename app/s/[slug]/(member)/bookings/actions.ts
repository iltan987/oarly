'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import * as z from 'zod';

import { db } from '@/db';
import { cancelBooking } from '@/lib/booking';
import { requireMemberView } from '@/lib/membership';
import { notifyBookingCancellation, notifyWaitlistPromotion } from '@/lib/notify';

export type CancelFormState = { status: 'idle' | 'ok' | 'error'; error: string | null };

const cancelSchema = z.object({ bookingId: z.uuid() });

export async function cancelBookingAction(slug: string, _prev: CancelFormState, formData: FormData): Promise<CancelFormState> {
  // A ban gates acquisition, not release: a seat that falls after the ban ends
  // survives the penalty cascade, and its holder must still be able to cancel it.
  const { club, user } = await requireMemberView(slug, '/bookings');
  const parsed = cancelSchema.safeParse({ bookingId: formData.get('bookingId') });
  if (!parsed.success) return { status: 'error', error: 'generic' };
  const result = await cancelBooking(db, { clubId: club.id, userId: user.id, bookingId: parsed.data.bookingId });
  if (!result.ok) return { status: 'error', error: result.error };
  revalidatePath(`/s/${slug}/bookings`);
  revalidatePath(`/s/${slug}/book`);
  // Best-effort mail, off the critical path — the cancellation is already committed.
  after(async () => {
    await notifyBookingCancellation(db, { bookingId: parsed.data.bookingId });
    if (result.promoted) await notifyWaitlistPromotion(db, result.promoted);
  });
  return { status: 'ok', error: null };
}
