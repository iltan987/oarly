'use server';
import { and, eq, ilike, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import * as z from 'zod';

import { db } from '@/db';
import { memberships, user } from '@/db/schema';
import { ownerAddBooking, ownerRemoveBooking } from '@/lib/booking';
import { requireOwner } from '@/lib/membership';
import { notifyBookingConfirmation, notifyOwnerRemoval, notifyWaitlistPromotion } from '@/lib/notify';

import type { ManageActionResult } from '../action-result';

export type MemberHit = { userId: string; name: string; email: string; phone: string | null };

/**
 * Owner-only typeahead over the club's approved, non-banned members. Matches
 * name / email / phone (case-insensitive), capped — so a large club never ships
 * or renders its whole member list. `userId` is the stable pick; email + phone
 * disambiguate members who share a name.
 */
export async function searchClubMembersAction(slug: string, query: string): Promise<MemberHit[]> {
  const { club } = await requireOwner(slug, '/manage/bookings');
  const q = query.trim();
  if (q.length < 2) return [];
  // Escape LIKE wildcards in user input so `%`/`_` are matched literally.
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const now = Date.now();
  const rows = await db
    .select({ userId: memberships.userId, name: user.name, email: user.email, phone: user.phone, bannedUntil: memberships.bannedUntil })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(
      eq(memberships.clubId, club.id),
      eq(memberships.status, 'approved'),
      or(ilike(user.name, like), ilike(user.email, like), ilike(user.phone, like)),
    ))
    .orderBy(user.name)
    .limit(20);
  return rows
    .filter((r) => r.bannedUntil == null || r.bannedUntil.getTime() <= now)
    .map((r) => ({ userId: r.userId, name: r.name, email: r.email, phone: r.phone }));
}

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
