'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import * as z from 'zod';

import { db } from '@/db';
import { cancelBooking } from '@/lib/booking';
import { requireMemberView } from '@/lib/membership';
import { notifyBookingCancellation, notifyWaitlistPromotion } from '@/lib/notify';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { enforceRateLimit } from '@/lib/rate-limit-guard';
import { getClientIp } from '@/lib/request-ip';

export type CancelFormState = { status: 'idle' | 'ok' | 'error'; error: string | null };

const cancelSchema = z.object({ bookingId: z.uuid() });

export async function cancelBookingAction(slug: string, _prev: CancelFormState, formData: FormData): Promise<CancelFormState> {
  // A ban gates acquisition, not release: a seat that falls after the ban ends
  // survives the penalty cascade, and its holder must still be able to cancel it.
  const { club, user } = await requireMemberView(slug, '/bookings');

  // Deliberately the SAME bucket family as booking. §17 says "booking submit", but a
  // cancel/rebook loop is the same abuse surface — each cycle re-runs the seating
  // recompute and can fire a waitlist-promotion email — and separate buckets would hand
  // an attacker 20/min by alternating between the two actions.
  const ip = await getClientIp();
  const verdict = await enforceRateLimit([
    { key: `book:acct:${user.id}`, rule: RATE_LIMITS.bookingPerAccount },
    { key: `book:ip:${ip}`, rule: RATE_LIMITS.bookingPerIp },
  ]);
  if (verdict.limited) return { status: 'error', error: 'rate_limited' };

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
