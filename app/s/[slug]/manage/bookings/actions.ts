'use server';
import { revalidatePath } from 'next/cache';
import * as z from 'zod';

import { db } from '@/db';
import { ownerAddBooking, ownerRemoveBooking } from '@/lib/booking';
import { requireOwner } from '@/lib/membership';
import { notifyBookingConfirmation, notifyOwnerRemoval, notifyWaitlistPromotion } from '@/lib/notify';

import type { ManageActionResult } from '../action-result';

const removeSchema = z.object({ bookingId: z.uuid() });
const addSchema = z.object({
  windowId: z.uuid(),
  boatTypeId: z.uuid(),
  startAt: z.iso.datetime(),
  userId: z.string().min(1),
  paymentType: z.enum(['regular', 'multisport']),
});

export async function ownerRemoveBookingAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug, '/manage/bookings');
  const parsed = removeSchema.safeParse({ bookingId: formData.get('bookingId') });
  if (!parsed.success) return { ok: false };
  const result = await ownerRemoveBooking(db, { clubId: club.id, bookingId: parsed.data.bookingId });
  if (!result.ok) return { ok: false };
  revalidatePath(`/s/${slug}/manage/bookings`);
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);
  await notifyOwnerRemoval(db, { bookingId: parsed.data.bookingId });
  if (result.promoted) await notifyWaitlistPromotion(db, result.promoted);
  return { ok: true };
}

export async function ownerAddBookingAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug, '/manage/bookings');
  const parsed = addSchema.safeParse({
    windowId: formData.get('windowId'),
    boatTypeId: formData.get('boatTypeId'),
    startAt: formData.get('startAt'),
    userId: formData.get('userId'),
    paymentType: formData.get('paymentType'),
  });
  if (!parsed.success) return { ok: false };
  const result = await ownerAddBooking(db, { clubId: club.id, windowId: parsed.data.windowId, boatTypeId: parsed.data.boatTypeId, startAt: new Date(parsed.data.startAt), userId: parsed.data.userId, paymentType: parsed.data.paymentType });
  if (!result.ok) return { ok: false };
  revalidatePath(`/s/${slug}/manage/bookings`);
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);
  await notifyBookingConfirmation(db, { bookingId: result.bookingId });
  return { ok: true };
}
