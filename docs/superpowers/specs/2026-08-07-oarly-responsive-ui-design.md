# Responsive UI: pending feedback and optimistic updates

**Date:** 2026-08-07
**Status:** approved for implementation
**Supersedes:** nothing. Complements the per-club feature-toggle spec (separate cycle).

## 1. Problem

Two defects reported from real use, plus the class of defect they belong to.

### 1.1 Reported: "Save" on `/manage/policies` gives no feedback

`app/s/[slug]/manage/policies/policies-form.tsx:32` destructures only two of the three
slots `useActionState` returns:

```ts
const [state, formAction] = useActionState(savePoliciesAction.bind(null, slug), initial);
```

`pending` is dropped on the floor. The submit button at `:115` is bare —
`<Button type="submit" className="self-start">{labels.save}</Button>` — with no
`disabled`, no spinner, no label change. And there is **no success feedback of any kind**:
`state.status === 'ok'` is never read anywhere in the component, `sonner` is never
imported into the file, and no `manage.policies.saved` key exists in either
`messages/en.json` or `messages/tr.json`. The only feedback in the whole form is one
inline error line (`:114`) that always reads "invalid lead" regardless of what actually
failed, because `savePoliciesAction` collapses a Zod failure and a `invalid_lead`
domain error into the same `{ status: 'error' }`.

So: the button does nothing observable on success, and lies about the cause on failure.

**A naive fix does not work here.** `app/s/[slug]/manage/policies/page.tsx:24` renders
`<PoliciesForm key={club.updatedAt.getTime()} …>`, and `clubs.updatedAt` is
`$onUpdate`-stamped on every write (`src/db/schema/clubs.ts:37`). A successful save
therefore bumps the key and **fully unmounts and remounts `PoliciesForm`**, resetting
`useActionState` to `{ status: 'idle' }`. A `useEffect` toast placed inside
`PoliciesForm` is destroyed before it can fire. The sibling
`app/s/[slug]/manage/profile/profile-form.tsx` already solves exactly this: the stable
outer component owns `useActionState` and the toast effect, and the `key` is pushed down
onto the inner `<form>` (`:57`). That is the pattern to copy.

### 1.2 Reported: removing a booking deleted the wrong person's seat

The incident, in the reporter's words: they pressed Remove once, believed the press had
not registered, pressed again — and the second press removed the booking of the member
who had just been promoted into the freed seat.

This one is worth stating precisely, because the obvious fix is the wrong fix.

The Remove button is **not** missing a pending state. `bookings-roster.tsx:113` already
has `disabled={rmPending}`, and Base UI's `Button` really does emit the native
`disabled` attribute — confirmed in
`node_modules/@base-ui/react/utils/useFocusableWhenDisabled.mjs`, where
`additionalProps.disabled = disabled` is set whenever `isNativeButton` is true and
`focusableWhenDisabled` is false, which are both the defaults. So `buttonVariants`'
`disabled:opacity-50 disabled:pointer-events-none` genuinely applies, and a click during
the pending window is genuinely swallowed.

Two things nonetheless combined to produce the data loss:

**(a) The pending affordance is invisible in practice.** The control is
`variant="ghost" size="sm"` — small, muted, transparent-background text. Dropping it to
50% opacity for well under a second, with no spinner and no label change, is not a
signal a human reliably perceives. The reporter's "it feels like button did nothing" is
an accurate description of the rendered UI.

**(b) The button re-enables at the exact moment the row identity changes.** This is the
mechanism, and it is why "add optimistic UI" is not on its own a fix. Removing a seated
member runs `applySeating`, which promotes a waitlisted member into the freed seat.
`ownerRemoveBookingAction` then calls `revalidatePath`. React holds the
`useActionState` transition pending until the resulting RSC payload is applied — so
`rmPending` flips to `false` **on the same commit** that re-renders the list with the
removed row gone and everything below it shifted up by one. There is no safe gap: the
instant the button becomes clickable again is the instant a different person's Remove
button occupies the pixels the cursor is resting on.

A second click a few hundred milliseconds later therefore lands on the promoted member's
row and removes a booking the operator never intended to touch. The action layer is not
at fault — `ownerRemoveBooking` takes `pg_advisory_xact_lock` and rejects non-active
bookings, so this was not a race or a double-submit of the same ID. It was a correct
removal of the wrong, correctly-identified booking.

**Consequence for the design:** optimistic *removal* would make this worse, not better.
Removing the row from the list on click moves the reflow from t≈700ms to t≈0 — the
cursor-displacement hazard fires sooner. The correct optimistic treatment for a
destructive row action is to **fade the row in place and keep it mounted** until the
server confirms, so the layout does not move while the operator's hand is still there.

### 1.3 The class: 28 of ~38 mutation call sites are under-specified

A full inventory of every user-facing mutation found:

- **11 call sites with no pending feedback at all.** Beyond policies: the schedule
  window form, schedule window delete, the three date-override buttons
  (Close / Force open / Reset), the per-member skill-level select, the join request,
  sign-out, and logo removal.
- **17 call sites with pending feedback but no optimistic update**, all of them
  collection mutations where the UI sits still for a full round trip.
- **`useOptimistic` is used zero times in the codebase.** `useFormStatus` likewise.
- **No shared submit-button component exists.** All ~38 sites hand-roll
  `disabled={pending}` off their own `useActionState` tuple, and `Spinner` — the only
  pending affordance in the repo — appears at just 2 of them.

There is also a **shared-pending bug** at four sites: `bookings-roster.tsx`
(`rmPending`, `undoPending`), `skill-levels-editor.tsx` (`delPending`) and
`profile-form.tsx` (`rmPending`) hoist a single `useActionState` into the parent and
reuse its one `pending` flag for every row. Removing one member greys out Remove on
every row in every session card. The hoisting is deliberate and correct — the comment at
`bookings-roster.tsx:33-34` explains it exists so the toast survives the row unmounting
— but the pending flag should never have been hoisted with it.

## 2. Goals and non-goals

**Goals**

1. Every mutation gives an unmistakable signal within one frame of the click.
2. No destructive action can be triggered by a click aimed at a row that has since
   changed identity.
3. Optimistic updates wherever they do not themselves cause layout shift.
4. One shared primitive, so the 29th call site is correct by construction.

**Non-goals**

- Offline support, retry queues, or `useOffline`.
- Cache Components / `'use cache'` migration. `revalidatePath` stays as-is.
- Reworking the action-result union taxonomy beyond what §5.1 requires.
- Per-club feature toggles — a separate cycle.

## 3. Design principle: classify by layout impact, not by verb

The taxonomy that decides each call site's treatment is **"does the optimistic update
move anything the user's cursor might be resting on?"**

| Class | Optimistic treatment | Why |
|---|---|---|
| **Destructive row action** (remove booking, delete window, delete skill level, remove social, reject member) | **Fade in place.** Row stays mounted, dims, shows a spinner; it disappears only when server data arrives. | Removing the node reflows every row below it. That reflow is the §1.2 mechanism. |
| **Additive** (add member to session, add social, add skill level, add boat) | **Optimistic append**, rendered dimmed until confirmed. | Appending below existing rows shifts nothing above it. |
| **In-place value change** (skill-level select, boat active toggle, club status, no-show flip/undo, reorder arrows) | **Optimistic value swap.** | Height is unchanged, so nothing moves. |
| **Form submit** (policies, profile, window form, join, request club) | **Pending button** — disabled + spinner + label change — and a result toast. | No list to update; the button *is* the feedback surface. |

Reorder arrows are the highest-value optimistic candidate in the app (a frequent nudge
whose whole point is immediacy) and are layout-safe: swapping two equal-height rows moves
both, but the user's cursor is on an arrow that moves *with* its row.

## 4. Architecture

### 4.1 `PendingButton` — the shared primitive

New file `src/components/pending-button.tsx` (**not** `src/components/ui/`, which is
shadcn CLI-managed and must not be hand-authored).

```tsx
'use client';
import { useFormStatus } from 'react-dom';
```

It renders the existing `Button` with `type="submit"`, reading `pending` from
`useFormStatus()` rather than from a prop. Two consequences make this the right shape:

1. **`useFormStatus` is scoped to the nearest ancestor `<form>`.** Every row in this
   codebase already renders its own `<form action={rmAction}>` — see
   `bookings-roster.tsx:111` and `:131`. So dropping `PendingButton` into those forms
   **fixes the shared-pending bug for free**, with no state lifting and no change to the
   deliberately-hoisted `useActionState`. Row A's button goes pending; row B's does not.
2. It removes `pending` from every component's prop surface, which is what let the
   policies form silently drop it.

The component must:

- render `<Spinner />` alongside the label while pending (the label stays visible; it is
  not replaced, so the button does not change width mid-flight);
- set `disabled` while pending, inheriting `disabled:opacity-50
  disabled:pointer-events-none` from `buttonVariants`;
- set `data-pending` while pending, so any ancestor can react in pure CSS via Tailwind's
  `has-data-pending:` / `group-has-data-pending:` variants — the pattern Next.js
  documents for exactly this in the *Building interactive apps* guide, Step 7;
- accept and merge `disabled` from the caller (`disabled={pending || !selected}` is a
  real existing case at `bookings-roster.tsx:201`);
- forward all other `Button` props.

### 4.2 Fade-in-place for destructive rows

The row element gets `has-data-pending:opacity-40` plus a transition. No React state, no
callbacks, no lifting — the CSS `:has()` selector reads the `data-pending` the
`PendingButton` inside it already sets. This is the documented Next.js pattern and it
costs one class name per row.

Crucially the row is **not** removed optimistically. It vanishes when the revalidated
payload arrives, by which point the operator has had unmistakable feedback for the whole
round trip.

### 4.3 A confirmation step for owner-remove

This is the decisive guard for §1.2, and it corrects a live asymmetry:

- **"Mark absent"** — reversible (there is an `undoNoShowAction`), and it already has a
  confirmation dialog (`bookings-roster.tsx:148-172`).
- **"Remove"** — irreversible, destroys another member's booking, and cascades a
  waitlist promotion. It has **no confirmation at all**.

The more dangerous action is the unguarded one. Owner-remove gets a confirmation dialog
naming the member and stating that the seat will pass to the next person on the waitlist,
reusing the existing `Dialog` + `confirming` state pattern already in the file.

This, not optimistic UI, is what would have prevented the reported incident.

### 4.4 Optimistic lists

For the additive and in-place classes, `useOptimistic` is added at the component that
owns the list, per the Next.js guide. Two rules the implementation must hold:

- The optimistic reducer reads from the **optimistic** value, not the server prop, so
  rapid repeated clicks compose instead of reading a stale closure.
- Post-`await` state updates are wrapped in `startTransition`; toasts are not (they do
  not update React state). This is the documented React limitation the guide calls out.

## 5. Corrections carried along

### 5.1 `savePoliciesAction` loses its error cause

It returns `{ status: 'idle' | 'ok' | 'error' }` — a non-standard shape (every other
manage route uses `ManageActionResult = { ok: true } | { ok: false }` from
`app/s/[slug]/manage/action-result.ts`) that also collapses a Zod parse failure and the
`invalid_lead` domain error into one value, which is why the form always blames the lead
field. It moves to a discriminated union carrying the cause, so the form can show the
right message.

### 5.2 A raced remove reports a false error

`ownerRemoveBookingAction` maps `ownerRemoveBooking`'s real discriminants
(`'not_found' | 'not_active'`) onto a bare `{ ok: false }`, so re-removing an
already-removed booking toasts "Something went wrong" at an operator whose intent was in
fact satisfied. `not_active` becomes a benign, distinct message.

### 5.3 Tests cannot see `app/`

`vitest.config.mts` has `include: ['src/**/*.test.ts', 'src/**/*.test.tsx']`. All 63
component files under `app/` are therefore untestable, including every component this
spec changes. The glob gains `app/**/*.test.tsx`. Note the project-wide
`environment: 'node'`, so each component test needs the
`// @vitest-environment jsdom` pragma the two existing component tests already use.

### 5.4 Missing i18n keys

`manage.policies.saved` does not exist and must be added to **both** `messages/en.json`
and `messages/tr.json`, along with keys for the confirm dialog (§4.3), the distinct
policies error causes (§5.1) and the benign-remove message (§5.2).

## 6. Rollout

| Group | Sites | Treatment |
|---|---|---|
| Primitive | — | `PendingButton`, vitest glob, i18n keys |
| Reported bugs | policies form; bookings roster remove | §1.1 + §4.1–4.3 in full |
| No feedback at all | window form, window delete, 3× date-override, skill-level select, join, sign-out, logo remove | `PendingButton`; `join` needs a client boundary before it can have pending state at all |
| Pending, no optimistic | the 17 group-B sites | §3 taxonomy |

## 7. Testing

- **Component tests** (`@testing-library/react`, jsdom pragma) for `PendingButton`:
  renders the spinner and sets `disabled` + `data-pending` while a form action is
  in flight; merges a caller-supplied `disabled`; clears on resolution.
- **A regression test for the shared-pending bug**: two rows, each in its own form;
  submitting row A must leave row B's button enabled. This is the test that would have
  caught the four-site defect.
- **A test for the policies remount hazard**: remounting the form with a new `key` must
  not swallow the success toast.
- Existing suites (275 passing) must stay green; `pnpm lint` and `tsc --noEmit` clean.

## 8. Deferred

- `join/page.tsx` is a Server Component with no client boundary; giving it a pending
  state requires extracting a client form. In scope, but flagged as the one structural
  change in the rollout.
- `src/i18n/set-locale.ts` still has zero callers — no language switcher exists. Out of
  scope; unchanged.
- Sign-out uses `window.location.href` rather than a router navigation. Only its pending
  state is in scope; the navigation strategy is untouched.
