# Member Self-Service and Restriction Transparency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member always knows where they stand and can always get somewhere: restrictions are explained in plain language, no page is a dead end, and profile details are editable.

**Architecture:** One pure `resolveRestriction` replaces a duplicated `isBanned` boolean with three states (none / paused / suspended). One batched `getRestrictionReasons` reads the `penalties` table — which no member-facing surface reads today. One `RestrictionNotice` component renders the explanation on all three surfaces so the wording cannot drift. The club landing page becomes signed-in aware, and a new apex `/account` page makes the `user` profile columns editable for the first time.

**Tech Stack:** Next.js 16.3.0 App Router, next-intl 4 (no i18n routing), Drizzle + Postgres, Better Auth, shadcn `base-nova` on `@base-ui/react`, Vitest (node + jsdom).

**Spec:** `docs/superpowers/specs/2026-08-09-oarly-member-self-service-design.md` — §3 defines the three states, §5 the no-dead-ends table, §6 the account page's exclusions.

## Global Constraints

- **Never hand-author or edit `src/components/ui/*`.** shadcn-CLI-managed; add primitives with `pnpm dlx shadcn@latest add <name>` and commit CLI output unmodified. Custom components go in `src/components/`.
- **Never add `Co-Authored-By` or any AI-attribution trailer to a commit message.**
- Every user-facing string goes in **both** `messages/tr.json` and `messages/en.json`. Turkish is the primary voice; English must read as English. `src/i18n/messages-parity.test.ts` must keep passing.
- **`pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` before every commit.** The typecheck is not optional — this repo has already shipped a branch that was green on lint and tests and did not compile.
- Test DB is `postgresql://postgres:postgres@localhost:5433/oarly_test` (what `pnpm test:integration` sets). **Never** point anything at port 5434 (dev) or a remote host. Never drop `oarly_test`. Never run `pnpm db:migrate` against anything but localhost.
- **This plan adds no migrations.** `drizzle/` must be untouched at the end of every task. Everything needed already exists in `penalties`, `memberships` and `user`.
- A `'use server'` module may only export async Server Actions; helpers taking a `db` handle live elsewhere.
- Dates are **club-local**, never viewer-local. Any date shown to a member is formatted with the club's `timezone`.
- Mutation-check every new test: change the code it covers, confirm a real `N failed | M passed` kill, revert, and report the observed output. `0 tests` is a broken suite, not a pass.

---

### Task 1: `resolveRestriction` and `getRestrictionReasons`

**Files:**
- Create: `src/lib/restriction.ts`, `src/lib/restriction.test.ts`, `src/lib/restriction.integration.test.ts`

**Interfaces:**
- Consumes: `memberships`, `penalties` from `@/db/schema`; `DbOrTx` from `@/db`.
- Produces: `Restriction`, `resolveRestriction(input)`, `getRestrictionReasons(db, membershipIds)`.

- [ ] **Step 1: Write the failing unit test** (`src/lib/restriction.test.ts`)

Cover, with `now` fixed and injected:
- `status: 'approved'`, `bannedUntil: null` → `{ kind: 'none' }`
- `bannedUntil` an hour in the future → `{ kind: 'paused', endsAt }`
- `bannedUntil` an hour in the past → `{ kind: 'none' }` (a lapsed penalty restricts nothing)
- **`bannedUntil.getTime() === now.getTime()` → `{ kind: 'none' }`** — this is the boundary that must agree with `checkEligibility` (`src/lib/eligibility.ts:27`), which refuses only while `bannedUntil > now`. Two different answers to "am I restricted?" is worse than either answer alone. Add a comment saying so.
- `status: 'banned'`, `bannedUntil: null` → `{ kind: 'suspended' }`
- `status: 'banned'` **and** a future `bannedUntil` → `{ kind: 'suspended' }` (permanent wins)
- `status: 'pending'` / `'rejected'` with any `bannedUntil` → `{ kind: 'none' }` — those members are not restricted, they are not members yet, and the caller renders a different branch.

- [ ] **Step 2: Run it, confirm it fails**

`pnpm test src/lib/restriction.test.ts` → FAIL (cannot resolve). Confirm the count is 7, not `0 tests`.

- [ ] **Step 3: Implement `resolveRestriction`**

```ts
export type Restriction =
  | { kind: 'none' }
  | { kind: 'paused'; endsAt: Date }
  | { kind: 'suspended' };

/**
 * The member's restriction as the UI needs to state it.
 *
 * Replaces `computeIsBanned`, which existed as two byte-identical copies (app/page.tsx,
 * app/s/[slug]/page.tsx) and collapsed a 48-hour automatic timeout and a permanent
 * expulsion into one red "Suspended" pill. They are different events and the member's
 * next action differs, so they are different states here.
 *
 * Reads `status`, not `penalties.permanent`: `recomputeBan` persists a permanent penalty
 * as `memberships.status = 'banned'`, so the membership row alone carries the split.
 * `penalties.permanent` stays the domain's source of truth; this is the read model.
 *
 * `now` is injected rather than read from the clock so the boundary is testable — and the
 * boundary matters: `checkEligibility` refuses only while `bannedUntil > now`, so at
 * exactly `bannedUntil === now` the member may book and this must say `none`.
 */
export function resolveRestriction(
  { status, bannedUntil, now }: { status: string; bannedUntil: Date | null; now: Date },
): Restriction {
  if (status === 'banned') return { kind: 'suspended' };
  if (status !== 'approved') return { kind: 'none' };
  if (bannedUntil != null && bannedUntil.getTime() > now.getTime()) {
    return { kind: 'paused', endsAt: bannedUntil };
  }
  return { kind: 'none' };
}
```

- [ ] **Step 4: Run it, confirm it passes.** Then mutate `>` to `>=`, confirm the boundary test FAILS, report the output, revert.

- [ ] **Step 5: Write the failing integration test** (`src/lib/restriction.integration.test.ts`)

Follow the house pattern: `describe.skipIf(!process.env.TEST_DATABASE_URL)`, own `Pool`, `migrate()`, **`randomUUID()` for every fixture id — never `Date.now()` or `performance.now()`, which are millisecond-resolution and collide in tight loops** (this repo has shipped that defect to CI once already).

Cases:
- Two memberships with live penalties → one map with both keys, from **one** query.
- **An empty `membershipIds` array returns an empty map and issues no query.** Assert by spying on the db handle, or by passing a handle whose `select` throws — an `inArray(col, [])` is a syntax error in some drivers and a silent full scan in others.
- A **permanent** penalty (`banned_until IS NULL`, `permanent = true`) IS returned. This is the case a naive `banned_until > now` filter silently drops.
- An expired penalty is NOT returned.
- Two live penalties on one membership → the **newest** wins (assert on `sessionStartAt`, seeded distinctly).
- A membership with no penalty is **absent from the map**, not present with nulls (`expect(map.has(id)).toBe(false)`).

- [ ] **Step 6: Run it, confirm it fails.** Confirm 6 tests collected, not `0`.

- [ ] **Step 7: Implement `getRestrictionReasons`**

```ts
/**
 * The live penalty behind each membership's restriction, newest first, one per membership.
 *
 * Batched because the root page lists every club a member belongs to; a per-membership
 * call would be an N+1 on the product's most-loaded page.
 *
 * The predicate is `permanent OR banned_until > now`, NOT `banned_until > now` alone: a
 * permanent penalty has a NULL `banned_until` and would vanish from the result, leaving
 * the most serious restriction as the only one with no explanation.
 *
 * `reason` is returned raw. The UI maps known values to copy and falls back to a generic
 * line, so a reason added later can never render as blank space or a raw enum value.
 */
export async function getRestrictionReasons(
  db: DbOrTx,
  membershipIds: string[],
  now = new Date(),
): Promise<Map<string, { reason: string; sessionStartAt: Date | null }>> {
  // `inArray(col, [])` is a syntax error in some drivers and a full scan in others.
  if (membershipIds.length === 0) return new Map();
  const rows = await db
    .select({
      membershipId: penalties.membershipId,
      reason: penalties.reason,
      createdAt: penalties.createdAt,
      sessionStartAt: slots.startAt,
    })
    .from(penalties)
    .leftJoin(sessions, eq(sessions.id, penalties.sessionId))
    .leftJoin(slots, eq(slots.id, sessions.slotId))
    .where(and(
      inArray(penalties.membershipId, membershipIds),
      or(eq(penalties.permanent, true), gt(penalties.bannedUntil, now)),
    ))
    .orderBy(desc(penalties.createdAt));

  const out = new Map<string, { reason: string; sessionStartAt: Date | null }>();
  for (const r of rows) {
    // Ordered newest-first, so the first row seen per membership wins.
    if (!out.has(r.membershipId)) out.set(r.membershipId, { reason: r.reason, sessionStartAt: r.sessionStartAt });
  }
  return out;
}
```

Both joins are `leftJoin`: `penalties.sessionId` is nullable (`on delete set null`, and the column's own comment anticipates a manually-issued penalty with no session). An inner join would drop exactly those rows.

- [ ] **Step 8: Run it, confirm it passes.** Then mutate the `or(...)` down to `gt(penalties.bannedUntil, now)` alone and confirm the permanent-penalty test FAILS. Report the output. Revert.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(member): resolve a membership restriction into three states"
```

---

### Task 2: `RestrictionNotice`

**Files:**
- Create: `src/components/restriction-notice.tsx`, `src/components/restriction-notice.test.tsx`
- Modify: `messages/tr.json`, `messages/en.json`

**Interfaces:**
- Consumes: `Restriction` from `@/lib/restriction`.
- Produces: `<RestrictionNotice restriction reason timezone clubPhone variant />`.

- [ ] **Step 1: Add the `restriction` message group** to both catalogues, exactly the seven keys in the spec's §7 table, same relative position in both files.

- [ ] **Step 2: Write the failing component test**

Use the repo's jsdom convention (`// @vitest-environment jsdom`, key-echo `next-intl` mock — mock `useTranslations` **and** `useFormatter`/`useLocale` if the component uses them; a factory replaces the whole module, and a missing export surfaces as `undefined is not a function`).

Cases:
- paused → renders the paused copy with a formatted date, and the reason line.
- **The date renders in the club's timezone, not the runner's.** Pass a `timezone` deliberately different from the test runner's `TZ` and assert the club-local time appears. Without this the whole "07:00 means 07:00" point is untested.
- suspended → renders the suspended copy, the contact line, and the phone when given.
- suspended with `clubPhone: null` → still renders the contact line (it names the club), no empty element.
- unknown `reason` value (e.g. `'manual'`) → the generic line, never a blank.
- `reason: null` → no reason line at all, and no crash.

- [ ] **Step 3: Run it, confirm it fails.** Confirm the test count, not `0 tests`.

- [ ] **Step 4: Implement the component**

Two variants: `inline` (one compact muted line, for a club row) and `banner` (the bordered block already at `app/s/[slug]/(member)/book/book-calendar.tsx:361` — copy its classes so the booking page's appearance does not change beyond the tone and the added reason). Tone follows the state: paused → the `warn` palette, suspended → the `bad` palette. Use the tone classes the repo already uses in `src/components/booking-status-badge.tsx`; do not invent new colour tokens.

Format dates with `next-intl`'s formatter and an explicit `timeZone`, matching the existing call at `book-calendar.tsx:366` (`day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'`).

- [ ] **Step 5: Run it, confirm it passes.** Mutate the timezone prop out of the format call (so it falls back to the runner's zone) and confirm the timezone test FAILS. Report the output. Revert.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(member): add the restriction notice component"
```

---

### Task 3: Root page — explain, and stop being a dead end

**Files:**
- Modify: `app/page.tsx`
- Create: `app/page.test.tsx`

- [ ] **Step 1: Write the failing page test.** Mock the db module and `@/lib/session` following the pattern in `app/admin/page.test.tsx`. Assert:
  - a **paused** row renders the paused pill, a date, **and a link to the club** (today there is no link at all — this is the regression test for the reported bug);
  - a **suspended** row renders the suspended pill and a link;
  - a row whose `bannedUntil` has lapsed renders as an ordinary member row with a booking link;
  - an approved row is unchanged.

- [ ] **Step 2: Run it, confirm it fails.** Confirm the count.

- [ ] **Step 3: Rewrite the banned branches.**

- Delete the local `computeIsBanned` (`app/page.tsx:25`) and use `resolveRestriction`.
- Add `memberships.id`, `clubs.timezone` and `clubs.phone` to the select — the reason map is keyed by membership id, and the notice needs club-local formatting and the phone.
- Call `getRestrictionReasons` **once**, after the club query, with the ids of only the restricted rows. Not one call per row.
- Replace the blanked note slot (`{row.isBanned ? null : …}`) with `<RestrictionNotice variant="inline" …/>` for restricted rows.
- **Replace the pill-instead-of-CTA branch with a link to the club** plus the pill. A restricted membership must stop being a dead end; the club landing page (Task 4) is where they can go next.
- Make the `signedInAs` line a link to `/account`. That route does not exist until Task 5 — that is expected and fine within the branch; do not skip it and do not create a stub page here.

- [ ] **Step 4: Run the test, confirm it passes.** Mutate the link away and confirm the link assertion FAILS. Report the output. Revert.

- [ ] **Step 5: `pnpm lint && pnpm typecheck && pnpm test`, then commit**

```bash
git add -A && git commit -m "feat(member): explain a restricted membership on the club list"
```

---

### Task 4: Club landing page — signed-in aware, no dead ends

**Files:**
- Modify: `app/s/[slug]/page.tsx`, `app/s/[slug]/(member)/book/book-calendar.tsx`
- Create: `app/s/[slug]/page.test.tsx`
- Modify: `messages/tr.json`, `messages/en.json` (add `club.ctaMyBookings`)

- [ ] **Step 1: Write the failing page test**, asserting the spec's §5 table. The load-bearing case: **a restricted viewer gets links to both `/bookings` and `/book`**, plus a sign-out control. Also assert an approved member gets a `/bookings` link, and that a signed-out visitor still gets the join CTA and no sign-out.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Make the page signed-in aware.**

`getCurrentUser()` is already called at `app/s/[slug]/page.tsx:55` and its result is unused by the chrome. Pass `signOutUrl` to `AppControls` whenever a user is present, using the same `apexUrl('/sign-in?signedout=1', origin)` value the other layouts use.

Delete the local `computeIsBanned` (`:27`) in favour of `resolveRestriction`, and replace the restricted branch (`:97-101`) with `<RestrictionNotice variant="inline" …/>` plus **two links: `/book` and `/bookings`**. Both already admit a restricted member through `requireMemberView` — that is why this works and why the only thing ever missing was the link. Add a `/bookings` link for approved members too.

- [ ] **Step 4: Swap the booking calendar's banner.** Replace the hand-rolled block at `book-calendar.tsx:360-370` with `<RestrictionNotice variant="banner" …/>` so the wording matches the other two surfaces and the reason appears there as well. The page already has the membership; thread the reason in from `app/s/[slug]/(member)/book/page.tsx` via `getRestrictionReasons` with a single-element array.

- [ ] **Step 5: Delete the retired keys.** `home.statusSuspended`, `club.statusBanned`, `club.noteBanned`, and the `booking.bannedTitle` / `bannedUntil` / `bannedPermanent` trio if the banner swap leaves them unused. **Grep for each key before deleting it** — `home.statusSuspended` in particular shares its name with an unrelated `admin.statusSuspended` used at `app/admin/page.tsx:54` and `app/admin/clubs/[id]/page.tsx:63`, which must NOT be touched. The parity test cannot see a key deleted from both catalogues, so this is checked by grep, not by the suite.

- [ ] **Step 6: Run everything, confirm green.** Mutate the `/bookings` link away and confirm the restricted-viewer test FAILS. Report the output. Revert.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(member): make the club landing page signed-in aware"
```

---

### Task 5: The account page

**Files:**
- Create: `app/account/page.tsx`, `app/account/account-form.tsx`, `app/account/actions.ts`, `app/account/actions.test.ts`
- Create: `src/lib/user-profile.ts`, `src/lib/user-profile.integration.test.ts`
- Modify: `src/lib/schemas.ts`, `src/lib/rate-limit-config.ts`, `src/lib/audit.ts`, `messages/tr.json`, `messages/en.json`

- [ ] **Step 1: Add the schema, the rate rule and the audit action.**
  - `src/lib/schemas.ts`: an `accountProfileSchema` **reusing the existing sign-up field rules** rather than restating them, so the two cannot drift. Fields: `firstName`, `lastName`, `phone`, `birthday` (nullable), `gender` (nullable), `defaultPaymentType`.
  - `src/lib/rate-limit-config.ts`: `accountUpdatePerAccount`, 30/hour, **with a sizing comment** in the voice of its neighbours — that file's header defines a sizing rule and every other entry is annotated.
  - `src/lib/audit.ts`: add `'user.profile_update'` to the closed `AuditAction` union, next to the existing `user.admin_grant` / `user.admin_revoke`.

- [ ] **Step 2: Write the failing integration test** for `updateUserProfile(db, userId, values)` (`src/lib/user-profile.integration.test.ts`). `randomUUID()` fixture ids. Assert by **reading the row back**, not by asserting a mock was called:
  - valid input persists every field;
  - **only the addressed user's row changes** — seed a bystander and assert it is untouched (a missing `WHERE` passes every other test in the file);
  - a null `birthday`/`gender` is stored as null rather than the string `"null"`.

- [ ] **Step 3: Run it, confirm it fails. Step 4: implement `src/lib/user-profile.ts`** (takes `DbOrTx`, not a `'use server'` module). **Step 5: run it, confirm it passes.**

- [ ] **Step 6: Write the failing action test** (`app/account/actions.test.ts`, node env). Assert: unauthenticated is refused; invalid input returns an error state and writes nothing; a rate-limited call writes nothing; a valid call delegates with the **session's** user id, never one from the form; the audit row is written.

- [ ] **Step 7: Implement the action and the form.** Follow `app/s/[slug]/manage/policies/actions.ts` for the `useActionState` shape and `PendingButton` for the submit control — do not hand-roll a `disabled={pending}` button. Read the whole policies form before writing this one and match its structure.

- [ ] **Step 8: Implement the page.** `requireUser('/account')`. Email renders **read-only** with a line saying it cannot be changed here, plus a link to the existing password-reset flow. Language and theme are already in the chrome and must **not** be duplicated here.

  `defaultPaymentType` needs its own explanatory line: it is a per-user default whose meaning is per-club — a club with `multisportEnabled = false` accepts only `regular`, so the preference silently does not apply there. Say that in the copy rather than implying the setting is universal.

- [ ] **Step 9: Run everything.** Mutate the action to take the user id from the form instead of the session, and confirm a test FAILS. Report the output. Revert.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(account): let a member edit their own profile"
```

---

### Task 6: Wire the account link into the chrome

**Files:**
- Modify: `src/components/app-controls.tsx`, `src/components/app-controls.test.tsx`, `src/components/member-header.tsx`, `app/s/[slug]/manage/layout.tsx`, `app/s/[slug]/page.tsx`

- [ ] **Step 1: Add an optional `accountUrl` to `AppControls`.**

**Read `src/components/app-controls.tsx`'s doc comment in full before touching it.** Its root `className` is conditional on whether a leading slot exists (`min-w-0` when it does, `shrink-0` when it does not), and that conditional is load-bearing: it was arrived at by rendering the real layout in a browser at 320/375/390px after two confidently-reasoned attempts were both wrong, and it is covered by a mutation-killed test. When `accountUrl` renders a link into the leading slot, the slot-present branch must apply — verify the resulting class for both the `accountUrl` and `children` paths rather than assuming, and give the link the `min-w-0 max-w-40 truncate` treatment the manage layout's link already uses.

- [ ] **Step 2: Extend `app-controls.test.tsx`** — `accountUrl` renders a link; absent renders none; the root class is correct in both cases. Mutate the class conditional and confirm a kill.

- [ ] **Step 3: Retarget and add the links.** The manage layout's existing account link points at the apex root; point it at `/account`. Add `accountUrl` on the member header and the club landing page. The root page's `signedInAs` link (Task 3) now resolves.

- [ ] **Step 4: Verify no surface regressed at 320px.** `member-header.tsx` truncates the club name and depends on the cluster not shrinking; `manage/layout.tsx` depends on the opposite. Reason from the computed widths and state your reasoning in the report — or render it if you can.

- [ ] **Step 5: Run everything, then commit**

```bash
git add -A && git commit -m "feat(account): link the account page from the page chrome"
```

---

### Task 7: Put the chrome in the same place everywhere

**Files:**
- Create: `src/components/app-header.tsx`, `src/components/app-header.test.tsx`
- Modify: `app/page.tsx`, `app/admin/layout.tsx`, `app/s/[slug]/manage/layout.tsx`, `src/components/member-header.tsx`, `app/s/[slug]/page.tsx`

**The problem, reported by the product owner:** *"When I press the manage club button, the UI layout changes significantly. I at least expect the theme button and language switch to remain in the same place."*

They do not, and the cause is that every section sets its own page width and hangs the chrome off it: root `max-w-md` (448px), club landing `max-w-md`, member `max-w-2xl` (672px), manage `max-w-3xl` (768px), admin `max-w-4xl` (896px). The controls are top-right of a different box in each, so they jump horizontally on every navigation. The manage header additionally sets `flex-wrap`, so on a narrow screen the whole cluster can drop onto its own line while other sections keep it inline.

- [ ] **Step 1: Write the failing test** for an `AppHeader` that renders a full-bleed bar with a **single** inner container width, a leading slot for the section's title or brand, and `AppControls` trailing. Assert the inner container's width class is the same value regardless of the section, and that the controls are the last child.

- [ ] **Step 2: Implement `AppHeader`.** Full-bleed outer element; inner `mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4`. One width, everywhere. Section content below keeps its own narrower container — the point is that the *controls* stop moving, not that every page becomes equally wide.

  Do **not** set `flex-wrap` on the header row. Wrapping is what lets the cluster jump to a second line on one section and not another; `AppControls` already handles narrow viewports through the shrink split documented in `src/components/app-controls.tsx`, and the title beside it should truncate rather than push.

- [ ] **Step 3: Adopt it** in all five surfaces above, moving each section's existing title/brand into the leading slot and deleting the hand-rolled header rows. Keep each page's content container exactly as it is.

- [ ] **Step 4: Check 320px on every adopted surface** and report how you checked. The manage header's leading slot is the longest (`Kulüp yönetimi` plus, on that layout, an account link) — it must truncate, not overflow. If a browser is available, render it; if not, compute the widths and show the arithmetic.

- [ ] **Step 5: Run everything, then commit**

```bash
git add -A && git commit -m "fix(ui): keep the page chrome in one place across sections"
```

## Verification checklist (whole branch)

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` all green.
- [ ] `drizzle/` untouched — this plan adds no migrations.
- [ ] `git diff main -- src/components/ui/` is empty.
- [ ] No `computeIsBanned` remains anywhere (`grep -rn computeIsBanned app src`).
- [ ] `home.statusSuspended`, `club.statusBanned`, `club.noteBanned` are gone from **both** catalogues and have no consumers; `admin.statusSuspended` is untouched.
- [ ] A restricted member can reach `/book` and `/bookings` from both the root page and the club landing page.
- [ ] Every new message key exists in both catalogues.
