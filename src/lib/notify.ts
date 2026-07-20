import { and, eq, type SQL } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, bookings, clubs, notifications, sessions, slots, user } from '@/db/schema';
import { renderBookingCancellation, renderBookingConfirmation, renderWaitlistPromotion } from '@/emails';
import { sendEmail } from '@/lib/email';

type Ctx = {
  toEmail: string;
  locale: string;
  clubName: string;
  timezone: string;
  boatName: string;
  startAt: Date;
  endAt: Date;
  status: 'booked' | 'waitlisted' | 'cancelled' | 'no_show' | 'attended';
  queuePosition: number | null;
};

/** Join a booking to everything an email needs. Returns null if not found. */
async function loadCtx(db: DB, where: SQL): Promise<Ctx | null> {
  const [row] = await db
    .select({
      toEmail: user.email,
      locale: user.locale,
      clubName: clubs.name,
      timezone: clubs.timezone,
      boatName: boatTypes.name,
      startAt: slots.startAt,
      endAt: slots.endAt,
      status: bookings.status,
      queuePosition: bookings.queuePosition,
    })
    .from(bookings)
    .innerJoin(user, eq(user.id, bookings.userId))
    .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
    .innerJoin(slots, eq(slots.id, sessions.slotId))
    .innerJoin(clubs, eq(clubs.id, bookings.clubId))
    .innerJoin(boatTypes, eq(boatTypes.id, sessions.boatTypeId))
    .where(where);
  return row ?? null;
}

/** Best-effort: emails a booking/waitlist confirmation. Never throws. */
export async function notifyBookingConfirmation(db: DB, { bookingId }: { bookingId: string }): Promise<void> {
  try {
    const ctx = await loadCtx(db, eq(bookings.id, bookingId));
    if (!ctx) return;
    const outcome = ctx.status === 'booked' ? 'seated' : 'waitlisted';
    const email = await renderBookingConfirmation(ctx.locale, { clubName: ctx.clubName, boatName: ctx.boatName, startAt: ctx.startAt, endAt: ctx.endAt, timezone: ctx.timezone, outcome, queuePosition: ctx.queuePosition });
    await sendEmail({ to: ctx.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyBookingConfirmation failed', err);
  }
}

/** Best-effort: emails a cancellation confirmation. Never throws. */
export async function notifyBookingCancellation(db: DB, { bookingId }: { bookingId: string }): Promise<void> {
  try {
    const ctx = await loadCtx(db, eq(bookings.id, bookingId));
    if (!ctx) return;
    const email = await renderBookingCancellation(ctx.locale, { clubName: ctx.clubName, boatName: ctx.boatName, startAt: ctx.startAt, endAt: ctx.endAt, timezone: ctx.timezone });
    await sendEmail({ to: ctx.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyBookingCancellation failed', err);
  }
}

/**
 * Best-effort: emails a waitlist-promotion notice, at-most-once per (user,
 * session) via the notifications idempotency log. Never throws.
 */
export async function notifyWaitlistPromotion(db: DB, { userId, sessionId }: { userId: string; sessionId: string }): Promise<void> {
  try {
    const [logged] = await db
      .insert(notifications)
      .values({ userId, type: 'waitlist_promotion', sessionId })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!logged) return; // already sent for this (user, session)
    const ctx = await loadCtx(db, and(eq(bookings.userId, userId), eq(bookings.sessionId, sessionId), eq(bookings.status, 'booked'))!);
    if (!ctx) return;
    const email = await renderWaitlistPromotion(ctx.locale, { clubName: ctx.clubName, boatName: ctx.boatName, startAt: ctx.startAt, endAt: ctx.endAt, timezone: ctx.timezone });
    await sendEmail({ to: ctx.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyWaitlistPromotion failed', err);
  }
}
