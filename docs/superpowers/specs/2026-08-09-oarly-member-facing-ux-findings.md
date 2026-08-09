# Oarly — Member- and Owner-Facing UX Findings

**Date:** 2026-08-09
**Status:** Findings and recommendations. **Input to a separate frontend work stream — not an implementation plan.**

This document exists so the frontend work does not have to rediscover any of this. Every
claim below was verified against the code on `main` at `5a574ca`, and every file
reference is real. No implementation was carried out; a plan drafted against these
findings was deliberately withdrawn when the frontend work was separated out.

Reported by the product owner while reviewing the product as an ordinary member and as a
club owner. Their words are quoted where they are more precise than a summary would be.

---

## 1. A restricted member is told nothing and can go nowhere

> *"In the root page where I see my list of joined clubs, I see Suspended and I can't do
> anything. What I understand as a regular person is 'ooh they banned me'. There is
> literally no explanation at all."*

> *"I don't see any reason why I am suspended, how long it will take."*

**Severity: high.** This is the product silently accusing a paying member of something.

### 1.1 The explanation slot is deliberately blanked

`app/page.tsx:68` selects `memberships.bannedUntil`. `app/page.tsx:102` then renders
`{row.isBanned ? null : …}` — the note slot is explicitly emptied for exactly this case.
`app/page.tsx:111` replaces the call-to-action with the pill, so the row also loses its
link. The answer is fetched and discarded, and the exit is removed.

### 1.2 The reason is never rendered on any surface

`penalties.reason` is `'no_show'` and `penalties.sessionId` names the missed session.
Neither reaches any member-facing page. The only place in the product where cause meets
effect is the one-shot `notifyNoShowPenalty` email; a member who never opens it has
nothing.

This is not an oversight of intent. `requireMemberView` (`src/lib/membership.ts`) exists
specifically for this case, and its doc comment states the principle outright:

> *A banned member must still be able to see why.*

The seam was built. The reason was never put through it. `/book` shows only *when* the
restriction lifts, never *why* it exists.

### 1.3 A timeout and an expulsion are rendered identically

A two-day automatic cooling-off from one missed session and a permanent expulsion both
render as a red pill reading **"Askıda"** (*Suspended*). The domain distinguishes them
exactly — `penalties.permanent`, `resolveBan` in `src/lib/penalty.ts` — and the UI
collapses the distinction.

**Recommendation — the single highest-value change in this document.** Replace the
`isBanned` boolean with three states:

| State | Condition | Tone | What it tells the member |
|---|---|---|---|
| **none** | no live penalty | — | — |
| **paused** | `bannedUntil` in the future, not permanent | warn (amber) | It ends by itself, on this date, at this time. |
| **suspended** | `permanent`, i.e. `memberships.status === 'banned'` | bad (red) | It does not end by itself. Talk to the club. |

"Suspended" is the vocabulary of a judgement passed on a person. Reserving it for the case
that actually is one, and calling the self-expiring case **paused**, does most of the work
by itself: *"Booking paused until Thursday 07:00"* and *"Suspended"* provoke completely
different reactions, and only one of them is honest about a 48-hour timeout.

**Watch three things when building this:**

- A **lapsed** penalty must render as nothing at all. `penaltyEndsAt` anchors to the missed
  session rather than to when the owner did the paperwork, so marking an old absence can
  produce an already-expired ban (`alreadyLapsed` in `MarkNoShowResult` exists for this).
- The boundary must match `checkEligibility` (`src/lib/eligibility.ts:27`), which refuses
  only while `bannedUntil > now`. At exactly `bannedUntil === now` the member may book, so
  the UI must agree. Two different answers to "am I restricted?" is worse than either.
- `computeIsBanned` currently exists as **two byte-identical copies**, at `app/page.tsx:25`
  and `app/s/[slug]/page.tsx:27`. Whatever replaces it should be one function.

### 1.4 What the member needs to be told, in this order

1. **When it lifts** (paused only) — date **and time**, in the club's timezone. The `07:00`
   is load-bearing; "12 August" reads as "some time that day".
2. **Why** — *"Because you were marked absent for the 07:00 session on 5 August."* This is
   what makes it a consequence rather than a verdict, and it is the only way a member can
   notice the owner made a mistake.
3. **What to do** (suspended only) — contact the club. `clubs.phone` already renders
   publicly on the club landing page.

Not: penalty counts, the club's policy setting, or how close they are to a worse penalty.
Explain the restriction that exists; do not build a disciplinary dashboard.

### 1.5 Data the frontend work will have to add

The `penalties` table is read by **no member-facing code today**. Reading it needs:

- A batched lookup keyed by membership id — the root page lists every club a member
  belongs to, so a per-row call is an N+1 on the product's most-loaded page.
- Predicate `permanent = true OR banned_until > now`. **Not** `banned_until > now` alone: a
  permanent penalty has `banned_until IS NULL` and would vanish, leaving the most serious
  restriction as the only one with no explanation.
- LEFT joins to `sessions`/`slots`. `penalties.sessionId` is nullable (`on delete set
  null`, and its column comment anticipates a manually-issued penalty with no session); an
  inner join drops exactly those rows.
- An empty id list must short-circuit without querying — `inArray(col, [])` is a syntax
  error in some drivers and a silent full scan in others.

No migration is required. Everything needed exists in `penalties` and `memberships`.

---

## 2. The club landing page is a dead end

> *"In `demo.ica2.xyz` it's almost empty. The only buttons I see are language switch and
> theme switch. I can't see any profile option. I can't see any way to log out. I can't see
> my previous bookings."*

**Severity: high for restricted members, medium for everyone else.**

`app/s/[slug]/page.tsx:55` calls `getCurrentUser()`. Line 63 then renders `<AppControls />`
with no `signOutUrl` — the user object is in scope one line above and simply unused. There
is no sign-out, no account link, and no link to `/bookings`.

For an approved member this is survivable: a "Go to booking" button leads to `/book`, which
has full chrome. **For a restricted member it is a hard dead end** — the CTA is replaced by
a pill, so there is nothing to click at all. They are the one class of user who cannot
leave that page.

The bitter part: `/book` and `/bookings` both guard with `requireMemberView`, which
**already admits a restricted member**. Both pages work today. Nothing links to them.

Recommended target state:

| Viewer | Today | Should be |
|---|---|---|
| signed out | join CTA | unchanged |
| pending / rejected | pill + note | + sign-out, + account |
| approved member | "Go to booking" | + "My bookings", + sign-out, + account |
| owner | Manage / Booking | + sign-out, + account |
| **restricted** | **pill only — dead end** | explanation, **+ "My bookings", + "Booking calendar"**, + sign-out, + account |

---

## 3. There is no account page in the product

> *"I can't see any profile option."*

**Severity: medium-high.** Not a layout problem — the page does not exist.

`grep` for any user-mutation path (`updateUser`, `authClient.updateUser`, any action
writing the `user` table) returns **nothing**. The only `profile` route is
`app/s/[slug]/manage/profile`, which is the owner's *club* profile.

So `firstName`, `lastName`, `phone`, `birthday`, `gender` and `defaultPaymentType` are
written once at sign-up and are permanently uneditable. A member who changes their phone
number cannot update it. `defaultPaymentType` decides how every one of their bookings is
paid (`src/lib/member-calendar.ts:118`) and can never be changed.

Recommended scope for a first version — apex `/account`, profile fields only:

- **Editable:** the six columns above.
- **Read-only:** email, with a line saying it cannot be changed here, plus a link to the
  existing password-reset flow.
- **Not included, each for a reason:** changing email (needs re-verification, touches the
  Better Auth credential flow); changing password (its own Better Auth flow, and reset
  already works); deleting the account (**KVKK-gated** — this repo already defers KVKK
  handling to a lawyer-reviewed plan, and inventing a deletion flow ahead of that is worse
  than not having one).
- Language and theme are already in the page chrome and should **not** be duplicated here.
- Validation should reuse the sign-up field rules in `src/lib/schemas.ts` rather than
  restating them, so the two cannot drift.
- **A wrinkle worth stating in the copy:** `defaultPaymentType` is a per-user default whose
  meaning is per-club. A club with `multisportEnabled = false` accepts only `regular`, so
  the preference silently does not apply there.

---

## 4. The chrome moves between sections

> *"When I press the manage club button, the UI layout changes significantly. This is not
> so a big problem but at least I expect theme button, language switch to remain in the
> same place."*

**Severity: low-medium.** Cheap to fix, and it undermines the sense that these are one app.

Every section sets its own page width and hangs the chrome off it:

| Section | Container |
|---|---|
| root (`app/page.tsx`) | `max-w-md` (448px) |
| club landing | `max-w-md` (448px) |
| auth | `max-w-sm` (384px) |
| member | `max-w-2xl` (672px) |
| manage | `max-w-3xl` (768px) |
| admin | `max-w-4xl` (896px) |

The controls are top-right of a different box in each, so they jump horizontally on every
navigation. The manage header additionally sets `flex-wrap`, so on a narrow screen the
cluster can drop onto its own line while other sections keep it inline.

Recommendation: a shared header with **one** inner container width used by every signed-in
section, full-bleed outside it. Section content below keeps its own narrower container —
the goal is that the *controls* stop moving, not that every page becomes equally wide. Do
not set `flex-wrap` on that header row; let the title truncate instead.

**Before touching `src/components/app-controls.tsx`, read its doc comment in full.** Its
root class is conditional on whether a leading slot is present (`min-w-0` vs `shrink-0`),
and that conditional is load-bearing: it was arrived at by rendering the real layout in a
browser at 320/375/390px after two confidently-reasoned attempts were both wrong, and it is
covered by a mutation-killed test. The mechanism is unintuitive — `truncate` implies
`white-space: nowrap`, so a truncating child's min-content equals its max-content, and
`max-width` clamps that *contribution*; `min-width: 0` on the child lowers its own floor but
never what it contributes to the parent's floor.

---

## 5. The manage nav is eight flat tabs

> *"Tabbed layout not so bad but there are so many tab items now. Looks a bit ugly. In my
> phone I see 4 rows of buttons."*

**Severity: medium.**

`app/s/[slug]/manage/_nav.tsx` renders eight items — Overview, Profile, Skill levels,
Boats, Schedule, Policies, Members, Bookings — in a `flex-wrap`, with long Turkish labels,
inside a `max-w-3xl` container. Four rows on a phone is the arithmetic working as written.
The manage layout also stacks a title row and a two-link row above the nav, so the page
opens with four rows of chrome before any content.

**Recommendation: split by frequency, not by topic.**

**Overview · Bookings · Members · Settings**

Bookings and Members are touched daily. Profile, Skill levels, Boats, Schedule and Policies
are set up once and then almost never revisited — they move behind a *Settings* index page
listing them as rows. Four tabs fit one line on a phone, and **no URLs change**, so nothing
breaks and no links rot.

Rejected alternatives, with reasons:

- **Grouping by topic** (Setup / Schedule / People) adds a navigation level in front of
  items owners use constantly.
- **Horizontal scrolling tabs** (`flex-nowrap overflow-x-auto`) is a one-line change, but it
  hides five destinations behind a swipe with no affordance. Deliberately not applied as a
  stop-gap, because it would be thrown away by the real fix.

---

## 6. Adjacent finding, not reported: cancelled bookings are unexplained

Not raised by the product owner, found while investigating §1, and likely to be the *next*
thing they hit.

When a ban bites, `markNoShow` cancels the member's future seats that fall inside the ban
window. `app/s/[slug]/(member)/bookings/bookings-list.tsx` renders those as a plain
"Cancelled" — indistinguishable from one the member cancelled themselves. A member whose
Thursday seat vanished has no way to learn why from the UI.

Fixing it properly needs a `bookings.cancelled_reason` column (`member` / `owner` /
`penalty`) written at every cancellation site, plus a migration. It improves the owner's
roster as much as the member's list. **This is the one item here that is not purely
frontend**, and it is the most valuable follow-up in this area.

---

## Summary

| # | Finding | Severity | Purely frontend? |
|---|---|---|---|
| 1 | Restriction never explained; paused vs suspended conflated | high | needs a new `penalties` read model |
| 2 | Club landing page is a dead end for restricted members | high | yes |
| 3 | No account page exists | medium-high | needs an update action + validation |
| 4 | Chrome position moves between sections | low-medium | yes |
| 5 | Eight flat manage tabs, four rows on a phone | medium | yes |
| 6 | Penalty-cancelled bookings unexplained | medium | needs a migration |

None of §1–§5 requires a schema change. Only §6 does.
