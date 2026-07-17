# Oarly 5A — Owner Scheduling Config Design

**Status:** Approved design (pre-implementation)
**Date:** 2026-07-17
**Author:** brainstormed with the product owner

## Context

This is sub-project **5A** of Plan 5 ("recurring schedule + slots + seat booking"), which
decomposes into three interlocked cycles built in dependency order:

- **5A — Owner scheduling config** *(this spec)* — the recurring weekly template and the
  club-level booking/cancellation/penalty policies the owner configures. Pure configuration.
- **5B — Slot & session generation** — a job that materializes windows into concrete, bookable
  `slots` + `sessions` over a rolling horizon, plus the slot-open cron. Depends on 5A.
- **5C — Seat booking engine + member UI** — eligibility, the concurrency-safe seating function,
  waitlist + auto-promotion, MultiSport priority, cancellation, and the member booking flow.
  Depends on 5B.

Attendance/no-show + penalties, Resend notifications, and admin hidden pre-reservation are each a
later cycle of their own (already designed for in `2026-07-15-oarly-design.md`).

5A builds only on top of the existing schema. The foundation (Plan 1) already created
`schedule_windows`, `window_boats`, and all seven club-level policy columns on `clubs`. **5A adds no
schema and no migration** — it is purely additive logic, UI, zod schemas, and i18n.

## Goal

Give a club owner two configuration surfaces:

1. **Schedule** — the recurring weekly template: for each weekday, one or more time windows, each
   with a session length and the boats (type + quantity) that run in it.
2. **Policies** — the club-level scheduling policies: booking-open rule, self-cancellation policy,
   no-show penalty, MultiSport mode, and holiday behavior.

## Architecture

Identical to Plan 4 (Club Config): **pure-core logic + thin server-action adapters**.

- Pure-core functions take `db: DB` first, are scoped by `clubId` on every write, return plain data
  or a discriminated-union result, and contain no `revalidate`/`redirect`/`headers`.
- Server actions under `app/s/[slug]/manage/*` are thin: `requireOwner(slug)` → zod `safeParse`
  (server-authoritative) → call pure-core → `revalidatePath`.
- Client zod (if any) is UX only; the server re-parses with the same schema, and pure-core adds the
  cross-row checks zod cannot express (overlap, tiling, cross-club FK).

Two new manage pages, siblings of Profile/Boats/Skill Levels:

- **Schedule** at `/manage/schedule`
- **Policies** at `/manage/policies`

Naming: "Schedule" (windows) and "Policies" (settings) deliberately avoid a confusing
"schedule/scheduling" pair.

## Data model (existing — no changes)

`schedule_windows` — `id`, `club_id`, `weekday` (0 = Sunday … 6 = Saturday), `start_time` (`time`),
`end_time` (`time`), `default_session_minutes` (int).

`window_boats` — `id`, `window_id`, `boat_type_id`, `quantity` (int, default 1).

Club policy columns on `clubs` (all present): `multisport_mode` (`equal`|`priority`),
`booking_open_mode` (`always`|`lead`), `booking_open_lead_days` (int, nullable),
`self_cancel_enabled` (bool), `cancel_cutoff_hours` (int, nullable),
`noshow_penalty` (`off`|`2d`|`1w`|`2w`|`1m`|`never`), `open_on_holidays` (bool).

**Time semantics:** `start_time`/`end_time` are stored as wall-clock, club-local `time` values (the
recurring weekly template has no date). 5B combines a concrete date + these times + the club's
timezone to produce the UTC `start_at`/`end_at` on generated slots. 5A stores only the local times.

## Logic modules

### `src/lib/schedule.ts`

```
type WindowBoatInput = { boatTypeId: string; quantity: number };
type WindowInput = {
  weekday: number;              // 0..6
  startTime: string;            // "HH:MM"
  endTime: string;              // "HH:MM"
  defaultSessionMinutes: number;
  boats: WindowBoatInput[];
};
type WindowWithBoats = ScheduleWindow & { boats: (WindowBoat & { boatName: string })[] };
type WindowError = 'end_before_start' | 'uneven_tiling' | 'overlap' | 'invalid_boats' | 'not_found';
type WindowResult = { ok: true; id: string } | { ok: false; error: WindowError };
```

- `listWindowsWithBoats(db, clubId): Promise<WindowWithBoats[]>` — windows ordered by
  `(weekday, startTime)`, each with its boats (joined to `boat_types.name` for display).
- `createWindow(db, clubId, input): Promise<WindowResult>` — validate, then in one transaction insert
  the window row and its `window_boats` rows.
- `updateWindow(db, { clubId, windowId, ...input }): Promise<WindowResult>` — scoped by `clubId`;
  validate, then in one transaction update the window row and **replace** the full `window_boats` set
  (delete existing for the window, insert the new set). Returns `error:'not_found'` if the window is
  not the club's.
- `deleteWindow(db, { clubId, windowId }): Promise<boolean>` — scoped by `clubId`; cascades to
  `window_boats`.

**Validation (pure-core, server-authoritative):**

1. `endTime > startTime` → else `end_before_start`.
2. `defaultSessionMinutes ≥ 5` and `(endMinutes − startMinutes) % defaultSessionMinutes === 0` → else
   `uneven_tiling`. (Session length must divide the window evenly; no partial trailing slot.)
3. No time overlap with the club's other windows on the same `weekday` — touching boundaries
   (08:00–11:00 then 11:00–14:00) are allowed; strict overlap is rejected → else `overlap`. On update,
   the window being edited is excluded from the comparison set.
4. `boats` is non-empty; each `boatTypeId` belongs to the club **and is `active`**; no duplicate
   `boatTypeId`; every `quantity ≥ 1` → else `invalid_boats`.

### `src/lib/scheduling-settings.ts`

```
type SchedulingSettingsInput = {
  bookingOpenMode: 'always' | 'lead';
  bookingOpenLeadDays: number | null;
  selfCancelEnabled: boolean;
  cancelCutoffHours: number | null;
  noshowPenalty: 'off' | '2d' | '1w' | '2w' | '1m' | 'never';
  multisportMode: 'equal' | 'priority';
  openOnHolidays: boolean;
};
```

- `getSchedulingSettings(db, clubId): Promise<SchedulingSettingsInput>` — reads the seven columns.
- `updateSchedulingSettings(db, clubId, input): Promise<boolean>` — updates the seven columns, scoped
  by `clubId`.

**Conditional rules** (zod `.refine` client-side + a pure-core re-check server-side):

- `bookingOpenMode === 'lead'` requires `bookingOpenLeadDays ≥ 1`; under `always`, `bookingOpenLeadDays`
  is stored as `null`.
- `cancelCutoffHours`, when provided, is `≥ 0`; may be `null` (no cutoff) regardless of
  `selfCancelEnabled`.

## UI

### Schedule page (`/manage/schedule`)

Weekday-grouped list. Seven sections (localized weekday names, **Monday-first for display** — the page
renders seven fixed sections and buckets each window by its `weekday` value, independent of the query's
Sunday-indexed `0..6` order; within a section, windows are ordered by `startTime`). Each section
shows its windows as rows (`08:00–11:00 · 60 min · Quad ×1, Double ×1` with edit/delete) and a
**"+ window"** action; empty days read "(no windows)".

Add and edit open the same form component (`window-form.tsx`): weekday, start time, end time, session
length, and a **boats sub-editor** — repeatable rows of an active-boat `<select>` plus a quantity
input, with add-row/remove-row controls. The whole form submits as a single `createWindow` /
`updateWindow` server action (never per-boat actions — the tiling and "≥1 boat" validations need the
whole set at once).

Validation failures surface **inline** on the form via React 19 `useActionState`, mapping each
`WindowError` to a localized message. This is a deliberate step up from Plan 4's silent-return
actions: owners will routinely hit overlap and uneven-tiling errors, and the reason must be legible.

### Policies page (`/manage/policies`)

One form, native `<select>`/checkbox/number inputs (no new `src/components/ui/*` components). Fields:

- **Booking-open** — mode (`always` / `lead`); when `lead`, a days input (shown/required conditionally).
- **Self-cancellation** — on/off; cutoff hours (optional).
- **No-show penalty** — off / 2 days / 1 week / 2 weeks / 1 month / never.
- **MultiSport mode** — equal / priority (with one-line explanations).
- **Open on holidays?** — on/off.

Keyed on `club.updatedAt` for the established post-save remount pattern (uncontrolled inputs re-seed
from fresh defaults after the server action revalidates the route).

### Navigation & overview

- `app/s/[slug]/manage/_nav.tsx` gains **Schedule** and **Policies** entries.
- The setup-checklist on `app/s/[slug]/manage/page.tsx` gains a **"Set your weekly schedule"** item
  (satisfied when the club has ≥1 schedule window).

## Error handling

- Server actions: `requireOwner(slug, '/manage/...')` guards ownership and redirects otherwise; zod
  `safeParse` rejects malformed input; pure-core returns typed errors for cross-row failures.
- The Schedule form renders the returned `WindowError` inline (via `useActionState`). The Policies form
  renders a validation message if the conditional rules fail.
- Deletion is scoped by `clubId`; a foreign or missing window returns `false`/`not_found` and is a
  no-op — never an error to another club's data.

## Testing

**Integration tests (real Postgres, `describe.skipIf(!TEST_DATABASE_URL)`, `migrate` in `beforeAll`):**

- `src/lib/schedule.integration.test.ts`
  - creates a window with boats; `listWindowsWithBoats` returns it ordered with joined boat names.
  - rejects `uneven_tiling` (e.g. 08:00–11:30 at 60 min).
  - rejects `end_before_start`.
  - rejects `overlap` on the same weekday; **allows** touching windows; allows same times on a
    different weekday.
  - rejects `invalid_boats`: empty set, a foreign-club boat, an inactive boat, a duplicate boat type,
    quantity < 1.
  - update **replaces** the boats set (old rows gone, new rows present) and updates the window fields.
  - cross-club scoping: `updateWindow`/`deleteWindow` with another club's `windowId` returns
    `not_found`/`false` and mutates nothing.
- `src/lib/scheduling-settings.integration.test.ts`
  - `updateSchedulingSettings` persists all seven fields; `getSchedulingSettings` reads them back.
  - `lead` mode with `bookingOpenLeadDays < 1` (or null) is rejected; `always` stores
    `bookingOpenLeadDays = null`.
  - cross-club scoping: cannot update another club's settings.

**Unit tests** (`src/lib/schemas.test.ts`): the new zod schemas — `windowSchema` (weekday range, HH:MM
format, positive session minutes, non-empty boats), `windowBoatSchema` (quantity ≥ 1), and
`schedulingSettingsSchema` (conditional lead-days refinement).

## Non-goals (explicit, deferred to 5B/later)

- **Slot/session generation** and any generation horizon — 5B.
- **Per-date holiday overrides** (`club_holiday_overrides`) — deferred to 5B, where the global holiday
  calendar and the generator (which consume them) first exist.
- Per-session or per-slot **overrides** (length/capacity/open/close/cancel) — 5B.
- Anything member-facing (browsing/booking) — 5C.

## File structure

**Create**
- `src/lib/schedule.ts` + `src/lib/schedule.integration.test.ts`
- `src/lib/scheduling-settings.ts` + `src/lib/scheduling-settings.integration.test.ts`
- `app/s/[slug]/manage/schedule/{page.tsx, actions.ts, schedule-editor.tsx, window-form.tsx}`
- `app/s/[slug]/manage/policies/{page.tsx, actions.ts, policies-form.tsx}`

**Modify**
- `src/lib/schemas.ts` + `src/lib/schemas.test.ts` — `windowSchema`, `windowBoatSchema`,
  `schedulingSettingsSchema`
- `app/s/[slug]/manage/_nav.tsx` — Schedule + Policies nav entries
- `app/s/[slug]/manage/page.tsx` — setup-checklist "schedule configured" item
- `messages/en.json`, `messages/tr.json` — new `manage.schedule.*` and `manage.policies.*` keys

**Note:** there is a `src/db/schema/schedule.ts` (the Drizzle table definitions). The new logic module
is `src/lib/schedule.ts` — a different directory; no collision.
