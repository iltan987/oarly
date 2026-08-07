# Per-club feature toggles

**Date:** 2026-08-07
**Status:** approved for implementation
**Depends on:** the responsive-UI cycle (it restructures `policies-form.tsx`, which this cycle also edits).

## 1. Problem

> "From admin panel, I should be able to enable/disable features. Assume a club doesn't
> accept MultiSport at all. So any logic related to MultiSport doesn't apply to them.
> They shouldn't even see anything related."

MultiSport is a Turkish corporate fitness benefit card. Oarly treats it as a payment
type alongside cash. A club with no MultiSport contract currently cannot say so: the
concept is woven through the booking UI, the boat editor, the policies page and the
owner's roster with no way to opt out.

## 2. What already exists

The audit found that per-club optionality is **already** a settled pattern in this
codebase — it is expressed as plain columns on `clubs`, in three idioms:

| Idiom | Example |
|---|---|
| Boolean column | `self_cancel_enabled`, `open_on_holidays` |
| `'off'` sentinel in a mode enum | `noshow_penalty` (`off`/`2d`/`1w`/…) |
| Capacity sentinel | `waitlist_capacity` — `null` = unlimited, `0` = no queue (verified: `limitFor(capacity) = capacity + waitlistCapacity`, so `0` caps the session at its seats) |

MultiSport is the one optional area with **no off switch at all**. It has
`clubs.multisport_mode` (`equal` / `priority`), which presumes the feature is on, and
`boat_types.allowed_payment` (`regular_only` / `multisport_only` / `both`), which is
per-boat and cannot express a club-wide position.

**Design decision: do not build a generic feature-flag framework.** No `club_features`
table, no JSONB blob, no flag registry. There are four optional areas, three of which
already have working controls; a generic system would add a migration, an indirection
layer and a new admin surface to express what one boolean column already expresses. The
gap is a missing switch, not a missing framework.

## 3. Scope

**In scope**

1. `clubs.multisport_enabled boolean NOT NULL DEFAULT true`.
2. A toggle for it on the existing `/manage/policies` page.
3. Complete suppression of MultiSport from every UI surface when off.
4. Server-side enforcement, at both booking entry points.
5. The data-integrity migration that disabling implies (§5).
6. Reorganising the policies page so each optional feature's dependent settings are
   nested under it and hidden when it is off — which is the general form of "they
   shouldn't even see anything related", applied to the toggles that already exist
   (self-cancellation, no-show penalties) as well as the new one.

**Out of scope**

- New columns for waitlist or any other area. `waitlist_capacity = 0` already works;
  inventing `waitlist_enabled` would be a second source of truth for the same fact.
- A platform-superadmin tier for gating paid features. `clubs.heading_font`
  (`default` / `premium`) hints at a future paid tier, but nothing asks for it yet.
- Retroactively rewriting historical MultiSport bookings (§5.3).

## 4. Read-side suppression

`multisport_enabled` is read through the existing loaders — `getClubBySlug` returns the
whole `clubs` row and is `cache()`-memoized per request, and `getSchedulingSettings`
gains the column — so no new fetching layer is needed.

The surfaces that must go quiet, all confirmed present today:

| Surface | File | Change |
|---|---|---|
| Payment choice computation | `src/lib/member-calendar.ts:35-44` | `paymentChoicesFor` / `defaultPaymentFor` take the flag; return `['regular']` / `'regular'` when off |
| Booking payment picker + chips | `app/s/[slug]/(member)/book/book-calendar.tsx:78-90, 193-215` | The radio picker already self-hides when `paymentChoices.length === 1`; `PaymentChips` does **not** and must |
| Owner roster add-member | `app/s/[slug]/manage/bookings/bookings-roster.tsx:192-199` | A hard-coded two-item `<Select>` with no club-awareness — the clearest leak. Hide it; force the hidden input to `regular` |
| Boat editor | `app/s/[slug]/manage/boats/boats-editor.tsx:16-19, 74-78` | Drop the MultiSport options; hide the whole "Allowed payment" field when off, since `regular_only` is then the only possibility |
| Policies page | `app/s/[slug]/manage/policies/policies-form.tsx:97-109` | The MultiSport-mode field nests under the new toggle |
| Policies intro copy | `messages/{en,tr}.json` → `manage.policies.intro` | Hard-codes "MultiSport priority" in prose; needs a second variant |

## 5. Write-side: the parts that are easy to get wrong

### 5.1 Two enforcement points, not one

Hiding a `<Select>` is not enforcement. Both booking actions accept
`paymentType: z.enum(['regular', 'multisport'])` from `FormData`, so a crafted POST
against a `both` boat would still book MultiSport at a club that has it off.

The obvious single choke point does not exist:

- **Member path** — `bookSeat` calls `checkEligibility` (`src/lib/booking.ts:133`), so
  adding `clubMultisportEnabled` to that pure function covers it, and covers the
  calendar read path (`member-calendar.ts:111`) at the same time.
- **Owner path** — `ownerAddBooking` **deliberately does not call `checkEligibility`.**
  Its comment at `src/lib/booking.ts:300-306` is explicit: the owner override "skips the
  member-facing gates — skill/payment eligibility AND the closed-day / holiday /
  booking-open checks". It inlines its own membership test instead. So it needs its own
  check.

For the owner path the existing waiver logic does **not** apply. That comment draws the
line at "the club's gates are the owner's to waive, the card's rule is not". A club-wide
"we have no MultiSport contract" is not a gate the owner is choosing to relax for one
member — it means no such payment arrangement exists to record. It is rejected, not
waived.

### 5.2 Disabling must not strand boats

A boat with `allowed_payment = 'multisport_only'` at a club that turns MultiSport off has
**no valid payment type left and becomes unbookable** — silently, with the only
diagnostic being members seeing `payment_not_allowed`.

The invariant is enforced at **write time**, not read time: disabling MultiSport
migrates every `multisport_only` boat in that club to `regular_only`, in the same
transaction as the flag write. `both` needs no change — it already permits cash, and
`paymentChoicesFor` will narrow it.

This keeps `checkEligibility` pure and its existing payment branches untouched, and
maintains the invariant *no boat advertises MultiSport at a club that has MultiSport
off*. The toggle's confirmation step must state how many boats will be converted, since
this is a real edit to the club's boat configuration.

### 5.3 Existing bookings are left alone

Active and historical MultiSport bookings survive the toggle. They are a record of what
happened, and rewriting `payment_type` would falsify it. The global
`bookings_multisport_day_uq` index is deliberately not club-scoped (a card allows one
session per day *across all clubs*), so it is unaffected either way — a member's
MultiSport booking at club B must keep blocking their card at B regardless of what club
A does.

Turning MultiSport back on restores the previous behaviour, except that boats converted
by §5.2 stay `regular_only` until an owner changes them back. The confirmation copy must
say so, because it is not reversible by re-toggling.

## 6. Testing

- `checkEligibility` unit tests for the new input: MultiSport rejected when the club has
  it off, on every `allowed_payment` value.
- An integration test that `ownerAddBooking` rejects a MultiSport booking at a disabled
  club — the path that bypasses `checkEligibility`, and the one a single-choke-point
  implementation would leave open.
- An integration test that disabling converts `multisport_only` boats to `regular_only`
  in the same transaction, and that a club with converted boats still books.
- A test that existing MultiSport bookings survive the toggle.
- Component assertions that the roster's payment `<Select>` and the booking chips are
  absent when off.

## 7. Deferred

- A platform-superadmin feature tier (`heading_font: 'premium'` is the existing hint).
- Any second feature toggle beyond MultiSport. The pattern established here — boolean
  column, nested settings, write-time invariant repair, enforcement at every entry
  point that bypasses the shared gate — is what a future one should follow.
