'use server';
import { and, eq, ilike, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import * as z from 'zod';

import { db } from '@/db';
import { memberships, user } from '@/db/schema';
import { ownerAddBooking, type OwnerAddResult, ownerRemoveBooking } from '@/lib/booking';
import { requireOwner } from '@/lib/membership';
import { notifyBookingConfirmation, notifyOwnerRemoval, notifyWaitlistPromotion } from '@/lib/notify';
import { restrictionState } from '@/lib/restriction';
import { escapeLike } from '@/lib/search-params';

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
  const like = `%${escapeLike(q)}%`;
  const now = new Date();
  const rows = await db
    // `status` is selected as well as filtered on, so the row handed to
    // `restrictionState` is a real membership rather than one with `'approved'` written
    // in by hand — a synthesised field is exactly how a shared predicate stops meaning
    // what it says.
    .select({ userId: memberships.userId, name: user.name, email: user.email, phone: user.phone, status: memberships.status, bannedUntil: memberships.bannedUntil })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(
      eq(memberships.clubId, club.id),
      eq(memberships.status, 'approved'),
      or(ilike(user.name, like), ilike(user.email, like), ilike(user.phone, like)),
    ))
    .orderBy(user.name)
    .limit(20);
  // This filter used to be written as the COMPLEMENT (`bannedUntil == null || <= now`),
  // which is why a grep for the ban check never found it. Same answer, stated the way
  // every other caller states it.
  return rows
    .filter((r) => restrictionState(r, now) === 'none')
    .map((r) => ({ userId: r.userId, name: r.name, email: r.email, phone: r.phone }));
}

/** Richer than ManageActionResult so the toast can distinguish a benign already-removed race from a generic error. */
export type RemoveActionResult = { ok: true } | { ok: false; error?: 'not_active' };
/**
 * Every refusal `ownerAddBooking` can name, carried through verbatim rather than
 * enumerated a second time here.
 *
 * All six describe a state of the club the owner can read and act on — the boat is full,
 * this member is already in the slot, their MultiSport day is used, their membership is
 * restricted, the session is closed. None of them is an internal failure, so none of them
 * belongs behind "bir şeyler ters gitti". Deriving the union from `OwnerAddResult` rather
 * than restating it means a refusal added to the domain layer cannot quietly acquire the
 * generic toast: it lands here, and `bookings-roster.tsx`'s message map stops compiling
 * until somebody writes copy for it.
 *
 * `error` stays optional for the one genuinely opaque case: a submission that failed schema
 * validation was never a well-formed request, and there is nothing to tell the owner about
 * it beyond that it failed.
 */
type OwnerAddRefusal = Extract<OwnerAddResult, { ok: false }>['error'];
export type OwnerAddActionResult = { ok: true } | { ok: false; error?: OwnerAddRefusal };

const removeSchema = z.object({ bookingId: z.uuid() });
const addSchema = z.object({
  windowId: z.uuid(),
  boatTypeId: z.uuid(),
  startAt: z.iso.datetime(),
  userId: z.string().min(1),
  paymentType: z.enum(['regular', 'multisport']),
});

export async function ownerRemoveBookingAction(slug: string, _prev: RemoveActionResult | null, formData: FormData): Promise<RemoveActionResult> {
  const { club, user } = await requireOwner(slug, '/manage/bookings');
  const parsed = removeSchema.safeParse({ bookingId: formData.get('bookingId') });
  if (!parsed.success) return { ok: false };
  const result = await ownerRemoveBooking(db, { clubId: club.id, bookingId: parsed.data.bookingId, actorId: user.id });
  if (!result.ok) return result.error === 'not_active' ? { ok: false, error: 'not_active' } : { ok: false };
  revalidatePath(`/s/${slug}/manage/bookings`);
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);
  // Best-effort mail, off the critical path — the removal is already committed.
  after(async () => {
    await notifyOwnerRemoval(db, { bookingId: parsed.data.bookingId });
    if (result.promoted) await notifyWaitlistPromotion(db, result.promoted);
  });
  return { ok: true };
}

export async function ownerAddBookingAction(slug: string, _prev: OwnerAddActionResult | null, formData: FormData): Promise<OwnerAddActionResult> {
  const { club, user } = await requireOwner(slug, '/manage/bookings');
  const parsed = addSchema.safeParse({
    windowId: formData.get('windowId'),
    boatTypeId: formData.get('boatTypeId'),
    startAt: formData.get('startAt'),
    userId: formData.get('userId'),
    paymentType: formData.get('paymentType'),
  });
  if (!parsed.success) return { ok: false };
  const result = await ownerAddBooking(db, { clubId: club.id, windowId: parsed.data.windowId, boatTypeId: parsed.data.boatTypeId, startAt: new Date(parsed.data.startAt), userId: parsed.data.userId, paymentType: parsed.data.paymentType, actorId: user.id });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/s/${slug}/manage/bookings`);
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);
  after(() => notifyBookingConfirmation(db, { bookingId: result.bookingId }));
  return { ok: true };
}
