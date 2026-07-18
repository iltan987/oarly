# Plan 5C — Seat Booking Engine + Member UI — Design

**Date:** 2026-07-17
**Sub-project:** Plan 5C of the Oarly Plan 5 sequence (recurring schedule + slots + seat booking).
**Depends on:** 5A (windows + policies), 5B (virtual+lazy calendar, `computeCalendar`, `materializeSlot`).

## Goal

Let an approved club member book (or waitlist for) a seat in a boat-session from a
member-facing calendar, and cancel their own bookings — backed by a single deterministic,
concurrency-safe seating engine that guarantees exactly `capacity` seats under the opening
rush, auto-promotes the waitlist on cancellation, and honours MultiSport priority modes.

## Scope boundary (confirmed with the user)

**In 5C:**
- Member booking UI: an authenticated 14-day calendar (`/s/[slug]/book`) and a "My Bookings"
  record (`/s/[slug]/bookings`).
- Eligibility gate (§7 of the master design): approved & not-banned membership, skill-level
  rank, allowed payment type.
- Concurrency-safe **seating function** (per-slot Postgres advisory lock) consuming
  `materializeSlot`.
- Waitlist + **auto-promotion** on cancellation; MultiSport `equal`/`priority` modes.
- **Member self-cancellation** honouring `selfCancelEnabled` + `cancelCutoffHours`.
- Booking idempotency.

**Deferred to later cycles (explicitly NOT 5C):**
- **Email notifications** — auto-promotion / displacement happen *silently* in 5C (state
  changes, visible in My Bookings; no email yet). Owns the notifications cycle.
- **Attendance & no-show marking + penalty creation** — 5C only *reads* `membership.status`
  / `membership.bannedUntil` at booking time; nothing writes `penalties`. Owns the
  attendance/roster cycle.
- **Owner-cancel-on-behalf** — moved to the attendance/roster cycle, where the owner's
  per-session booking-management UI lives. 5C ships member self-cancel only.
- **Admin hidden pre-reservation** — and therefore **guest bookings**. In 5C every booking
  has a real `userId`.
- **Rate-limiter wiring** — the no-overbooking guarantee comes entirely from the DB advisory
  lock, not the limiter; limiter (and its non-atomic INCR/EXPIRE fix) stays deferred.
- **Stored member "default payment preference"** — YAGNI for 5C; payment type is chosen per
  booking (defaults to Regular, or the only allowed type for the boat). A stored default is a
  later settings enhancement.

## Deferred items from earlier plans that 5C picks up

From `oarly-foundation-followups`:
- **(mechanical) `materializeSlot` empty-boats guard** — add `if (rows.length)` before
  `insert(sessions).values(rows)`. 5C is the first caller.
- **(mechanical) exact-`startAt` slot-identity contract** — `bookSeat` passes the exact
  `VirtualSlot.startAt` from `computeCalendar` straight into the find-or-create; no
  re-derivation (a 1 ms difference would create a duplicate slot).
- **(decision) close-a-day-with-bookings** — resolved: `computeCalendar` will **surface**
  persisted (booked) slots on a force-closed day as read-only/not-bookable, so bookings never
  silently vanish. No destructive cancel-on-close (that needs notifications, deferred).
- **(linked, stays deferred) guest dedupe / guest idempotency** — only relevant once guest
  rows exist (admin pre-reservation), which is deferred. For 5C every booking has a real
  `userId`, so `bookings_active_uq` and `bookings_idem_uq` enforce at the DB level.

## Data model — no migration

Every column and index the engine needs already exists (Foundation): `bookings`
(`sessionId`, `clubId`, `userId`, `paymentType`, `status`, `queuePosition`, `slotIndex`,
`effectiveAt`, `source`, `hidden`, `idempotencyKey`; partial unique indexes
`bookings_active_uq` on `(sessionId, userId)` where status ∈ (`booked`,`waitlisted`), and
`bookings_idem_uq` on `(userId, idempotencyKey)` where key not null), `sessions` (`capacity`,
`minAttendance`, `status`), and all club policy columns (`multisportMode`, `bookingOpenMode`,
`bookingOpenLeadDays`, `selfCancelEnabled`, `cancelCutoffHours`, `openOnHolidays`).

**`priority_rank` is derived, not stored** (equal → 0; priority → regular 0 / multisport 1).
The only schema-adjacent change is the code-level empty-boats guard in `materializeSlot`.

## Module boundaries (pure-core + thin-adapter)

### `src/lib/eligibility.ts` (pure)
```
checkEligibility({
  membershipStatus, bannedUntil,          // membership state
  memberSkillRank,                        // number | null
  boatMinSkillRank,                       // number | null
  boatAllowedPayment,                     // 'regular_only' | 'multisport_only' | 'both'
  paymentType,                            // 'regular' | 'multisport'
  now,
}) => { ok: true } | { ok: false, reason: EligibilityReason }
```
`EligibilityReason` ∈ `not_approved` | `banned` | `skill_too_low` | `payment_not_allowed`.
Rules (all must hold): membership `approved` and not banned (status ≠ `banned` and
`bannedUntil` null or in the past); `memberSkillRank >= boatMinSkillRank` (or boat has no
minimum); `paymentType` permitted by `boatAllowedPayment`. Exhaustively unit-tested.

### `src/lib/seating.ts` (pure) — the single deterministic §9 seating function
```
computeSeating(
  bookings: { id, paymentType, effectiveAt }[],   // active only (booked|waitlisted)
  capacity: number,
  mode: 'equal' | 'priority',
) => { id, status: 'booked' | 'waitlisted', queuePosition: number | null }[]
```
Sort by `(priorityRank, effectiveAt, id)` where `priorityRank` = 0 in equal mode; in priority
mode regular = 0, multisport = 1. Top `capacity` → `booked` (`queuePosition` null); the rest →
`waitlisted` with `queuePosition` 1..k. `id` is the final deterministic tiebreak. No DB.
Unit-tested: equal FCFS, priority ordering, priority displacement, capacity boundary, waitlist
numbering, empty input.

### `src/lib/booking.ts` — transactional orchestrator (concurrency-critical)
```
bookSeat(db, {
  clubId, userId, paymentType, idempotencyKey,
  slot: { dateISO, startAt, endAt, windowId, boats },  // exact VirtualSlot from computeCalendar
  boatTypeId,                                          // the boat the member chose
}) => BookResult
cancelBooking(db, { clubId, userId, bookingId, now, actor: 'member' }) => CancelResult
```
`bookSeat` runs one transaction:
1. `pg_advisory_xact_lock(hashtext(clubId), hashtext(startAt.toISOString()))` — **per-slot
   lock**, the same key `materializeSlot` uses.
2. **Idempotency**: if `(userId, idempotencyKey)` already has a booking, return it. Done.
3. **Find-or-create** the slot + all its sessions under the lock (shared with `materializeSlot`
   logic), using the exact `startAt`.
4. **Eligibility** (`checkEligibility`). Fail → `{ error: 'ineligible', reason }`, no write.
5. **One-boat-at-a-time**: reject (`error: 'already_booked_this_slot'`) if the member holds an
   active booking in *any* session of this slot.
6. **Pick the target session** of `boatTypeId`: first session with a free seat (stable order by
   session `id`), else the session with the fewest active bookings (shortest waitlist). Balances
   load when a boat has `quantity > 1`.
7. Insert the booking (`effectiveAt = now`, `source = 'member'`), run `computeSeating` for the
   target session, persist every active booking's `status`/`queuePosition`. Return
   `{ ok, outcome: 'seated' | 'waitlisted', queuePosition? }`.

`cancelBooking`: per-slot lock → verify ownership + `selfCancelEnabled` + now < `startAt` −
`cancelCutoffHours` → set `status = 'cancelled'` → `computeSeating` recompute for that session
(waitlist auto-promotion falls out; silent in 5C). Returns `{ ok }` or `{ error, reason }`.

**Locking rationale (deliberate deviation from §10's per-session lock):** a per-slot lock is a
strict superset — still guarantees exactly `capacity` and determinism — and lets step 6 choose
among a boat's identical sessions under the lock without a race, keeping materialize + seat in
one lock scope. At ~20–25 members/slot the extra serialization is negligible.

### `src/lib/member-calendar.ts`
```
computeMemberCalendar(db, clubId, member, { fromDateISO, days, now })
  => MemberCalendarDay[]     // CalendarDay enriched per session with:
                             //   seatsLeft, bookingOpen, eligibility, myStatus
```
Calls 5B `computeCalendar` (unchanged, booking-agnostic), then enriches each session:
`seatsLeft` = capacity − active seated (virtual/unmaterialized session = full capacity),
`bookingOpen` via 5B `isBookingOpen`, per-member `eligibility` via `checkEligibility`, and
`myStatus` (booked / waitlisted / none) from the member's own active bookings in range.
Requires computeCalendar's `VirtualSession` to also expose `minSkillRank`/`boatMinSkillLevelId`
and `allowedPayment` (extend the boat select + type).

### `src/lib/membership.ts` — add `requireMember(slug, redirectTo) => { club, user, membership }`
Approved, not-banned membership guard mirroring `requireOwner`.

### `src/lib/materialize.ts`
Add the empty-boats guard; refactor so the find-or-create logic runs **inside** `bookSeat`'s
transaction (shared helper) — one transaction covers lock → materialize → seat. Existing
`materializeSlot` public behaviour preserved.

## Member UI

### `/s/[slug]/book` (authenticated)
`requireMember` guard → `computeMemberCalendar` for 14 days → calendar (reuse the 5B
preview-calendar shape). Each session shows `seatsLeft`/capacity and a state-driven action:
- **Book** with a payment picker (Regular default; auto-selected + locked when the boat is
  `regular_only`/`multisport_only`).
- **Join waitlist** when full.
- Disabled with reason: **"Requires <level>"** / **"MultiSport not allowed"** (ineligible).
- **"Opens <date>"** when not yet booking-open.
- **"You're booked"** / **"Waitlisted #n"** for the member's own sessions.

Server action → `bookSeat` → `revalidatePath('/s/${slug}/book')`. Forms carry a client-generated
`idempotencyKey`. Inline errors via `useActionState` (5A Schedule form is the reference).

### `/s/[slug]/bookings` (authenticated)
The member's **upcoming** bookings (boat, time, seated/waitlisted, cancel button when
`selfCancelEnabled` and before cutoff) and **past** bookings. Cancel action → `cancelBooking` →
revalidate.

### Closed-day surfacing (the deferred #3 fix)
`computeCalendar` surfaces persisted booked slots on a force-closed day as read-only, so
existing bookings never disappear. Not bookable (day is closed); shown for visibility.

## Error handling
- All eligibility/cutoff/booking-open failures return typed discriminated results; the UI maps
  each to a localized message. No thrown errors for expected rejections.
- `bookSeat` is idempotent under retry (idempotency key) and safe under concurrency (advisory
  lock + `bookings_active_uq` backstop).
- Server-side zod validation is authoritative on every action input; `clubId`/`userId` come from
  the guard, never client input.

## Testing
- **Unit**: `eligibility` (every rule + boundary), `seating` (equal FCFS, priority ordering,
  displacement, capacity boundary, waitlist positions, empty), cancel-cutoff, booking-open.
- **Integration (real PG :5433)**: `bookSeat` materializes + seats; **concurrency rush** — N
  concurrent `bookSeat` on one session → exactly `capacity` seated, remainder waitlisted, zero
  overbooking; idempotency (same key → one booking); cancel → auto-promotion; priority
  displacement end-to-end; double-submit blocked by `bookings_active_uq`; same-slot double-boat
  blocked; ineligible rejected with no write.

## Non-goals (deferred, listed for the record)
Email notifications; attendance/no-show marking + penalty creation; owner-cancel-on-behalf and
owner roster; admin hidden pre-reservation + guest bookings; rate-limiter wiring; stored default
payment preference; the member-UX high-fidelity **design pass** (its own cycle after 5C, once the
real booking states exist to be designed).
