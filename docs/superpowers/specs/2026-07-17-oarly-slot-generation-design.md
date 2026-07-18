# Oarly 5B — Slot & Session Generation Design

**Status:** Approved design (pre-implementation)
**Date:** 2026-07-17
**Author:** brainstormed with the product owner

## Context

This is sub-project **5B** of Plan 5 ("recurring schedule + slots + seat booking"), which
decomposes into three interlocked cycles built in dependency order:

- **5A — Owner scheduling config** *(done)* — the recurring weekly template
  (`schedule_windows` + `window_boats`) and the club-level booking/cancellation/penalty
  policies. Pure configuration.
- **5B — Slot & session generation** *(this spec)* — turning that weekly template into concrete,
  dated, bookable sessions.
- **5C — Seat booking engine + member UI** — eligibility, the concurrency-safe seating function,
  waitlist + auto-promotion, MultiSport priority, cancellation, and the member booking flow.
  Depends on 5B.

### The architectural decision: virtual + lazy, not a cron generator

The obvious design for 5B is an eager **generator**: a daily cron pre-writes `slots`/`sessions`
rows out to a horizon, plus a second mechanism that flips their status open per the booking
policy. We deliberately **rejected** that in favour of a **virtual + lazy** model:

- **Virtual** — the calendar shown to owners (5B) and members (5C) is *computed live* from the
  weekly template for a display window (~14 days), with closed days subtracted. Nothing is
  pre-written.
- **Lazy** — a concrete `slots`/`sessions` row is written to the database **only** when it first
  needs to exist: when a member books a session (5C) or an owner overrides a specific date (5B).

Why this over the cron generator:

1. **Schedule edits become trivial.** Under an eager generator, editing a window after slots are
   materialised forces an ugly reconciliation of already-written future rows (rewrite all? only the
   un-booked ones? leave them stale?). Under the virtual model, editing the template *instantly*
   changes what every un-booked future day shows, because the calendar is recomputed on read. Only
   days that already carry a persisted booking need special handling — a small, well-defined set.
2. **No cron infrastructure.** No generator cron and no "open the slots now" cron: "is this day
   bookable yet?" is a pure function of `(now, startAt, policy)` evaluated at read time. This also
   sidesteps Vercel's plan-dependent cron-frequency limits (frequent crons require Pro; production
   only; UTC).
3. **Row volume is a non-issue either way** (a busy club is only a few hundred sessions over two
   weeks), so it is not a reason to prefer eager writes.
4. **It fits the locked schema.** `club_holiday_overrides` and `slots.status` / `sessions.is_override`
   are exactly the "exception" rows the lazy model writes on demand.

The one cost, paid in 5C: the booking action must **find-or-create** the session row race-safely.
5B builds and tests that helper (`materializeSlot`, §5) so 5C can consume it.

## Goal

1. Compute a club's concrete session calendar for a date range, live from the weekly template.
2. Resolve which dates are open vs closed (holidays + owner overrides), and whether a given session
   is open for booking yet (booking-open policy).
3. Provide a race-safe **find-or-create** that persists a slot and its sessions on first need — the
   seam 5C's booking path calls.
4. Give the owner a **Schedule Preview + Date Overrides** page: see what the template produces for
   the next ~14 days, and open/close specific dates.

## Architecture

Same as Plan 4/5A: **pure-core logic + thin server-action adapters**.

- Pure-core functions take `db: DB` first (`import type { DB } from '@/db'`), are scoped by `clubId`
  on every write, return plain data or a discriminated-union result, and contain no
  `revalidate`/`redirect`/`headers`.
- Server actions under `app/s/[slug]/manage/*` are thin: `requireOwner(slug, '/manage/...')` → zod
  `safeParse` (server-authoritative) → call pure-core → `revalidatePath`.
- **Time is computed, not stored ahead of time.** Local wall-clock → UTC conversion is DST-correct
  and done at read time.

## New dependency

Add **`date-fns`** and **`date-fns-tz`** (the app currently has no date library; 5C, reminders, and
notifications will reuse them). 5B uses two primitives, both `Intl`-backed and DST-correct:

- `fromZonedTime(local: Date | string, timeZone: string): Date` — a club-local wall-clock moment →
  the equivalent UTC `Date`. Used to compute a session's `startAt`/`endAt`.
- `toZonedTime(utc: Date | string, timeZone: string): Date` — a UTC instant → a `Date` whose fields
  read as the club-local time. Used to determine "today" and the local date/weekday of an instant.

Plus a handful of plain `date-fns` helpers (`addMinutes`, `addDays`, `eachDayOfInterval`) for range
and block arithmetic. These are wrapped behind a thin `src/lib/date-tz.ts` so the rest of the code
never imports `date-fns-tz` directly and the exact API lives in one place.

## Schema change (one migration)

The lazy model needs a natural key to dedupe race-safe inserts on. The existing `slots` table has no
unique constraint.

- **Add a unique index `slots_club_start_uq` on `slots (club_id, start_at)`.** 5A's rule that windows
  on the same weekday never overlap guarantees that, per club per date, block start-times are
  distinct — so `(club_id, start_at)` uniquely identifies one concrete time-block. This is the
  conflict target for `materializeSlot`'s `INSERT ... ON CONFLICT DO NOTHING`.

No other schema change. `sessions` rows for a slot are created as a set within the same transaction
that wins the slot insert, so no per-session uniqueness column is required (a `quantity: 2` boat
simply produces two `sessions` rows in that batch).

`window_boats.quantity` semantics (confirmed): quantity **N** means N physical boats of that type in
the block → **N separate `sessions`** each with `capacity = boat.seats`, matching the per-boat
session/booking model (5C seats each boat independently). It is **not** one session of capacity
`seats × N`.

## Logic modules

### `src/lib/date-tz.ts` — timezone helpers

Thin wrapper over `date-fns-tz` / `date-fns`. Exports:

```
zonedWallClockToUtc(dateISO: string, timeHHMM: string, timeZone: string): Date
  // e.g. ("2026-07-20", "08:00", "Europe/Istanbul") → the UTC Date for 08:00 Istanbul that day
utcToClubDate(instant: Date, timeZone: string): { dateISO: string; weekday: number }
  // weekday 0=Sunday..6=Saturday, matching schedule_windows.weekday
todayInClub(now: Date, timeZone: string): string   // "YYYY-MM-DD" local calendar date
```

### `src/lib/calendar.ts` — the computation core

```
type VirtualSession = {
  boatTypeId: string;
  boatName: string;
  capacity: number;            // boat.seats
  minAttendance: number | null;
  occurrence: number;          // 0..quantity-1 (display/debug only)
};
type VirtualSlot = {
  dateISO: string;             // club-local calendar date
  startAt: Date;               // UTC
  endAt: Date;                 // UTC
  windowId: string;
  sessions: VirtualSession[];
};
type CalendarDay = {
  dateISO: string;
  weekday: number;
  closed: boolean;
  closedReason: 'holiday' | 'override' | null;
  slots: VirtualSlot[];        // empty when closed or no windows that weekday
};

computeCalendar(db, clubId, opts: { fromDateISO: string; days: number }): Promise<CalendarDay[]>
```

Algorithm, per date in `[fromDateISO, fromDateISO + days)`:

1. Determine the local weekday; gather the club's `schedule_windows` for it (with their
   `window_boats` joined to `boat_types` for name/seats/minAttendance; **active boats only**).
2. Resolve open/closed via `resolveDateOpen` (§ `calendar-rules.ts`). If closed, emit a
   `CalendarDay` with `closed: true`, the reason, and no slots.
3. Otherwise **tile** each window `[startTime, endTime]` into consecutive blocks of
   `defaultSessionMinutes` (5A guarantees even division). Each block → one `VirtualSlot` with
   `startAt = zonedWallClockToUtc(date, blockStart, tz)` and `endAt` = `+defaultSessionMinutes`.
4. For each block, expand `window_boats`: emit `quantity` `VirtualSession`s per boat (occurrence
   `0..quantity-1`), `capacity = seats`.
5. **Overlay** persisted rows: query `slots`/`sessions` already written for the club in the range;
   where a persisted slot matches a virtual slot's `(clubId, startAt)`, replace the virtual slot's
   sessions with the real ones (so a cancelled/overridden session shows its true state). Persisted
   slots with no matching window (e.g. from a since-deleted window) are still surfaced as slots so
   existing bookings never vanish.

Pure read; writes nothing.

### `src/lib/calendar-rules.ts` — pure predicates

```
resolveDateOpen(input: {
  dateISO: string;
  openOnHolidays: boolean;
  approvedHolidayDates: Set<string>;      // dates with an approved holidays row
  overrides: Map<string, boolean>;        // dateISO -> is_open, from club_holiday_overrides
}): { open: boolean; reason: 'holiday' | 'override' | null }
```

Precedence:

1. If `overrides` has the date, it **wins**: `is_open=false` → closed (`reason: 'override'`);
   `is_open=true` → open.
2. Else if the date is an approved holiday **and** `!openOnHolidays` → closed (`reason: 'holiday'`).
3. Else open. (A weekday with no windows is not "closed" — it is simply an open day with no slots.)

```
isBookingOpen(input: {
  now: Date;
  startAt: Date;
  bookingOpenMode: 'always' | 'lead';
  bookingOpenLeadDays: number | null;
}): boolean
```

- `startAt <= now` → false (already started/past).
- `always` → true.
- `lead` → `now >= startAt - leadDays` (leadDays treated as whole days). If `bookingOpenLeadDays` is
  null under `lead`, treat as not-yet-open (defensive; 5A's schema/refine forbids this state).

Note: approved holidays are read from the global `holidays` table (`status = 'approved'`). Until the
deferred admin holiday cycle seeds/approves them, that set is typically empty and only owner
overrides close dates — which is acceptable and expected.

### `src/lib/materialize.ts` — the lazy find-or-create (5B/5C seam)

```
materializeSlot(db, input: {
  clubId: string;
  startAt: Date;
  endAt: Date;
  windowId: string;
  boats: { boatTypeId: string; capacity: number; minAttendance: number | null; quantity: number }[];
}): Promise<{ slotId: string; sessions: { id: string; boatTypeId: string }[] }>
```

Inside one `db.transaction`:

1. Take a **Postgres advisory lock** keyed on a stable hash of `(clubId, startAt)` — the first use of
   advisory locking in the codebase; 5C reuses the pattern per-session for seating.
2. `INSERT` the slot with `ON CONFLICT (club_id, start_at) DO NOTHING RETURNING id`.
3. If a row was returned (we created the slot), insert its full `sessions` set (expanding `quantity`)
   and return them. If not (slot already existed), read the existing slot + its sessions and return
   those.

Idempotent: calling it repeatedly for the same block yields the same slot and session set, never
duplicates. This is what 5C calls immediately before seating a booking; 5B exercises it directly in
tests.

### `src/lib/date-overrides.ts` — owner per-date open/close

```
type OverrideInput = { dateISO: string; isOpen: boolean };
listOverrides(db, clubId, opts: { fromDateISO: string; days: number }): Promise<{ dateISO: string; isOpen: boolean }[]>
setDateOverride(db, clubId, input: OverrideInput): Promise<boolean>   // upsert on (club_id, date)
clearDateOverride(db, clubId, dateISO: string): Promise<boolean>      // remove the row → revert to default
```

Scoped by `clubId`; upsert uses the existing `club_holiday_overrides_club_date_uq` unique index.

## UI

### Schedule Preview + Date Overrides page (`/manage/schedule/preview`)

A sibling under the existing Schedule area, linked from the Schedule editor page header
("Preview & closed dates"). Server component:

- Renders `computeCalendar(db, clubId, { fromDateISO: todayInClub(...), days: 14 })` as a read-only
  day-by-day list: each open day shows its blocks (`08:00–09:00 · Quad ×1, Double ×1`), each closed
  day shows its reason ("Public holiday" / "Closed by you"). The 14-day display window is a single
  named constant (`PREVIEW_DAYS`), trivially changeable.
- **Per-date override control** on each day: open / close / reset-to-default, submitting the
  `setDateOverride` / `clearDateOverride` server actions (FormData + uncontrolled inputs, the 5A/Plan-4
  pattern). After a successful action the route revalidates and the recomputed calendar reflects the
  change.

No member-facing calendar here — that is 5C.

### Navigation

The preview lives under `/manage/schedule/preview`; it is reached via a link on the Schedule page,
not a new top-level nav tab (the manage nav stays as-is). The setup checklist on the manage overview
is unchanged (5A's "Set your weekly schedule" item already covers the template).

## Error handling

- Server actions: `requireOwner(slug, '/manage/schedule')` guards ownership; zod `safeParse` rejects
  malformed input (bad date, non-boolean); pure-core is `clubId`-scoped so a foreign date/override is
  a no-op, never a cross-club mutation.
- `materializeSlot` is race-safe by construction (advisory lock + `ON CONFLICT`), so concurrent first
  bookings on the same block converge on one slot.
- `computeCalendar` degrades gracefully: a club with no windows yields all-open, all-empty days; an
  invalid timezone would surface at conversion (clubs default to `Europe/Istanbul`, non-null).

## Testing

**Integration tests (real Postgres, `describe.skipIf(!TEST_DATABASE_URL)`, `migrate` in `beforeAll`):**

- `src/lib/calendar.integration.test.ts`
  - a window tiles into the right number of blocks with correct UTC `startAt`/`endAt` for a known
    Istanbul date (assert the exact UTC instant, e.g. 08:00 Istanbul → 05:00Z).
  - `window_boats` with `quantity: 2` yields two sessions of that boat type in the block.
  - a closed date (override and holiday) yields a `closed` day with the right reason and no slots.
  - a persisted (materialised) slot is overlaid onto the computed calendar rather than duplicated.
  - a persisted slot from a deleted window is still surfaced (bookings never vanish).
- `src/lib/materialize.integration.test.ts`
  - first call creates the slot + full session set; a second call with the same block returns the
    same `slotId` and no duplicate sessions (idempotency).
  - `quantity: 2` produces exactly two sessions.
  - cross-club scoping: a slot is created under the passed `clubId` only.
- `src/lib/date-overrides.integration.test.ts`
  - `setDateOverride` upserts (open then close on the same date updates, not duplicates);
    `clearDateOverride` reverts to default; both scoped by `clubId` (a foreign club cannot change
    another's override).

**Unit tests:**

- `src/lib/calendar-rules.test.ts` — `resolveDateOpen` precedence (override beats holiday both ways;
  holiday only closes when `!openOnHolidays`; empty day is open) and `isBookingOpen`
  (`always`; `lead` before/after the lead boundary; past `startAt` → closed).
- `src/lib/date-tz.test.ts` — `zonedWallClockToUtc` / `utcToClubDate` / `todayInClub` round-trip for
  a known Istanbul date.
- `src/lib/schemas.test.ts` — the new `dateOverrideSchema` (ISO date shape, boolean `isOpen`).

## Non-goals (explicit, deferred)

- **Admin global holiday calendar** — seeding/approving Turkish public holidays and the admin UI to
  manage `holidays`. 5B only *reads* `status = 'approved'` rows. Its own later cycle.
- **Per-session / per-slot overrides** — changing a single session's capacity/length, cancelling one
  session, closing a slot early (`sessions.is_override`, `slots.status` beyond what overrides need).
  Later cycle / folded into 5C owner tools.
- **Member-facing calendar, booking, seating, concurrency, waitlist, MultiSport priority** — all 5C.
- **Attendance / no-show penalties, Resend notifications, admin hidden pre-reservation** — later
  cycles, already designed in `2026-07-15-oarly-design.md`.

## File structure

**Create**
- `src/lib/date-tz.ts` + `src/lib/date-tz.test.ts`
- `src/lib/calendar.ts` + `src/lib/calendar.integration.test.ts`
- `src/lib/calendar-rules.ts` + `src/lib/calendar-rules.test.ts`
- `src/lib/materialize.ts` + `src/lib/materialize.integration.test.ts`
- `src/lib/date-overrides.ts` + `src/lib/date-overrides.integration.test.ts`
- `app/s/[slug]/manage/schedule/preview/{page.tsx, actions.ts, preview-calendar.tsx, date-override-controls.tsx}`
- One Drizzle migration adding `slots_club_start_uq`.

**Modify**
- `src/lib/schemas.ts` + `src/lib/schemas.test.ts` — `dateOverrideSchema`
- `app/s/[slug]/manage/schedule/page.tsx` — a "Preview & closed dates" link to the preview page
- `messages/en.json`, `messages/tr.json` — new `manage.schedulePreview.*` keys
- `package.json` — add `date-fns`, `date-fns-tz`

**Note:** the Drizzle table module is `src/db/schema/schedule.ts`; the logic modules
(`src/lib/calendar.ts`, etc.) live in `src/lib/` — different directory, no collision.
