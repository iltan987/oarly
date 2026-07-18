'use server';
import { revalidatePath } from 'next/cache';
import * as z from 'zod';

import { db } from '@/db';
import { cancelBooking } from '@/lib/booking';
import { requireMember } from '@/lib/membership';

export type CancelFormState = { status: 'idle' | 'ok' | 'error'; error: string | null };

const cancelSchema = z.object({ bookingId: z.uuid() });

export async function cancelBookingAction(slug: string, _prev: CancelFormState, formData: FormData): Promise<CancelFormState> {
  const { club, user } = await requireMember(slug, '/bookings');
  const parsed = cancelSchema.safeParse({ bookingId: formData.get('bookingId') });
  if (!parsed.success) return { status: 'error', error: 'generic' };
  const result = await cancelBooking(db, { clubId: club.id, userId: user.id, bookingId: parsed.data.bookingId });
  if (!result.ok) return { status: 'error', error: result.error };
  revalidatePath(`/s/${slug}/bookings`);
  revalidatePath(`/s/${slug}/book`);
  return { status: 'ok', error: null };
}
