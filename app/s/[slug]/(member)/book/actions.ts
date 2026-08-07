'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import * as z from 'zod';

import { db } from '@/db';
import { bookSeat } from '@/lib/booking';
import { requireMember } from '@/lib/membership';
import { notifyBookingConfirmation } from '@/lib/notify';

export type BookFormState = { status: 'idle' | 'ok' | 'error'; error: string | null; outcome?: 'seated' | 'waitlisted' | null };

const bookInputSchema = z.object({
  windowId: z.uuid(),
  boatTypeId: z.uuid(),
  startAt: z.iso.datetime(),
  paymentType: z.enum(['regular', 'multisport']),
  idempotencyKey: z.string().min(8).max(100),
});

export async function bookSeatAction(slug: string, _prev: BookFormState, formData: FormData): Promise<BookFormState> {
  const { club, user } = await requireMember(slug, '/book');
  const parsed = bookInputSchema.safeParse({
    windowId: formData.get('windowId'),
    boatTypeId: formData.get('boatTypeId'),
    startAt: formData.get('startAt'),
    paymentType: formData.get('paymentType'),
    idempotencyKey: formData.get('idempotencyKey'),
  });
  if (!parsed.success) return { status: 'error', error: 'generic' };

  const result = await bookSeat(db, {
    clubId: club.id,
    userId: user.id,
    windowId: parsed.data.windowId,
    boatTypeId: parsed.data.boatTypeId,
    startAt: new Date(parsed.data.startAt),
    paymentType: parsed.data.paymentType,
    idempotencyKey: parsed.data.idempotencyKey,
  });
  if (!result.ok) return { status: 'error', error: result.error };
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);
  // The seat is already committed; the email is best-effort. Deferring it with after()
  // keeps Resend's round-trip off the critical path so the confirmation dialog closes
  // as soon as the booking lands.
  after(() => notifyBookingConfirmation(db, { bookingId: result.bookingId }));
  return { status: 'ok', error: null, outcome: result.outcome };
}
