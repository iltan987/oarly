import { and, eq, type SQL } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, bookings, clubs, memberships, notifications, sessions, slots, user } from '@/db/schema';
import { renderBookingCancellation, renderBookingConfirmation, renderClubDecision, renderNoShowPenalty, renderOwnerRemoval, renderPenaltyLift, renderWaitlistPromotion } from '@/emails';
import { env } from '@/env';
import { sendEmail } from '@/lib/email';
import { clubUrl, parseAppOrigin } from '@/lib/urls';

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

/** Best-effort: emails the member that the club removed their booking. Never throws. */
export async function notifyOwnerRemoval(db: DB, { bookingId }: { bookingId: string }): Promise<void> {
  try {
    const ctx = await loadCtx(db, eq(bookings.id, bookingId));
    if (!ctx) return;
    const email = await renderOwnerRemoval(ctx.locale, { clubName: ctx.clubName, boatName: ctx.boatName, startAt: ctx.startAt, endAt: ctx.endAt, timezone: ctx.timezone });
    await sendEmail({ to: ctx.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyOwnerRemoval failed', err);
  }
}

/** Best-effort: emails the single combined no-show notice. Never throws. */
export async function notifyNoShowPenalty(
  db: DB,
  { bookingId, bannedUntil, cancelledCount }: { bookingId: string; bannedUntil: Date | null; cancelledCount: number },
): Promise<void> {
  try {
    const ctx = await loadCtx(db, eq(bookings.id, bookingId));
    if (!ctx) return;
    const email = await renderNoShowPenalty(ctx.locale, { clubName: ctx.clubName, boatName: ctx.boatName, startAt: ctx.startAt, endAt: ctx.endAt, timezone: ctx.timezone, bannedUntil, cancelledCount });
    await sendEmail({ to: ctx.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyNoShowPenalty failed', err);
  }
}

/**
 * Best-effort: tells the member their restriction is over. Never throws.
 *
 * The counterpart of `notifyNoShowPenalty`, and the reason it exists: imposing a
 * suspension mails the member, so reversing one has to as well. Without this, a member is
 * told in writing that their booking access is closed and will not reopen by itself, and
 * then it silently reopens weeks later with nothing sent — their `/book` page and the
 * `/book` tab simply come back and they find out by chance.
 *
 * Keyed on the MEMBERSHIP, not on a booking: a suspension is a fact about the membership,
 * and by the time it is lifted the session behind it may be months in the past. So this
 * does not reuse `loadCtx` — there is no booking to join through — and shares
 * `notifyClubDecision`'s shape instead: one join, the member's own `locale`, an early
 * return if the row is gone.
 *
 * CALL IT AFTER THE TRANSACTION HAS COMMITTED, from `after()`, exactly as
 * `markNoShowAction` calls `notifyNoShowPenalty`: a mail outage must not be able to roll
 * back a reinstatement (spec §5.4), and the failure it must not have is a member told
 * they can book again while the lift is rolled back under them.
 */
export async function notifyPenaltyLift(db: DB, { membershipId }: { membershipId: string }): Promise<void> {
  try {
    const [row] = await db
      .select({ toEmail: user.email, locale: user.locale, clubName: clubs.name })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .innerJoin(clubs, eq(clubs.id, memberships.clubId))
      .where(eq(memberships.id, membershipId))
      .limit(1);
    if (!row) return;
    const email = await renderPenaltyLift(row.locale, { clubName: row.clubName });
    await sendEmail({ to: row.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyPenaltyLift failed', err);
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

/**
 * Best-effort: tells the requester their club request was approved or rejected.
 * Never throws — call it AFTER `decideClubRequest` has committed, so a mail
 * outage cannot roll back the decision (spec §5.4). `created_by` is
 * `on delete set null`, so a requester whose account is gone is simply skipped;
 * the decision itself stands.
 */
export async function notifyClubDecision(
  db: DB,
  { clubId, decision, note }: { clubId: string; decision: 'approved' | 'rejected'; note: string | null },
): Promise<void> {
  try {
    const [row] = await db
      .select({ toEmail: user.email, locale: user.locale, clubName: clubs.name, slug: clubs.slug })
      .from(clubs)
      .innerJoin(user, eq(user.id, clubs.createdBy))
      .where(eq(clubs.id, clubId))
      .limit(1);
    if (!row) return;
    const url = decision === 'approved' ? clubUrl(row.slug, parseAppOrigin(env.APP_URL)) : null;
    const email = await renderClubDecision(row.locale, { clubName: row.clubName, decision, note, url });
    await sendEmail({ to: row.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyClubDecision failed', err);
  }
}
