# Oarly Notifications & Waitlist Promotion — Design

**Date:** 2026-07-19
**Status:** Approved (brainstorm complete; ready for implementation plan)

## Goal

Close the flagged product gap where booking state changes happen **silently**: today when a cancellation promotes the head of a waitlist, the promoted member only finds out by re-opening My Bookings. This cycle adds an **email** notification layer and, as a prerequisite correctness fix, makes seating **sticky** so a seated member can never be silently bumped to the waitlist.

## Scope decisions (locked during brainstorm)

- **Channel: email only.** No in-app feed this cycle (that would need schema changes + new UI).
- **Events: three.** `waitlist_promotion` (passive — the must-have), `booking_confirmation`, `booking_cancellation` (both active/confirmatory). No `displaced` email (eliminated by the seating fix), no `reminder` (needs cron).
- **Seating fix in scope.** Seats become first-come and sticky; `priority` MultiSport mode only reorders the *waitlist*, never demotes a seated member.
- **No `.ics` / Google Calendar** this cycle. Full Google Calendar API sync is a separate future cycle.
- **No schema change.** The existing `notifications` table is used as-is (a send-idempotency log); the `bookingSource` enum (`member`/`owner`/`admin_prereservation`) and the pre-provisioned `bookings.source`/`hidden`/`guestName`/`slotIndex` columns already exist.
- **Owner booking management is in scope** (added after initial approval), appended after the member-notification foundation. A club owner can manually remove any booking and seat an approved member into a free spot, from a new dedicated "Bookings" manage view. Owner-add is an override (skips skill/payment eligibility, empty-seat-only, banned excluded). Both actions email the affected member.

## Current state (verified against code)

- **Promotion logic already exists and is silent.** `cancelBooking` (`src/lib/booking.ts:135-170`) cancels the row, then recomputes seating for the session under a per-slot advisory lock; the head of the waitlist flips `waitlisted → booked` as a pure DB side effect. No notification is created or sent.
- **`notifications` table** (`src/db/schema/system.ts:8-18`): columns `id, userId (nullable), type, sessionId (nullable), sentAt`. Unique index `notifications_idem_uq` on `(userId, type, sessionId)`. It is a **send log only** — no `read`, `body`, or `createdAt`. Cannot back an in-app feed without schema changes.
- **`notification_type` enum** (`src/db/schema/enums.ts:18-20`): `booking_confirmation, waitlist_promotion, displaced, cancellation, reminder` — all defined, none ever written.
- **Booking status** (`enums.ts:14`): `booked, waitlisted, cancelled, no_show, attended`. "Active" = `['booked','waitlisted']`. `bookings.queuePosition` is set only when waitlisted; `bookings.effectiveAt` is the ordering timestamp.
- **Seating decision** (`src/lib/seating.ts:11-32`): `computeSeating(entries, capacity, mode)` — a pure function that **re-sorts all active bookings** by `(priorityRank, effectiveAt, id)` and seats the top `capacity`. `priorityRank = 1` only for a MultiSport booking in `priority` mode, else `0` (so in `priority` mode regular/paid bookings rank ahead of MultiSport). Called only from `bookSeat` (`booking.ts:126-128`) and `cancelBooking` (`booking.ts:164-166`).
- **Email infra ready** (`src/lib/email.ts`): Resend via `sendEmail({ to, subject, html?, text?, attachments? })`; a dev no-op (`console.log`) when `RESEND_API_KEY`/`EMAIL_FROM` are unset. `react-email` + `next-intl` templates in `src/emails/` (`layout.tsx`, `reset-password.tsx`, `verify-email.tsx`); `src/emails/index.ts` exposes `renderVerifyEmail`/`renderResetEmail(locale, data) → { subject, html, text }`. Only auth emails are sent today (`src/auth.ts`).
- **Recipient language:** `user.locale` exists (`src/db/schema/auth.ts:24`, `notNull().default("tr")`).
- **No cron/queue/background-worker infrastructure exists** anywhere.
- **Member action entry points:** `bookSeatAction` (`app/s/[slug]/(member)/book/actions.ts`), `cancelBookingAction` (`app/s/[slug]/(member)/bookings/actions.ts`).

## The silent-displacement bug this fixes

In `priority` mode, `bookSeat` inserts the new booking then re-sorts the **whole** session. A later, higher-priority booking therefore re-seats ahead of an already-seated lower-priority member, dropping that member to the waitlist with no signal.

> Priority mode, capacity 2: MultiSport A and B are seated. Regular C books later → re-sort ranks C ahead of the MultiSport pair → B silently drops from seated to waitlisted.

In `equal` mode everyone is rank 0, so ordering is pure booking-time and a new booking always lands last — no displacement. Product intent: **once seated, you keep your seat.** The fix makes that true in all modes.

---

## Architecture

Chosen: **synchronous, best-effort, post-commit send.**

- Domain functions (`bookSeat`/`cancelBooking`) stay pure/DB-only and **report** what happened.
- The server action, **after** the transaction commits, calls a `notify` service that renders and sends via `sendEmail`.
- No new infrastructure, no schema change.
- Trade-off accepted: a failed send is logged and lost (retry/outbox is a listed follow-up).

Rejected alternatives: (B) transactional outbox + drainer — needs a `status`/`attempts` schema change and cron, both out of scope; (C) send inside the transaction — external I/O under a held advisory lock; a slow/failed email would stall or interfere with booking.

---

## Workstream 1 — Sticky seating

**Unit boundary:** `src/lib/seating.ts` owns the seating decision; `bookSeat`/`cancelBooking` call it. No other caller exists (verify during implementation with a repo-wide grep for `computeSeating`).

**New rule (status-aware, sticky).** A resolver receives the session's active bookings **with their current status**, the capacity, and the mode, and:

1. Every currently-`booked` booking **stays booked** (never demoted).
2. Free seats = `capacity − (# booked)`. Fill them from the `waitlisted` pool ordered by `(priorityRank, effectiveAt, id)` — promoting the highest-priority waiter(s) first (`equal` mode → pure FIFO by `effectiveAt`).
3. Remaining waitlisted bookings get 1-based `queuePosition` in the same order.

Invariant it preserves: **no free seat while anyone is waitlisted**, so seats and the waitlist are never both "open." (Assumes fixed capacity; per-session capacity decreases are out of scope — a shrink could leave `booked > capacity`, which this cycle does not handle. Note only.)

**`bookSeat`** (`booking.ts`): insert the new booking as `waitlisted`, then resolve. If a seat is free it is promoted to `booked`; if the session is full it stays waitlisted (back of an `equal` queue; ranked among waiters in `priority` mode). No seated booking is ever touched. The returned `outcome`/`queuePosition` come from the new booking's resolved state (unchanged public contract).

**`cancelBooking`** (`booking.ts`): cancel the row, then resolve over the remaining active bookings.
- If the cancelled row was `booked`, a seat frees → exactly one waiter is promoted. Capture that promotion.
- If the cancelled row was `waitlisted`, only positions shift; nobody is promoted.

**Result-type change:** `CancelResult` success variant gains an optional field:

```ts
export type CancelResult =
  | { ok: true; promoted?: { userId: string; sessionId: string } }
  | { ok: false; error: 'not_found' | 'not_active' | 'cancel_disabled' | 'cutoff_passed' };
```

`promoted` is set only when a `booked` cancellation causes a waiter to be seated.

**Tests:** no-demotion invariant (the priority-mode regression above); promotion order in `priority` vs `equal`; queue positions; existing "cancellation auto-promotes the head of the waitlist" stays green; `cancelBooking` reports `promoted` correctly; cancelling a waitlisted booking promotes nobody.

---

## Workstream 2 — Notification delivery

**Unit boundary:** `src/lib/notify.ts` owns "given an event, send the right email (and log it if idempotent)." It depends on `sendEmail`, the `src/emails` render fns, and read-only DB lookups. It knows nothing about booking logic beyond the IDs handed to it.

**Functions (all best-effort — wrapped in try/catch, `console.error` on failure, and they NEVER throw into the calling action):**

- `notifyWaitlistPromotion({ userId, sessionId })`
  - `INSERT INTO notifications (userId, 'waitlist_promotion', sessionId) ON CONFLICT DO NOTHING RETURNING id`.
  - If no row was returned (already logged), **return without sending** — at-most-once per `(user, session)`.
  - Otherwise fetch recipient email + `user.locale` + session context (club name, boat, date, time range), render, and `sendEmail`.
  - Accepted edge: a member who is promoted, cancels, re-waitlists, and is promoted again in the *same* session will not get a second email (the log key is per-session). Rare; safe (never double-emails).
- `notifyBookingConfirmation({ bookingId })` and `notifyBookingCancellation({ bookingId })`
  - Fetch context, render, send. **No** `notifications` row: each is triggered exactly once by the acting user, so idempotency logging is unnecessary — and logging with the per-session key would wrongly suppress the email on a legitimate re-book of the same session.

**Wiring (after `revalidatePath`, in the server actions):**
- `bookSeatAction` (on `ok`) → `notifyBookingConfirmation({ bookingId: result.bookingId })`.
- `cancelBookingAction` (on `ok`) → `notifyBookingCancellation({ bookingId })` to the actor; and if `result.promoted`, `notifyWaitlistPromotion(result.promoted)`.

**Locale:** the recipient's `user.locale` (correct for promotion, where the recipient is not the actor).

**Tests (mock `sendEmail`):** promotion logs a row and sends once; a second call is a no-op (idempotency, no duplicate send); recipient address + locale are correct; a thrown `sendEmail` does not break the booking/cancel action; confirmation and cancellation send **without** writing a `notifications` row.

---

## Templates & i18n

Three new `react-email` templates built on `src/emails/layout.tsx`:
- `booking-confirmation.tsx` — seated vs waitlisted (include queue position when waitlisted).
- `waitlist-promotion.tsx` — "You're in!" — seat confirmed.
- `booking-cancellation.tsx` — booking cancelled.

Add `renderBookingConfirmation`, `renderWaitlistPromotion`, `renderBookingCancellation` to `src/emails/index.ts` (each `(locale, data) → { subject, html, text }`). Data across templates: club name, boat name, date label, time range; confirmation also carries seated/waitlisted + position.

Add keys under the `emails` namespace in `messages/tr.json` and `messages/en.json`, TR primary, mirrored. Render tests assert both locales produce a subject + html + text.

---

## Error handling

- `notify` functions never throw into an action; every path is `try/catch` with `console.error`. A booking or cancellation succeeds even if its email fails.
- Idempotency is enforced by the DB unique index via `ON CONFLICT DO NOTHING`.
- Best-effort limitation (documented follow-up): a promotion email lost after its log row is written is not retried this cycle.

## Workstream 3 — Owner booking management

Lets a club owner remove any booking and seat a member into a free spot, from a new dedicated "Bookings" manage view. Reuses `resolveSeating`, the per-slot advisory lock, and the `notify` service.

**Unit boundaries.** `src/lib/booking.ts` gains two owner-scoped functions; `src/lib/roster.ts` (new) owns the read model; the UI lives under `app/s/[slug]/manage/bookings/`.

**Backend — `src/lib/booking.ts`:**
- `ownerRemoveBooking(db, { clubId, bookingId })` — force-remove, **bypassing** self-ownership, self-cancel, and cutoff gates (owner override). Verifies the booking belongs to the club and is active, then cancels + re-resolves seating under the advisory lock. Reports any promotion. Works on seated or waitlisted bookings. `{ ok: true; promoted? } | { ok: false; error: 'not_found' | 'not_active' }`.
- `ownerAddBooking(db, { clubId, windowId, boatTypeId, startAt, userId, paymentType })` — materializes the block (`findOrCreateSlotTx`), then seats the member **into a free seat only**. Skips skill/payment eligibility but requires an **approved, non-banned** member; keeps the one-booking-per-slot guard. Records `source: 'owner'`, `status: 'booked'`. Full session → `{ ok: false; error: 'session_full' }`. `{ ok: true; bookingId } | { ok: false; error: 'session_full' | 'already_booked_this_slot' | 'not_a_member' | 'no_session' }`.
- Shared recompute+promotion logic is extracted into a private `applySeating` helper reused by `cancelBooking` and `ownerRemoveBooking`.

**Read model — `src/lib/roster.ts`:** `getDayRoster(db, { clubId, dateISO })` enumerates the day's sessions via `computeCalendar` and joins `bookings`→`user` on the persisted sessions, returning per session: the block coords (`windowId`, `boatTypeId`, `startAt`), boat name, capacity, free-seat count, `status`, and `seated`/`waitlisted` member rows (`bookingId`, `name`, `paymentType`, `queuePosition`). Virtual (unbooked) sessions show an empty roster.

**Notifications:** owner-remove → new `notifyOwnerRemoval(db, { bookingId })` ("your booking was removed by the club" — distinct copy, `emails.booking.ownerRemoval.*`, no idempotency log), plus `notifyWaitlistPromotion` for anyone bumped up. Owner-add → reuses `notifyBookingConfirmation`.

**UI — `app/s/[slug]/manage/bookings/`:** an owner-guarded `page.tsx` (reads `?date=`, defaults to today in club tz, prev/next-day nav) rendering a client roster; each session card lists seated + waitlisted members each with a **Remove** button, and — when a seat is free — an **Add member** control (approved-member picker + regular/multisport choice). A `{ href: '/bookings', key: 'bookings' }` item is added to `manage/_nav.tsx`. Actions in `bookings/actions.ts` (`ownerRemoveBookingAction`, `ownerAddBookingAction`) authorize via `requireOwner`, drive the manage `ManageActionResult` + toast pattern, and dispatch the notifications after commit.

**Owner-action defaults:** owner-remove ignores the cancel cutoff; owner-add is empty-seat-only (errors rather than waitlists); payment type is the owner's choice (default regular); the roster shows member names to the owner.

## Verification

- `pnpm lint` (`--max-warnings 0`) → 0.
- `pnpm test` unit + integration suites green — booking/seating/eligibility suites must stay green (public contracts of `bookSeat`/`bookSeatAction` unchanged apart from the additive `CancelResult.promoted`).
- `pnpm build` clean.

## Non-goals / follow-ups (explicit)

- In-app notification feed (bell + list) — needs `notifications` schema changes (`read`, `body`, `createdAt`, relaxed index) + UI. Separate cycle.
- `reminder` notifications — need cron/scheduled infrastructure (none exists).
- `.ics` calendar attachment and full Google Calendar API sync.
- `displaced` email — eliminated by the sticky-seating fix.
- Send retry / transactional outbox for failed emails.
- Per-club "from" address (single global `EMAIL_FROM` today).
- Per-session capacity-decrease demotion edge (per-session overrides are out of scope).
