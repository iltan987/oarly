# Oarly Attendance, No-Show Penalties & MultiSport Daily Limit — Design

**Date:** 2026-08-07
**Status:** Approved (brainstorm complete; ready for implementation plan)

## Goal

Close the last major loop in the booking product: a member who takes a seat and doesn't turn up
currently costs the club a boat seat with no consequence. This cycle lets the owner record absences
from the day roster, turns an absence into a **ban** under the club's already-configured policy, and
lets the existing eligibility gate enforce it.

Folded in as a second, independent half: **MultiSport cards allow one session per day**, across all
clubs. That is a booking-time correctness gate on a path that is already live, and it needs a
migration in the same table this cycle already touches.

## Scope decisions (locked during brainstorm)

- **Core loop only.** Mark absence → penalty → ban → enforcement → member sees it → owner can undo.
  Explicitly out: owner-facing penalty history, manual pardon, manual penalty issuance without a
  session (all deferred to a penalty-admin cycle), and the advisory `min_attendance` surface.
- **Absence is recorded; attendance is derived.** The owner marks only no-shows. A post-session
  booking still sitting at `booked` with no absence mark *is* the attended case. The `attended` enum
  value stays unused in v1. Accepted cost: "nobody was absent" and "the owner never looked" are
  indistinguishable, which will matter if attendance statistics are ever built.
- **A ban is anchored to the missed session, not to when the owner marked it.**
  `banned_until = max(session start + duration)` over the member's live penalty rows.
- **A ban cancels the member's existing seats inside the ban window**, promoting waitlisters.
- **Undo does not restore cancelled seats.**
- **MultiSport one-per-day is a platform rule, not a club toggle** — it is a property of the card, and
  it binds the owner's manual seating too.

## Current state (verified against code)

The substrate is unusually complete; almost nothing in this cycle is net-new schema.

- **`booking_status` enum** (`src/db/schema/enums.ts:14`) already has `no_show` and `attended`. Neither
  is ever written.
- **`penalties` table** (`src/db/schema/bookings.ts:42-49`): `id, membership_id, session_id (nullable),
  reason, banned_until (nullable), created_at`. **Zero rows are ever inserted.** No `booking_id`.
- **`memberships.banned_until`** (`src/db/schema/clubs.ts:61`) and **`membership_status = 'banned'`**
  (`enums.ts:10`) both exist. Verified by grep: **nothing in the codebase writes either one.** This
  cycle is their first writer, so there is no existing convention to match.
- **The ban is already enforced on read.** `checkEligibility` (`src/lib/eligibility.ts:20-21`) blocks on
  `bannedUntil > now`; `requireMember` (`src/lib/membership.ts:71`) computes `bannedActive`; `bookSeat`
  (`src/lib/booking.ts:105-119`) and `ownerAddBooking` (`booking.ts:258-259`) both check it.
- **`clubs.noshow_penalty`** (`clubs.ts:26`, enum `off|2d|1w|2w|1m|never`) is already editable by the
  owner on the Policies page (`app/s/[slug]/manage/policies/policies-form.tsx:75-77`) and read by
  `scheduling-settings.ts`. It has never had an effect.
- **The day roster exists.** `getDayRoster` (`src/lib/roster.ts:27`) backs `/manage/bookings`, with a
  date-jump picker, so past days are already reachable.
- **`applySeating`** (`booking.ts:23-30`) is private, recomputes sticky seating for one session and
  returns the promoted user. Callers must already hold the per-slot advisory lock,
  `pg_advisory_xact_lock(hashtext(clubId), hashtext(slotStartAt.toISOString()))` (`booking.ts:179`).
- **Notification helpers** (`src/lib/notify.ts`): `notifyBookingConfirmation`, `notifyBookingCancellation`,
  `notifyOwnerRemoval`, `notifyWaitlistPromotion`. Emails are dispatched from server actions via
  `after()`.
- **`slots.date`** (`src/db/schema/schedule.ts:37`) is a plain `date` holding the club-local day.
  `bookSeat` already derives the same value as `dateISO` at `booking.ts:78`, before it inserts.

### One live defect this cycle must fix

`getDayRoster` filters bookings to `status in ('booked','waitlisted')` (`roster.ts:8,38`). A booking
marked `no_show` would therefore **disappear from the roster immediately**, leaving the owner nothing
to see or undo. The filter must widen and the status must reach `RosterMember`.

---

## Architecture

Two independent halves sharing one migration.

```
Half A — attendance                        Half B — MultiSport daily limit
  penalty.ts        (pure)                   bookings.booking_date + partial unique index
  attendance.ts     (thin core, db-first)    bookSeat / ownerAddBooking guards
  roster.ts         (widen filter)           member-calendar per-day signal
  eligibility.ts    (reorder)
  notify.ts + template
  /manage/bookings UI, /book banner
```

Both follow the established pure-core + thin-adapter pattern: core takes `db: DB` first, is
`clubId`-scoped on every write, returns a discriminated union, and never calls `revalidatePath`,
`redirect`, or `headers`. Server actions stay thin: `requireOwner` → zod `safeParse` → core →
revalidate → toast.

---

## Half A — Attendance & penalties

### `src/lib/penalty.ts` (new, pure)

```
penaltyEndsAt({ sessionStartAt, timezone, policy }) -> Date | 'permanent' | null
resolveBan(rows: { bannedUntil: Date | null }[])    -> { bannedUntil: Date | null; permanent: boolean }
```

`penaltyEndsAt` returns `null` for policy `off`, the string `permanent` for `never`, and otherwise the
session start advanced by the policy duration. **The arithmetic is club-local wall clock**, delegated
to `date-tz.ts` so a 07:00 session yields a ban ending at 07:00 even across a DST boundary — never a
raw `+ N × 24h`. `date-tz.ts` gains `addMonthsISO` beside its existing `addDaysISO` and remains the
only file importing `date-fns-tz`.

`resolveBan` is a plain max over non-null `banned_until` values. It is commutative, so the order rows
were created in is irrelevant and recomputation after a deletion needs no fold or cursor. This is the
property that makes undo correct by construction.

### `src/lib/attendance.ts` (new, thin core)

```
markNoShow(db, { clubId, bookingId, now }) -> { ok: true; bannedUntil; permanent; cancelled: {...}[]; alreadyLapsed }
                                            | { ok: false; error: 'not_found' | 'not_started' | 'not_booked' | 'already_marked' }
undoNoShow(db, { clubId, bookingId, now }) -> { ok: true; bannedUntil; permanent }
                                            | { ok: false; error: 'not_found' | 'not_marked' }
```

`markNoShow`, in one transaction:

1. Load the booking joined to its session, slot and club, scoped to `clubId`. Reject unless the
   session has **started** (`slotStartAt <= now`) and the booking is `booked` — a waitlisted member
   never held a seat, so absence is meaningless for them.
2. Flip the booking to `no_show`.
3. Insert the penalty row: `membership_id`, `session_id`, new `booking_id`, `reason = 'no_show'`,
   `banned_until` from `penaltyEndsAt` (null when the club's policy is `off` — the row is still
   written, so the history survives for the deferred penalty-admin cycle).
4. Recompute the membership: `banned_until` from `resolveBan` over that membership's live rows, or
   `status = 'banned'` when any penalty is permanent.
5. **Cascade.** Select that member's still-active bookings in **this club** whose session starts
   between `now` and the ban end. For each, in ascending `slotStartAt` order: take the per-slot
   advisory lock, cancel the booking, `applySeating` its session, collect any promoted user.

Ordering constraints, both load-bearing: the cascade runs *after* step 4 because the ban end is what
bounds it, and the locks are taken in a **deterministic order** because the cascade holds several at
once — unordered acquisition lets two owners marking concurrently deadlock.

Only seats **inside the ban window** are cancelled. A ban ending Wednesday must not take away next
Monday's seat, which the member would be free to book again anyway. For a permanent ban the window is
unbounded, so every future seat goes.

`undoNoShow` reverses what is cleanly reversible: booking back to `booked`, penalty row deleted,
membership recomputed from the remaining rows (which may lift the ban, or may not, if another absence
still stands). Cancelled seats stay cancelled — a promoted waitlister may genuinely hold that seat now,
and evicting them to repair the owner's slip only moves the injustice. The owner re-seats by hand with
the tool already on the Bookings view.

Undo deliberately reports **no count** of unrestored seats. Nothing links a cancelled booking back to
the penalty that cancelled it, and reconstructing the set after the fact is unreliable — a member may
have self-cancelled one of those seats independently. Rather than add a link column for a message, the
toast states the fact without a number: *"Absence removed. Any seats this penalty cancelled were not
restored."*

`applySeating` is exported from `booking.ts` unchanged so the cascade reuses it verbatim.

### Penalty durations

| Policy | Ban ends |
|---|---|
| `off` | no ban; penalty row written with null `banned_until` |
| `2d` / `1w` / `2w` / `1m` | session start + 2 days / 7 days / 14 days / 1 month, club-local |
| `never` | permanent — `memberships.status = 'banned'`, no date arithmetic |

**A stale mark produces a ban that is born expired.** Policy `1w`, a 1 March session marked on
20 March, ends 8 March — already past, so it restricts nothing. This is the honest consequence of
anchoring to the session, and it is intended: the punishment for an absence must not depend on the
owner's paperwork habits. The absence is still recorded and still counts toward any future
repeat-offense escalation. The confirm dialog says so explicitly rather than letting the owner
discover it.

### Eligibility

`checkEligibility` gains a `membershipStatus === 'banned'` check **before** the generic
`!== 'approved'` check, so a permanent ban reports `banned` instead of today's misleading
`not_approved`. Pure change, covered by unit tests.

### Member-facing

One combined email, not three. The cascade would otherwise fire a cancellation notice per seat plus
the penalty notice, all within a second, and the member would have to reassemble the story. So the
per-seat cancellation emails are **suppressed on this path** in favour of a single notice naming the
missed session, the ban end date, and the seats that were cancelled. Promoted waitlisters still get
their ordinary promotion mail — from their side nothing unusual happened. New react-email template
alongside the existing ones, rendered in the recipient's `user.locale`, dispatched via `after()` after
commit.

In-app, `/book` shows a banner with the ban end date and the session cards go disabled. The eligibility
gate already returns `banned`, so most of this state exists and only needs presenting.

### Owner-facing

`/manage/bookings` gains, per seated rower, a **Mark absent** action behind a confirm dialog, an
**Absent** pill on marked rows, and **Undo**. Both actions return `ManageActionResult` and drive a
sonner toast, per the established manage-form pattern.

The dialog states **the ban end date** and warns that upcoming seats within that window will be
cancelled, or — when the ban would be born expired — says so instead. It needs no preview round-trip:
`penaltyEndsAt` is pure and the roster page already has the session start, the club timezone and the
club policy in hand, so the date is computed at render. The **number** of seats cancelled is not
predicted, only reported afterwards from the action's `cancelled` result, which avoids a preview query
whose answer could change between opening the dialog and confirming it.

The Members page gains a read-only **"Banned until 14 March"** badge. It is a derived field with no new
actions — cheap insurance against an owner who cannot work out why a member is unable to book.

---

## Half B — MultiSport, one session per day

### The guarantee is the index

`bookings` gains `booking_date` (a plain `date`, copied from the slot at insert — `bookSeat` already
has it in hand as `dateISO` at `booking.ts:78`), plus:

```sql
unique (user_id, booking_date)
  where payment_type = 'multisport' and status in ('booked','waitlisted')
```

An advisory lock is keyed per slot, so it structurally cannot protect a cross-slot, cross-club
invariant: two simultaneous bookings at different clubs would both pass a `SELECT` guard. Making the
DB the guarantee follows the same principle §10 of the original design already relies on for capacity.

`bookSeat` additionally performs a cheap `SELECT` inside its transaction so the ordinary case returns a
clean typed `multisport_day_taken` without provoking a constraint error; the index is the backstop for
the genuine race. The violation is distinguished from the two existing unique indexes on `bookings`
(`bookings_active_uq`, `bookings_idem_uq`) by constraint name off the PG error, and mapped to the same
typed result rather than escaping as a 500.

Covering `waitlisted` as well as `booked` means a member cannot hold a waitlist spot at one club and a
seat at another. **Promotion is safe by construction**: the predicate covers both statuses, so
`applySeating` flipping `waitlisted → booked` neither moves a row into nor out of the index and cannot
violate it. Guests (`user_id is null`) fall outside it via NULL-distinct semantics, consistent with the
guest-dedupe deferral already recorded.

### Scope of the rule

- It constrains **MultiSport bookings against each other only.** A paid regular booking the same day is
  separate money and does not conflict.
- It is **cross-club**, which is the whole point, and therefore the one deliberate exception to the
  codebase's `clubId`-scoped querying rule.
- **`ownerAddBooking` is subject to it**, even though it deliberately overrides the closed-day and
  booking-open gates. Those are the club's rules to waive; one-per-day is the card's. The index would
  enforce it regardless, so the owner gets "this member already has a MultiSport session that day"
  instead of a 500.

### Member-facing

This cannot be a disabled session card: `member-calendar` deliberately never blocks on payment type,
because the choice is made in the confirm dialog. So `computeMemberCalendar` takes one extra query over
the 14-day window returning the set of dates on which the member already holds an active MultiSport
seat **anywhere**, and the confirm dialog explains the conflict when MultiSport is selected on such a
date. That query returns dates only, about the requesting user, so it discloses nothing about other
clubs.

---

## Migration 0006

Four changes in one migration:

1. `bookings.booking_date date` (nullable).
2. Backfill it from each booking's slot.
3. The partial unique index above.
4. `penalties.booking_id` + a unique index on it — one penalty per booking, and the handle `undoNoShow`
   uses to find the row to delete.

**Risk, and how it is handled.** If live data already contains a same-day MultiSport pair for one user,
step 3 fails — and since `build` now runs `drizzle-kit migrate` on production builds, that fails a prod
deploy. Volume is low (one demo club) so a violation is unlikely, but the plan's first task is to
**query production for violations before the migration is written**, not to discover it in a build log.

---

## Error handling

Typed discriminated results throughout, matching `bookSeat`; no throws across the core boundary.

| Case | Result |
|---|---|
| Booking absent, or not in this club | `not_found` |
| Session hasn't started yet | `not_started` |
| Booking is waitlisted / cancelled | `not_booked` |
| Already marked absent | `already_marked` |
| Undo on an unmarked booking | `not_marked` |
| MultiSport seat already held that day | `multisport_day_taken` |

Email failures never fail the action — the existing best-effort `notify` path is unchanged in that
respect.

---

## Verification

- **Unit — `penalty.ts`:** DST crossings; the born-expired stale mark; `never`; `off`; and
  `resolveBan`'s max after a deletion, including the case where a second absence keeps the ban alive.
- **Unit — `eligibility.ts`:** the reordered `banned` status case.
- **Integration vs real PG — `attendance.ts`:** the cascade; the ban-window bound on which seats are
  cancelled (a seat past the ban end survives); waitlist promotion into a cascaded cancellation;
  undo's recompute; multi-tenant isolation (a member's bookings in another club are untouched).
- **Integration — MultiSport:** two clubs, same day, **concurrent** `bookSeat` — exactly one wins.
  This proves the index rather than the guard, so the guard must be bypassed or raced deliberately.
- Every new test threads an **explicit frozen `now`** instead of reading the clock, per the hardcoded-date
  time bomb that took out the booking suite last cycle.
- i18n parity for the new `en` + `tr` keys.
- **Done means:** lint 0, tsc 0, full unit + integration suites green, build clean.

---

## Non-goals / follow-ups (explicit)

- **Penalty admin** — owner-visible absence history per member, manual pardon, manual penalty without a
  session. Deferred deliberately; the `off`-policy penalty rows are written now so the history exists
  when it ships.
- **Repeat-offense escalation** (2nd absence doubles, 3rd is permanent). Rejected for this cycle: it
  needs an offense counter and a decay window. The penalty rows make it addable later without
  re-deriving anything.
- **Advisory `min_attendance`** — stored on `boat_types` and `sessions`, still surfaced nowhere.
- **Attendance statistics** — precluded in part by the derive-attendance decision above; revisit
  together.
- **Other MultiSport card rules** (monthly visit caps, same-facility frequency limits). Only
  one-per-day is in scope.
- **Guest bookings** stay outside both the daily limit and the penalty flow — they have no `user_id`
  and no membership.
