# Plan 4 — Club Profile, Boats & Skill Levels (Design)

**Date:** 2026-07-16
**Status:** Approved (brainstorming), pending implementation plan
**Parent spec:** `docs/superpowers/specs/2026-07-15-oarly-design.md` (§7 Boats/Skill Levels, §16 Accounts & Profile, §6 per-club metadata)
**Sequence:** Plan 4 of 8. Follows Plan 3 (accounts/clubs/join, merged @ `2c23cdc`).

## Goal

Give a club **owner** the configuration surface for their club's identity and the
data the booking engine (Plan 6) will consume: **public profile** (incl. logo),
**skill levels** (club-defined, ordered), and **boat types** (with per-boat
eligibility). The recurring **schedule/slot template is explicitly out of scope**
— it gets its own later plan, and the guided setup wizard (design 5e) lands then,
built once, complete.

## Architecture

Identical to the pattern Plan 3 established and the reviews validated:

- **Guard → validate → pure core → revalidate.** Server actions are thin
  adapters: `requireOwner(slug)` (from `src/lib/membership.ts`) → zod parse
  (server-side validation is always authoritative) → call a pure-core logic
  function that takes `db: DB` first → `revalidatePath`.
- **Pure core is integration-tested** against real Postgres (test PG on :5433),
  every write **scoped by `clubId`** so one club can never mutate another's rows
  (the cross-tenant discipline from Plan 3's `members-admin`/`clubs-admin`).
- Owner editors live under `app/s/[slug]/manage/*`, behind the existing
  `manage/layout.tsx` `requireOwner` guard.

The schema **already exists** — `boat_types`, `skill_levels`, and most `clubs`
columns were scaffolded during foundation hardening. Plan 4 adds: logic modules,
UI, one small migration (two profile columns), zod schemas, a Blob upload route,
and a manage nav + setup checklist.

## File structure

**Create**
- `src/lib/club-profile.ts` + `src/lib/club-profile.integration.test.ts`
- `src/lib/skill-levels.ts` + `src/lib/skill-levels.integration.test.ts`
- `src/lib/boats.ts` + `src/lib/boats.integration.test.ts`
- `app/s/[slug]/manage/profile/{page.tsx,actions.ts,profile-form.tsx,logo-upload.tsx}`
- `app/s/[slug]/manage/skill-levels/{page.tsx,actions.ts,skill-levels-editor.tsx}`
- `app/s/[slug]/manage/boats/{page.tsx,actions.ts,boat-form.tsx,boat-list.tsx}`
- `app/s/[slug]/manage/_nav.tsx` (shared manage nav)
- `app/api/club-logo/upload/route.ts` (Vercel Blob client-upload token handler)
- Drizzle migration adding `clubs.tagline`, `clubs.description`

**Modify**
- `src/db/schema/clubs.ts` — add `tagline`, `description` columns
- `app/s/[slug]/manage/layout.tsx` — render `_nav`
- `app/s/[slug]/manage/page.tsx` (or create it) — setup checklist
- `src/lib/schemas.ts` — zod schemas for profile / skill level / boat inputs
- `src/lib/seo.ts` — use `description`/`tagline` + logo for OG metadata
- `src/lib/env.ts` (t3-env) — add `BLOB_READ_WRITE_TOKEN` to the server schema
- `package.json` — add `@vercel/blob`
- messages (`messages/tr.json`, `messages/en.json`) — new `manage.*` keys

## Data model changes

One migration, additive, nullable — no enum changes, no backfill:

```
clubs.tagline      text        -- short one-liner for cards / OG
clubs.description   text        -- longer public blurb
```

`clubs.logo_url` already exists. Boats (`boat_types`), skill levels
(`skill_levels`), and club socials (`club_socials`) are already fully modeled
(see `src/db/schema/{boats,clubs}.ts`). Existing eligibility columns on
`boat_types`: `name`, `seats`, `min_skill_level_id?` (FK → `skill_levels`,
`on delete set null`), `allowed_payment` (`regular_only|multisport_only|both`),
`min_attendance?`, `active`.

## Feature: Skill levels editor

Club-defined, **ordered** levels (`skill_levels.rank`, unique per club via
`skill_levels_club_rank_uq` on `(club_id, rank)`). Operations:

- **Add** — appends at `max(rank)+1` for the club (starts at 1 for an empty club).
- **Rename** — updates `name`, scoped by `(id, club_id)`.
- **Reorder** — **up/down arrows** that swap a row with its neighbor.
- **Delete** — allowed; FK `on delete set null` demotes referencing memberships
  (`skill_level_id`) and boats (`min_skill_level_id`). Behind a confirm dialog
  that **shows how many members and boats reference the level** before deleting.
  Delete leaves a rank gap — harmless, since eligibility compares *relative*
  rank, not contiguity.

**The tricky bit — reorder under the unique index.** Swapping two adjacent rows
would transiently collide on `(club_id, rank)` (the index is checked immediately,
not deferrable). The swap therefore runs in **one transaction using a sentinel
temp rank**: park row A at a rank guaranteed unused (a negative sentinel), set
row B to A's old rank, then set A to B's old rank. This is the single most
error-prone piece of the plan and gets its own integration test asserting both
final ranks and that no unique-violation is thrown.

**UI** (matches design 5a): a list of rows, each `name [↑] [↓] ✎ ✕`, with an
"+ add level" affordance. Rename inline or via a small dialog.

## Feature: Boats editor

Boat *types* (v1 configures types, not individual hulls — physical inventory is
post-v1 per spec §non-goals). Operations: **add / edit / soft-deactivate**.

- **Soft-deactivate only — never hard-delete.** Future sessions/bookings will
  FK-reference a boat type; `active` (bool, default true) toggles availability.
  Deactivated boats stay in the DB and in historical data.
- **Fields:** `name`; `seats` (capacity, integer ≥ 1); `min_skill_level_id`
  (dropdown of this club's levels, or "no requirement"); `allowed_payment`
  (radio: regular-only / multisport-only / both); `min_attendance` (optional
  advisory, integer, must be ≤ `seats` when set).
- Validation (zod, server-authoritative): `seats ≥ 1`; `min_attendance`, if
  present, `≥ 1` and `≤ seats`; `min_skill_level_id`, if present, must belong to
  the same club (verified against the DB, like `assignSkillLevel` does today).

**UI** (design 5a): list of boat cards showing seats + eligibility summary, an
add/edit form, an active/inactive toggle.

## Feature: Public profile editor + logo upload

Owner-managed public profile (spec §16). Editable fields: `name`, `tagline`,
`description`, `phone`, **socials** (`club_socials` add/remove rows: platform +
handle), `brand_accent` (hex, validated), `heading_font` (`default`/`premium`).

**Logo — Vercel Blob client-upload.** Chosen over a server-action `put()`
because Next.js server actions carry a ~1 MB request-body limit that a logo can
exceed. Flow:

1. Browser calls `upload()` (`@vercel/blob/client`), pointing at our route
   `app/api/club-logo/upload/route.ts`.
2. The route's `handleUpload` callback (`onBeforeGenerateToken`) **authorizes**:
   requires an authenticated **owner of this club**, and restricts
   `allowedContentTypes` to `image/png|jpeg|webp|svg+xml` and a **max size of
   2 MB**. Only then does it hand back a scoped upload token.
3. Blob returns the public URL; the client sets it into the profile form, and the
   profile save persists it to `clubs.logo_url`.

Auth + type + size are enforced **at token-grant time on the server** — the
browser cannot bypass them. (Exact `@vercel/blob` client-upload API to be
verified via Context7 when writing the implementation plan.)

**OG image.** `src/lib/seo.ts` uses the uploaded `logo_url` for OG/Twitter image
when present; otherwise it falls back to a dynamically generated `ImageResponse`
built from the club name + `brand_accent`. `description`/`tagline` feed the OG
description (replacing today's name-derived stub). This closes the Plan 2
carry-forward.

## Feature: Manage nav + setup checklist

- `manage/layout.tsx` renders `_nav.tsx`: **Profile · Skill levels · Boats ·
  Members** (Members already exists from Plan 3). Active-link styling.
- The manage index (`manage/page.tsx`) is a **setup checklist** — the standalone
  stand-in for the deferred wizard. Each item reflects real state and links to
  its editor:
  - "Add skill levels" — done when the club has ≥ 1 skill level.
  - "Add boats" — done when the club has ≥ 1 active boat.
  - "Complete your public profile" — done when `tagline`/`description` are set.
  New owners land here and are nudged through setup.

## Testing

- **Integration (real PG, cross-club scoping asserted everywhere):**
  - skill-levels: add/rename/delete; **reorder swap** correctness (final ranks +
    no unique violation) via the sentinel-rank path; delete null-outs references;
    a club cannot touch another club's levels.
  - boats: add/edit/deactivate; validation (seats, min_attendance ≤ seats,
    foreign skill level must be same-club); cross-club scoping.
  - club-profile: update fields; socials add/remove; cross-club scoping.
  - seo: OG metadata uses tagline/description + logo, active-only index preserved.
- **Unit:** zod schemas (accept valid, reject invalid — hex accent, seats bounds,
  min_attendance ≤ seats, required-field rules).
- **Guard:** `app/api/club-logo/upload` route rejects a non-owner (no token
  granted).
- **Green bar before merge:** `pnpm lint` (0, `--max-warnings 0`), `tsc`, unit,
  integration, `build`.

## Decisions locked during brainstorming

1. **Scope** = profile + boats + skill levels. Schedule/slots deferred to a later
   plan; setup wizard deferred with it.
2. **Logo** = real Vercel Blob upload (client-upload with a server-authorized
   token), not a URL field.
3. **Kickoff** = standalone editors + setup checklist, not a partial wizard.
4. **Skill reorder** = up/down arrows (neighbor swap), transactional with a
   sentinel temp rank.
5. **Boats** = soft-deactivate only. **Skill levels** = delete allowed with a
   reference-count confirmation (FK set-null handles demotion).

## Carry-forwards addressed by this plan

- Plan 2: real `tagline`/`description` + OG image on `clubs` (the profile editor).
- Plan 3: `assignSkillLevel` membership-status gate — revisit while the skill
  level surface is open (a member's level shouldn't be assignable if not
  approved). Small, fold into this plan's skill/member scoping review.
- Plan 3: shadcn base-nova `Separator`/`FieldSeparator` `data-orientation` CSS
  fix (additive `@custom-variant` in `app/globals.css`) — apply if/when a bare
  Separator is first rendered by these editors.

## Out of scope (explicit)

- Recurring schedule windows, window-boats, slot/session generation (later plan).
- The guided setup wizard (design 5e) — lands with schedule.
- Physical boat inventory (named hulls, maintenance) — post-v1.
- Member-facing consumption of this config (booking) — Plan 6.
