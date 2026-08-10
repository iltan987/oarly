# Oarly — Full Frontend UI/UX Run

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a set of well-built pages into one application — a shared shell, an account, honest language for restrictions, and an owner console that fits a phone and uses a desktop.

**Architecture:** A full-bleed header with one constant inner width owns the chrome on every surface, so the controls stop moving; content columns keep their per-section widths below it. Language, theme, account and sign-out collapse into one avatar menu. A new `restriction` read model replaces a duplicated `isBanned` boolean with three honest states. The owner console drops from eight flat tabs to four, with a sidebar above `lg:`.

**Tech stack:** Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 (CSS-first) · shadcn `base-nova` on **Base UI, not Radix** · next-intl (tr default) · next-themes · sonner · Drizzle · Better Auth.

---

## Context

Oarly's frontend is not badly built. The token system is real (per-club runtime brand accent,
semantic `ok/warn/bad/info` tones, custom radii, Space Grotesk + Manrope), accessibility is
deliberate and documented, every string goes through next-intl behind a key-parity guard *and*
a Turkish-vocabulary guard, pending states are componentised, and the booking calendar is
genuinely well-tuned. ~7,900 lines of non-test TSX, densely commented with the reasons behind
past fixes.

What is missing is one level up: **there is no application, only a set of pages.**

- **The chrome is copy-pasted onto 14 render sites across 11 files**, each hand-rolling its own
  `mx-auto max-w-* p-*` shell at one of five max-widths and three paddings. The controls sit
  top-right of a different box in each, so they jump on every navigation. Below ~480px the
  max-widths are inert and only the padding differs — so the phone case, the one that matters,
  is broken by 16 vs 24 vs 32px of gutter.
- **Three destinations exist but are unreachable.** `/account` was never built — six profile
  columns are written once at sign-up and are permanently uneditable. `/request-club` has zero
  inbound links from any page. `/privacy` is linked only from the sign-up consent line.
- **A restricted member is told nothing.** A 48-hour cooling-off and a permanent expulsion both
  render as one red "Askıda" pill. The reason is fetched and discarded (`app/page.tsx:102`
  renders `{row.isBanned ? null : …}`), and on the club landing page the CTA is replaced by the
  pill, so there is nothing to click at all. Meanwhile the *owner* marking the absence gets four
  carefully-worded strings explaining exactly what is about to happen to that member.
- **The owner console opens with four rows of chrome** before any content, eight nav tabs that
  wrap on a phone, and a 768px column on a 1440px screen. Across the whole repo there are 17
  breakpoint utilities and only 7 in app code — there is effectively no desktop layout anywhere.

Four decisions were taken before planning: consoles get a real desktop layout while member and
auth surfaces stay phone-first; the chrome becomes an avatar menu; discovery stays invite-link
only (fix reachability, no directory); visual change is limited to what is traceable to a defect.

### The one cross-cutting decision

The shell design and the console design collided on header width: one wanted a constant
`max-w-4xl` header, the other a 1440px console canvas — which would have put content *wider*
than the header and moved the controls between sections again, reproducing the reported bug.

**Resolution: one header, full-bleed, inner container `max-w-[90rem]` with `px-4 sm:px-6`, on
every surface without exception.** It is ≥ the widest content column (the console's 1280px), so
the avatar's x-position is a pure function of viewport width everywhere. Content columns keep
their existing per-section widths underneath. Section titles (`Manage`, the admin `<h1>`) live
in the **content column**, never in the header — `app/admin/layout.tsx:19-27` documents why that
element must remain a real `<h1>`.

---

## Global Constraints

- **Never hand-author or edit `src/components/ui/*`.** shadcn CLI only:
  `pnpm dlx shadcn@latest add <item>`. Custom components go in `src/components/`.
- **Base UI is not Radix.** Verify every primitive API against the installed `.d.ts` under
  `node_modules/@base-ui/react`. Radix recipes are wrong here, and the shadcn MCP reports the
  *default* style's dependencies, not `base-nova`'s — do not trust it for this project.
- All copy through next-intl. `messages/tr.json` and `messages/en.json` must stay key-parity
  (`src/i18n/messages-parity.test.ts`). That test compares key *sets between locales*; it cannot
  see a key that has gone dead, so **orphaned keys must be deleted by hand in the same commit**.
- Tenant pages use public paths (`/book`, `/manage`) in `<Link>` and `usePathname()` — never
  `/s/{slug}/…` (`app/s/[slug]/manage/_nav.tsx:20-29`). Cross-host links are absolute via
  `apexUrl()` / `clubUrl()`.
- Never delete, move, replace or symlink `node_modules`.
- Do **not** run the migration. `pnpm db:migrate` refuses non-localhost hosts; never point it at
  production.
- Every commit passes `pnpm lint`, `pnpm typecheck`, `pnpm test`. CI runs `tsc`; a fully green
  lint-and-test run has previously sat on a branch that did not compile.
- **A green test run is not evidence.** Before trusting any deliberate break, confirm the line
  removed was reachable. Never assert with a class selector that could match a nested shadcn
  primitive (`container.querySelector('.shrink-0')` matched a nested `button` and could never
  fail). If a layout claim can be rendered, render it — `/usr/bin/google-chrome` is available.

---

## Tasks

### Phase 1 — The shell

**Task 1 · Shared pure helpers.** `src/lib/initials.ts` (deletes the triplicate at
`app/page.tsx:16`, `app/s/[slug]/page.tsx:18`, `src/components/member-header.tsx:9`) and
`src/lib/nav-match.ts` — `activeNavIndex(pathname, items)`, the longest-prefix matcher extracted
from `app/admin/_nav.tsx:27-41` so manage and admin share one tested rule. `exact: true`
generalises admin's `/admin` case and manage's empty-href Overview. Both unit-tested;
`app/admin/_nav.test.tsx` must stay green **without editing its assertions**.

**Task 2 · The avatar menu.** `pnpm dlx shadcn@latest add dropdown-menu` (verified: `base-nova`
serves a Base UI implementation importing `@base-ui/react/menu`; there is no `menu` item).
Then `src/components/user-menu.tsx` with one optional `session` object — absent means guest, so
"signed out but has an accountUrl" is unrepresentable. Language and theme become
`DropdownMenuRadioGroup`s (radio items default `closeOnClick: false`; plain items default
`true`), Account and Sign out appear only when signed in.

Three things that are easy to get wrong:
- **The language re-click guard flips from unreachable to load-bearing.** `language-toggle.tsx:38-48`
  says `next === shown` cannot happen and instructs *"do not try to cover it with a test."* That
  dies here: `MenuRadioItem`'s click handler calls `setSelectedValue` unconditionally, so
  re-clicking the selected language would fire a cookie write, a rate-limit token, a `user.locale`
  UPDATE and a full-layout revalidate. **Keep the guard, test it, and rewrite the doc comment** —
  leaving the old one is worse than no comment. Also note `onValueChange` gives a scalar `any`,
  not `string[]`; wrap with `asLocale(String(value))`.
- **Drop the `sr-only` autonym** (`language-toggle.tsx:84`). It existed because the visible label
  was `TR` and the name was `Türkçe`; in a menu row the visible label *is* the autonym, so WCAG
  2.5.3 holds by construction. Leave a comment so nobody restores it.
- Bind theme to `theme`, not `resolvedTheme` — a three-option control must be able to show
  `system`, which the app defaults to and which the current toggle can never return to once
  tapped. Keep the mount guard only to avoid feeding `undefined` to a controlled radio group.

Both triggers (guest icon, signed-in avatar) must render at exactly `size-8`, or
`app/s/[slug]/page.tsx` shifts its own header between guest and member renders.

Absorb `sign-out-button.tsx` as a `closeOnClick={false}` destructive item, carrying both its
documented facts: `useFormStatus` cannot observe an `authClient` call, and `pending` is
deliberately never cleared because the browser is already unloading.

**Task 3 · `AppShell` / `AppHeader` / `AppFooter`, rolled out to all 14 render sites.**
Header per the resolution above. Content column keeps its section width via a `width` prop typed
as the Tailwind suffix (`'sm' | 'md' | '2xl' | '3xl' | '4xl'`) so a reviewer can diff it against
the deleted class by eye. Vertical padding moves to `h-14` on the header, which also pins the
avatar's **y** — today it drifts because manage puts a `text-2xl` `<h1>` in that row and
`/privacy` puts nothing.

Footer carries Privacy and Request-a-club on the entry/auth/legal surfaces only, with host-aware
hrefs (a `<Link href="/privacy">` on a club subdomain stays on the tenant host and 404s). The
signed-in-no-clubs empty state at `app/page.tsx:90` becomes the primary route to `/request-club`.

Delete `app-controls.tsx`, `sign-out-button.tsx`, `member-header.tsx`. `MemberTabs` moves into
the member layout's content column, unchanged. **Carry the `app-controls.tsx` doc comment's
knowledge forward into `app-header.tsx`**: its `min-w-0` / `shrink-0` conditional existed because
the leading slot was nested *inside* the cluster; as siblings of a `justify-between` row the
invariant flattens to an unconditional pair. Its replacement test must assert the header's
max-width class **does not vary with the `width` prop** — that is the test that guards the
reported defect.

### Phase 2 — The account

**Task 4 · `/account`.** First: add `'account'` to `RESERVED_APEX_SEGMENTS`
(`src/lib/tenant-routing.ts:14`) or `oarly.sbs/account` 301s to `account.oarly.sbs`. This is a
hard blocker, and it also reserves the slug for free via `src/lib/slug.ts:4-6`.

Schema by `.pick()` from `signUpSchema`, never restated, so the rules cannot drift; `birthday`
and `gender` were **never collected at sign-up**, so every existing row is NULL — present them as
genuinely unset, not defaulted. Do not import `paymentTypeEnum` into `src/lib/schemas.ts` (it is
imported by client components and would pull `drizzle-orm/pg-core` into the browser); restate the
literals and assert equality with the pg enum in a server-side test.

Action follows `requestClubAction`: `requireUser` → new `accountUpdatePerAccount` bucket → parse
→ persist. **The user id comes from the session and is never read from `formData`** — that is the
whole authorization story. The writer goes in `src/lib/user-profile.ts`, shaped like
`src/lib/user-locale.ts:18` and for its stated reason (a `Db` parameter cannot cross a
`'use server'` boundary). It must also rewrite `user.name`, or editing your first name won't
change your avatar. Revalidate `'/'` at layout scope, since the header renders on every route.

Copy must be honest that `defaultPaymentType` is a per-user default with per-club meaning: a club
with `multisportEnabled = false` silently books you as Regular.

### Phase 3 — The restricted member

**Task 5 · The restriction read model.** `src/lib/restriction.ts`: `none` / `paused` /
`suspended`, replacing the byte-identical `computeIsBanned` at `app/page.tsx:25` and
`app/s/[slug]/page.tsx:27`. The state test must be the same two checks in the same order as
`checkEligibility` (`src/lib/eligibility.ts:22,27`) — `status === 'banned'` first, then strict
`>` on `bannedUntil`. Two different answers to "am I restricted?" is worse than either.

The batched loader must: short-circuit **before** constructing `inArray` (this is also the hot
path — a healthy member costs zero extra queries); use `permanent = true OR banned_until > now`
(a permanent penalty has `banned_until IS NULL` and would otherwise vanish, leaving the most
serious restriction as the only unexplained one); LEFT-join `penalties → sessions → slots` at
**both** hops; and pick the cause from *the ban in force*, not the newest row — `resolveBan` is a
max, so a 2-day penalty written yesterday does not supersede a 1-month one written last week.
Also add a `penalties(membership_id)` index — the table has only `penalties_booking_uq` today.

`src/lib/club-cta.ts` turns the club landing page's six nested ternaries into a pure
`viewerKindOf`, with `restricted` deliberately **above** `owner` so a future relaxation cannot
hand a suspended owner the Manage button.

**Task 6 · `RestrictionNotice` and the surfaces.** An async server wrapper (for `getFormatter`,
since the club timezone varies per row) delegating to a pure view that takes only strings, so it
is testable. Tells the member, in order: **when it lifts** (date *and* time — the `07:00` is
load-bearing), **why** (which is what makes it a consequence rather than a verdict, and the only
way to notice the owner made a mistake), and **what to do** (suspended only). Not penalty counts,
not the club's policy, not distance to a worse penalty.

The vocabulary is the highest-value change in this plan: **Askıda / Suspended** stays for the
permanent case only; the self-expiring case becomes **Duraklatıldı / Paused** — the media-player
sense, read as "it resumes by itself", with no disciplinary charge. Add a Turkish-vocabulary
guard alongside `src/i18n/tr-role-nouns.test.ts`, which exists for exactly this class of
regression ("copy is the kind of change that gets tidied back by someone who sees two words for
what looks like one idea").

Surfaces: apex root row (fills the slot currently hard-`null`ed, and the dead pill becomes an
"Open club" link); club landing page (plus the one-line `signOutUrl` fix at `:63` — the user is
in scope one line above and unused, and adds My bookings + Booking calendar, ending the dead
end); `/book` (the existing banner moves out of the client component into the page); `/bookings`.

**Task 7 · `bookings.cancelled_reason`.** Three cancellation sites, grepped exhaustively:
`booking.ts:231` `member`, `booking.ts:256` `owner`, `attendance.ts:159` `penalty`. Nullable with
no default — `NOT NULL DEFAULT 'member'` would retro-label every historical owner-removal and
penalty cascade as a self-cancellation, inventing the exact fact the column exists to record.
`member` and `null` render identically for the same reason.

Hand-prepend `SET LOCAL lock_timeout = '5s'` as `drizzle/0009` does. **Note the migration test
(`src/db/migrations.integration.test.ts:29`) matches the literal prefix `'0009_'` and will pass
regardless of what this migration contains — do not read its green as coverage.**

Owner-facing rendering is **out of scope and the earlier findings doc was wrong about it**:
`src/lib/roster.ts:10` sets `VISIBLE = ['booked','waitlisted','no_show']`, so cancelled rows never
reach the owner's roster at all. Named as the immediate follow-up.

**Task 8 · Member-surface polish.** `EmptyState` (title/body/action, no copy inside) replacing
`t('none')` used for both `/bookings` sections. `ConfirmDialog` in `src/components/` — six
hand-rolled instances exist today; it must require every label as a prop (a `dismissLabel =
'Cancel'` default is how untranslated copy gets into a Turkish-default app) and own the
mount-only-while-open rule that `decision-buttons.tsx:59-61` documents.

**Gate seat cancellation.** `cancelBooking` calls `applySeating` in the same transaction, so on a
full session the seat is gone the instant it commits and rebooking means the back of a queue the
club may cap at zero. An action whose undo may be impossible, on an `xs` button in a dense row on
a phone, is exactly the class this codebase already gates everywhere else. Dismiss label is
**"Keep my seat"**, not "Cancel" — otherwise the dialog reads "Cancel / Cancel", violating the
distinct-accessible-name rule at `decision-buttons.tsx:80-81`.

### Phase 4 — The console

**Task 9 · Manage IA + desktop layout.** Eight tabs → **Overview · Bookings · Members ·
Settings**, with the five setup pages behind a `/manage/settings` index. **No URLs change.** The
index carries state summaries, not a menu of five words — "4 boats, 2 active", "6 windows across
4 days" — from existing lib functions in one `Promise.all`. Policies costs **zero** queries:
those columns are on the `clubs` row `requireOwner` already returned, so do not call
`getSchedulingSettings`.

Delete the completed-setup `<details>` at `manage/page.tsx:127-136` — it is a second, worse copy
of the settings index. Move the two "view public page / view as member" links to the bottom of
the settings index: they are exits from the console, not navigation within it, and grouping them
with the nav cost a whole chrome row. **Phone chrome goes from four rows to two.**

`ConsoleShell` composes `AppShell` (Task 3) and adds sidebar + canvas below the shared header:
`lg:w-56` nav, `min-w-0 flex-1 lg:max-w-5xl` content. `min-w-0` is load-bearing — without it one
long member name pushes the sidebar off-screen. Canvas caps at 1024px deliberately: past ~1000px
a destructive control sits a hand-span from the name it belongs to, which is a mis-click hazard
on a 25-row roster. Width should buy alignment, not distance.

Back links (not breadcrumbs — a breadcrumb would assert a URL hierarchy that deliberately does
not exist) on the five settings pages. **No mobile drawer and no new shadcn item**: four Turkish
labels wrap to two rows at 360px, and two rows of visible destinations beat one row plus a
hamburger hiding all four. Admin's fifth tab `New club` is a create action wearing a nav tab —
demote it to a button beside the search.

**Task 10 · Members at scale.** Search + pagination transposed line-for-line from
`src/lib/users-admin.ts:49-110`, including the `count(*)` **before** `clampPage` and the
`(name, id)` tie-break (names repeat in a rowing club; a non-total order makes offset pages
overlap). **Pending is never paginated and never searched** — it is a work queue that drains, and
hiding a join request behind page 2 of a search typed to find someone else is how a request sits
unanswered for a month.

Density: 200 separate cards become one `divide-y` list, and at `lg:` the ragged flex row becomes
`grid-cols-[1fr_auto_12rem]` so all skill-level selects align down the page — assigning levels to
30 members becomes one vertical pass instead of 30 horizontal hunts.

Fix `toLocaleDateString('en-GB')` at `members/page.tsx:81` via `getFormatter()` — **and at
`bookings-roster.tsx:366`, which the earlier findings missed.** That one feeds
`confirmAbsentBan`'s `{date}`: the sentence telling a Turkish owner how long they are banning a
member renders its date in English. Same class, higher stakes.

Three distinct empty states plus **hiding the pending section entirely when empty**. Reusing one
string under `?q=` would reintroduce on `/manage` the exact bug `app/admin/page.tsx:69-73` already
fixed and documented.

**Gate member reject, leave approve one-click** — the asymmetry is this codebase's own rule
(`club-status-button.tsx:13-30`): the destructive direction confirms and names its subject, the
restorative direction does not. Reject is terminal in practice: the row vanishes from every
surface with no list that shows it and no control to undo it. **The trap:** moving the submit into
a portalled Base UI dialog breaks the `has-data-pending:` CSS bridge at `members/page.tsx:46`.
Carry the `pendingRejectId` + hoisted `useActionState` shape from `bookings-roster.tsx:46,71-80`
verbatim.

**Task 11 · Roster and admin density.** On `/manage/bookings` change **two container lines and
nothing else** — `items-start` on the new `lg:grid-cols-2` is mandatory, not cosmetic: grid rows
stretch by default, so a card growing by one optimistic seat would move its *neighbour's* Remove
buttons, the exact delayed reflow `bookings-roster.tsx:56-60` exists to prevent. Highest-risk
change in the plan; fallback is one column at `lg:max-w-3xl`. Admin lists get `lg:` grid
alignment and `max-w-md` on the search inputs — a 1024px box for a 20-character club name is the
unbounded-canvas defect in miniature.

**Task 12 · Error and loading boundaries.** The rule that decides the design: **an `error.tsx`
catches throws in its segment's children, not in its own `layout.tsx`.** So `app/global-error.tsx`
(the only thing that catches a throw in the root layout — and it **cannot** use next-intl, because
the intl provider is what failed; that needs a comment), `app/error.tsx` (catches
`app/s/[slug]/layout.tsx`'s `requireClub`, which nothing inside `/s/[slug]` can),
`app/s/[slug]/{error,loading}.tsx`, `app/(auth)/error.tsx`, `app/request-club/error.tsx`. Skip
`/privacy` — a boundary with nothing to catch is noise. Re-home `route-error.tsx`'s copy from the
`booking` namespace to `common`; it already serves `/admin` and manage.

**Verify by URL, not by reasoning:** `requireOwner`/`requireClub` throw `redirect()` and
`notFound()`, and `app/error.tsx` is the first boundary in this repo positioned above the tenant
layout. Confirm an unknown slug still renders the 404 and a signed-out owner still redirects.

**Task 13 · Normalize the three `void` actions.** `deleteWindowAction` and both
`schedule/preview` actions return nothing while every other mutation returns a typed result —
`schedule/actions.ts:43-49` already contains this TODO in prose. Real payoff: today, closing a
date with a malformed value silently no-ops and the owner watches the calendar not change. Land
this **last**; it is orthogonal and can be dropped without unpicking anything.

---

## Explicitly out of scope

The label-passing convention (manage editors take ~25 pre-resolved label strings as props while
`ManageNav`/`MemberTabs` call `useTranslations` directly) — a real inconsistency with no
user-visible payoff. The `skill-levels/page.tsx:17` N+1. Renaming `AdminPagination`. Surfacing
cancelled bookings on the owner roster. Persisting `user.theme` (a dead column, and the exact bug
`setUserLocale` was written to fix for `locale` — worth its own small follow-up). An owner control
to lift a permanent suspension: none exists today, and `setMemberStatus('approved')` would not
work because the permanent `penalties` row survives and `recomputeBan` re-bans. The restriction
copy must therefore say "contact the club", **not** "ask the club to remove it".

---

## Verification

**Per task:** `pnpm lint && pnpm typecheck && pnpm test`, plus
`pnpm test:integration` for Tasks 5 and 7.

**Traps this plan's tests must not fall into.** For the empty-list short-circuit,
`expect(size).toBe(0)` passes whether or not the short-circuit exists — pass a stub whose
`.select` throws and assert it resolves. For the `cancelled_reason` writes, assert the column
value read back from the database, not `status === 'cancelled'` (already true before the change).
For the cancel gate, assert the row button does **not** invoke the action — a test that only
checks the dialog's confirm passes with the gate deleted. For the boundary test on
`bannedUntil === now`, both timestamps must come from one literal, or `>` and `>=` both pass.

**Browser measurement** (headless Chrome at `/usr/bin/google-chrome`), at 360/390/768/1024/1440,
both themes, **Turkish** — it is the locale that overflows:

1. **The acceptance test for the whole run:** the avatar's `getBoundingClientRect().right` is
   identical across `/`, `/sign-in`, `/privacy`, `/admin`, `slug.root/`, `/book`, `/manage` at
   each viewport.
2. The four-tab strip is ≤ 2 rows at 360px in Turkish. The entire no-drawer decision rests on
   this one measurement; if it renders as 3, add `sheet`.
3. `documentElement.scrollWidth === clientWidth` at 1024 and 1440 on `/manage/bookings` and
   `/manage/members`, seeded with a 60-character member name.
4. **Roster grid:** with two sessions of unequal height, an optimistic add on one card must not
   move the other card's buttons by a single pixel.
5. Re-clicking the selected language fires **zero** network requests.
6. Exactly one `aria-current="page"` on all seven manage URLs.
7. **Regression guard on surfaces this run does not intend to change** — capture the controls'
   box on `/`, `/book`, `/sign-in`, `/privacy`, `/not-found` before *and* after. The last flexbox
   fix in this repo silently regressed the surface that was already correct.
8. `birthday` round-trips into `<input type="date">` after a save — drizzle returns a string,
   Better Auth declares a `Date`, and the wrong one renders blank with no error.
9. `oarly.sbs/account` renders rather than 301ing to a subdomain, and the menu's Account link
   crosses from a club subdomain to the apex.

Manual pass is yours — I won't propose it as a step.
