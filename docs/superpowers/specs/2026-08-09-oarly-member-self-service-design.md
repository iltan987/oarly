# Oarly — Member Self-Service and Restriction Transparency — Design

**Date:** 2026-08-09
**Status:** Approved for implementation

## 1. Problem

Reported by the product owner, from the position of an ordinary member with a suspended
membership:

> *"In the root page where I see my list of joined clubs, I see Suspended and I can't do
> anything. What I understand as a regular person is 'ooh they banned me'. There is
> literally no explanation at all."*

> *"In `demo.ica2.xyz` it's almost empty. The only buttons I see are language switch and
> theme switch. I can't see any profile option. I can't see any way to log out. I can't
> see my previous bookings. I don't see any reason why I am suspended, how long it will
> take."*

Both describe one condition from two angles: **the member is told nothing and can go
nowhere.** Three independent defects produce it, and almost every fix is already sitting
in data the page has fetched.

### 1.1 The restriction is never explained, anywhere

`app/page.tsx:68` selects `memberships.bannedUntil`, and `app/page.tsx:102` renders
`{row.isBanned ? null : …}` — the explanation slot is **explicitly blanked for exactly
this case**. `app/page.tsx:111` replaces the CTA with the pill, so there is no link
either.

The reason is never rendered on any surface. `penalties.reason` is `'no_show'` and
`penalties.sessionId` names the missed session; neither reaches a member-facing page. The
only place in the product where cause meets effect is the one-shot `notifyNoShowPenalty`
email.

This is not an oversight of intent. `requireMemberView` exists specifically for it, and
its doc comment in `src/lib/membership.ts` states the principle outright:

> *A banned member must still be able to see why.*

The seam was built. The reason was never put through it. `/book` shows only *when* the
restriction lifts, never *why*.

### 1.2 A timeout and an expulsion are rendered identically

A two-day automatic cooling-off from one missed session and a permanent expulsion both
render as a red pill reading **"Askıda"** (*Suspended*). The domain distinguishes them
exactly — `penalties.permanent`, `resolveBan` — and the UI collapses it. "Suspended" is
the vocabulary of a judgement passed on a person; applying it to a 48-hour automatic
timeout is not just unclear, it is untrue.

### 1.3 The club landing page does not know you are signed in

`app/s/[slug]/page.tsx:55` calls `getCurrentUser()`, then line 63 renders
`<AppControls />` — with no `signOutUrl`, though the user object is in scope one line
above. There is no sign-out, no account link, and no link to `/bookings`.

For an approved member this is survivable: a "Go to booking" button leads to `/book`,
which has full chrome. **For a restricted member it is a hard dead end** — the CTA is
replaced by a pill, so there is nothing to click at all. They are the one class of user
who cannot leave that page.

The bitter part: `/book` and `/bookings` both guard with `requireMemberView`, which
already admits a restricted member. Both pages work. Nothing links to them.

### 1.4 There is no account page in the product

`grep` for any user-mutation path — `updateUser`, `authClient.updateUser`, any action
writing to the `user` table — returns **nothing**. The only `profile` route is
`app/s/[slug]/manage/profile`, which is the owner's *club* profile.

So `firstName`, `lastName`, `phone`, `birthday`, `gender` and `defaultPaymentType` are
written once at sign-up and are permanently uneditable. A member who changes their phone
number cannot update it. `defaultPaymentType` decides how every one of their bookings is
paid (`src/lib/member-calendar.ts:118`), and they can never change it.

## 2. Scope

Three parts, one branch. Part C is a genuine feature; it is included because "I can't see
any profile option" is a request, and because uneditable contact details are a defect on
their own.

- **A. Explain the restriction** — §3, §4. Root page, club landing, booking calendar.
- **B. No dead ends** — §5. The club landing page becomes signed-in aware.
- **C. An account page** — §6. Apex `/account`, profile fields only.

**Deliberately excluded, and each for a stated reason:**

- **Changing email** — requires re-verification and touches the Better Auth credential
  flow. Email renders read-only with a note.
- **Changing password** — a Better Auth flow of its own; the existing reset-by-email path
  already works and is linked instead.
- **Deleting the account** — KVKK-gated. This repo already defers KVKK handling to a
  lawyer-reviewed plan; inventing a deletion flow ahead of that would be worse than not
  having one.
- **Bookings cancelled by the penalty cascade** — `markNoShow` cancels the member's future
  seats inside the ban window, and `bookings-list.tsx` renders them as a plain
  "Cancelled", indistinguishable from a self-cancellation. Fixing it needs a
  `bookings.cancelled_reason` column written at every cancellation site, plus a migration.
  It improves the owner's roster as much as the member's list and deserves its own cycle.
  **This is the single most valuable follow-up in this area.**
- Appeals or in-app messaging (no messaging exists), penalty history, and any change to
  how penalties are calculated. This cycle changes what the member is *told* and what they
  can *reach* — not what happens to them.

## 3. The reframe: paused is not suspended

One boolean, `isBanned`, drives every surface today. It becomes three states, because the
product genuinely has three and the member's next action differs in each:

| State | Condition | Tone | What it tells the member |
|---|---|---|---|
| **none** | no live penalty | — | — |
| **paused** | `bannedUntil` in the future, not permanent | warn (amber) | It ends by itself, on this date, at this time. |
| **suspended** | `permanent`, i.e. `membership.status === 'banned'` | bad (red) | It does not end by itself. Talk to the club. |

Reserving "suspended" for the case that actually is a judgement, and calling the
self-expiring case **paused**, does most of the work of this design by itself. *"Booking
paused until Thursday 07:00"* and *"Suspended"* provoke completely different reactions,
and only one of them is honest about a 48-hour timeout.

**A lapsed penalty is `none`.** `penaltyEndsAt` anchors to the missed session rather than
to when the owner did the paperwork, so marking an old absence can produce an
already-expired ban (`alreadyLapsed` in `MarkNoShowResult` exists for this). Such a member
is not restricted and must be shown nothing at all.

## 4. Explaining it

Three facts, in this order — the order matters, because the first one defuses the alarm:

1. **When it lifts** (paused only) — date **and time**, in the club's timezone. The
   `07:00` is load-bearing: "12 August" reads as "some time that day".
2. **Why** — *"Because you were marked absent for the 07:00 session on 5 August."* This is
   what makes it a consequence rather than a verdict, and it is the only way a member can
   notice the owner made a mistake.
3. **What to do** (suspended only) — contact the club. `clubs.phone` already renders
   publicly on the club landing page, so it is shown where it exists; where it does not,
   the copy still names the club as the party to talk to.

Deliberately not shown: penalty count, the club's policy setting, or how close the member
is to a worse penalty. This explains a restriction that exists; it is not a disciplinary
dashboard.

### 4.1 `resolveRestriction` (`src/lib/restriction.ts`)

Pure, and the single definition of the three states:

```ts
export type Restriction =
  | { kind: 'none' }
  | { kind: 'paused'; endsAt: Date }
  | { kind: 'suspended' };

export function resolveRestriction(
  input: { status: string; bannedUntil: Date | null; now: Date },
): Restriction;
```

It replaces `computeIsBanned`, which exists today as **two byte-identical copies**
(`app/page.tsx:25`, `app/s/[slug]/page.tsx:27`). `now` is injected, not read from the
clock, so the boundary is testable.

It takes `status`, not `permanent`: `recomputeBan` persists a permanent penalty as
`memberships.status = 'banned'`, so the membership row alone carries the three-way split.
`penalties.permanent` remains the domain's source of truth; this is the read model.

The boundary must match `checkEligibility` (`src/lib/eligibility.ts:27`), which uses
`bannedUntil > now`. At exactly `bannedUntil === now` the member may book, so the UI must
say `none`. Two different answers to "am I restricted?" is worse than either answer.

### 4.2 `getRestrictionReasons` (`src/lib/restriction.ts`)

```ts
export async function getRestrictionReasons(
  db: DbOrTx,
  membershipIds: string[],
): Promise<Map<string, { reason: string; sessionStartAt: Date | null }>>;
```

**Batched by design.** The root page lists every club a member belongs to; a
per-membership call would be an N+1 on the product's most-loaded page. One query, one map.

- An empty input array returns an empty map **without issuing a query** — `inArray(col, [])`
  is a syntax error in some drivers and a silent full scan in others.
- The live-penalty predicate is `permanent = true OR banned_until > now`, **not**
  `banned_until > now` alone: a permanent penalty has `banned_until IS NULL` and would
  vanish from the result.
- Newest row per membership wins. A membership with no live penalty is **absent from the
  map**, not present with nulls.
- `reason` is returned raw (`'no_show'` today). The UI maps known values to copy and falls
  back to a generic line, so a future reason can never render as blank space or a raw enum.

### 4.3 `RestrictionNotice` (`src/components/restriction-notice.tsx`)

One component, three surfaces, so the wording cannot drift between where a member first
sees the problem and where they go to understand it.

```tsx
<RestrictionNotice
  restriction={Restriction}      // never 'none' — the caller decides not to render
  reason={{ reason: string; sessionStartAt: Date | null } | null}
  timezone={string}              // club timezone; dates are club-local, never viewer-local
  clubPhone={string | null}
  variant="inline" | "banner"
/>
```

`timezone` is required, not optional. A 07:00 Istanbul session must not render as 04:00 to
a member whose device is in London; every other date in this product is already
club-local.

## 5. No dead ends

`app/s/[slug]/page.tsx` becomes signed-in aware. `getCurrentUser()` is already called
there; its result is simply unused.

| Viewer | Today | Change |
|---|---|---|
| signed out | join CTA | unchanged |
| pending / rejected | pill + note | + sign-out, + account link |
| approved member | "Go to booking" | + "My bookings", + sign-out, + account link |
| owner | Manage / Booking | + sign-out, + account link |
| **restricted** | **pill only — dead end** | RestrictionNotice, **+ "My bookings", + "Booking calendar"**, + sign-out, + account link |

The restricted row is the point of this section. Both destinations already admit them via
`requireMemberView`; the only thing missing has always been the link.

`AppControls` gains an optional `accountUrl`. It renders the account link in the same
leading slot the manage layout already uses, so the chrome stays identical everywhere. The
manage layout's existing account link — which today points at the apex root — retargets to
`/account`, and the root page's `signedInAs` line becomes a link to it.

## 6. The account page (`app/account/page.tsx`, apex)

Editable: `firstName`, `lastName`, `phone`, `birthday`, `gender`, `defaultPaymentType`.
Read-only: `email`, with a line saying it cannot be changed here. A link to the existing
password-reset flow. Language and theme are already in the chrome and are **not**
duplicated here.

`defaultPaymentType` carries a wrinkle that must be stated in the copy: it is a
**per-user** default, but its meaning is **per-club** — a club with `multisportEnabled =
false` accepts only `regular`, so the preference silently does not apply there. The field
gets an explanatory line rather than pretending the setting is universal.

Validation reuses the sign-up schema's field rules (`src/lib/schemas.ts`) rather than
restating them, so the two cannot drift. The action is rate-limited per account, following
the existing `RATE_LIMITS` pattern, and audit-logged with the existing `user.*` action
vocabulary if a suitable action exists — otherwise a new one is added to the closed
`AuditAction` union.

## 7. Copy

Both catalogues. Turkish is the primary voice; the English must read as English, not as a
translation of it.

| Key | tr | en |
|---|---|---|
| `restriction.pausedPill` | `Duraklatıldı` | `Paused` |
| `restriction.suspendedPill` | `Askıda` | `Suspended` |
| `restriction.pausedUntil` | `{date} tarihine kadar rezervasyon yapamazsın.` | `You can't book until {date}.` |
| `restriction.suspended` | `Bu kulüpte rezervasyon erişimin askıya alındı.` | `Your booking access at this club is suspended.` |
| `restriction.reasonNoShow` | `{date} tarihli seansa katılmadığın için.` | `Because you were marked absent for the {date} session.` |
| `restriction.reasonGeneric` | `Kulüp tarafından uygulandı.` | `Applied by the club.` |
| `restriction.contactClub` | `Kulüple iletişime geç.` | `Get in touch with the club.` |

Plus an `account.*` group for §6 and `club.ctaMyBookings`. `home.statusSuspended`,
`club.statusBanned` and `club.noteBanned` are **deleted, not orphaned** — their only
consumers are the branches being replaced, and this repo already carries 8 dead keys from
an earlier cycle. The parity test cannot see a key removed from both catalogues, so this
has to be done by hand and checked by grep.

## 8. Testing

- `resolveRestriction` (unit) — three states; a lapsed `bannedUntil` is `none`, not
  `paused`; the exact boundary `bannedUntil === now` is `none`, matching
  `checkEligibility`; `status: 'banned'` with a null `bannedUntil` is `suspended`; a
  pending/rejected membership is never `paused`.
- `getRestrictionReasons` (integration, real DB) — one query for many memberships; an
  empty array issues **no** query; a permanent penalty (`banned_until IS NULL`) is
  returned and an expired one is not; newest wins; a membership with no penalty is absent
  from the map. Assertions read rows back.
- `RestrictionNotice` (jsdom) — the date renders in the **club's** timezone, asserted with
  a club timezone deliberately different from the runner's `TZ`; an unknown reason falls
  back to the generic line rather than rendering blank; suspended shows the phone when
  present and still names the club when absent.
- Club landing (jsdom) — **a restricted viewer gets links to `/bookings` and `/book`**, and
  every signed-in viewer gets sign-out. This is the regression test for §5.
- Account page — the action rejects invalid input, persists valid input (state assertion,
  read the row back), and cannot write another user's row.

Every new test is mutation-checked: change the code it covers, confirm a real `N failed`
kill, revert. A run reporting `0 tests` is a broken suite, not a pass. `pnpm typecheck` is
part of every task's gate, not optional.
