# Responsive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mutation in the app gives an unmistakable signal within one frame of the click, and no destructive action can be triggered by a click aimed at a row that has since changed identity.

**Architecture:** One shared `PendingButton` primitive reads `useFormStatus()`, which is scoped to the nearest ancestor `<form>`. Because every row in this codebase already renders its own `<form>`, this delivers per-row pending with no state lifting and fixes the existing shared-pending bug for free. Destructive rows fade in place rather than being optimistically removed. Optimistic updates are applied only where they do not move the layout.

**Tech Stack:** Next.js 16.3, React 19.2.8, Base UI (shadcn), sonner, next-intl, Tailwind v4, vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-08-07-oarly-responsive-ui-design.md` — read §1.2 before touching the bookings roster.

## Global Constraints

- **Never hand-author or edit `src/components/ui/*`.** It is shadcn CLI-managed. All new shared components go in `src/components/`.
- **Never add `Co-Authored-By` or any AI-attribution trailer to commits.**
- Every user-visible string goes in **both** `messages/en.json` and `messages/tr.json`. Turkish is the app default.
- `pnpm lint` must stay at zero warnings (`--max-warnings 0`) and `pnpm exec tsc --noEmit` clean.
- The existing suite must stay green. Baseline at branch point: **275 passed / 139 skipped**.
- Component tests need `// @vitest-environment jsdom` as the first line — the project default is `environment: 'node'`.
- `@testing-library/user-event` is **not installed**. Use `fireEvent` from `@testing-library/react`. Do not add the dependency.
- Base UI's `Button` emits the **native** `disabled` attribute (verified in `node_modules/@base-ui/react/utils/useFocusableWhenDisabled.mjs`), so `disabled:` Tailwind variants apply. Do not add `aria-disabled` by hand.
- Base UI uses a `render` prop, **not** `asChild`.
- Base UI `Select` does not serialize to FormData — every usage pairs it with a hidden input. Preserve that.
- Do not migrate to Cache Components / `'use cache'`. `revalidatePath` stays.

---

### Task 1: `PendingButton` primitive + test infrastructure

**Files:**
- Create: `src/components/pending-button.tsx`
- Create: `src/components/pending-button.test.tsx`
- Modify: `vitest.config.mts` (include glob)

**Interfaces:**
- Produces: `PendingButton` — a drop-in replacement for `<Button type="submit">` inside any `<form action={...}>`. Props are `Button`'s props. It supplies `type="submit"` by default, and merges a caller-supplied `disabled`.

**Context:** `useFormStatus()` returns `{ pending: boolean, ... }` for the **nearest ancestor `<form>`**. This has been verified empirically against this exact React version (19.2.8): with two `<form>` elements sharing a single `useActionState` dispatch, submitting form A marks only A pending; B stays idle. That property is what makes this component fix the shared-pending bug at four call sites without touching their hoisted `useActionState`.

- [ ] **Step 1: Extend the vitest include glob**

`vitest.config.mts` currently has `include: ['src/**/*.test.ts', 'src/**/*.test.tsx']`, which makes all 63 component files under `app/` untestable. Change to:

```ts
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'app/**/*.test.tsx'],
```

- [ ] **Step 2: Write the failing test**

Create `src/components/pending-button.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useActionState } from 'react';
import { describe, expect, it } from 'vitest';

import { PendingButton } from '@/components/pending-button';

/** Two forms sharing ONE useActionState dispatch — the shape used by bookings-roster. */
function TwoRows({ release }: { release: { fn: (() => void) | null } }) {
  const [, action] = useActionState(async () => {
    await new Promise<void>((r) => { release.fn = r; });
    return null;
  }, null);
  return (
    <>
      <form action={action} data-testid="form-a"><PendingButton>Remove A</PendingButton></form>
      <form action={action} data-testid="form-b"><PendingButton>Remove B</PendingButton></form>
    </>
  );
}

describe('PendingButton', () => {
  it('disables and marks only the submitted form pending', async () => {
    const release = { fn: null as (() => void) | null };
    render(<TwoRows release={release} />);
    const a = screen.getByRole('button', { name: /Remove A/ });
    const b = screen.getByRole('button', { name: /Remove B/ });

    fireEvent.submit(screen.getByTestId('form-a'));

    await waitFor(() => expect(a).toBeDisabled());
    expect(a).toHaveAttribute('data-pending');
    // The regression that matters: row B must stay usable while row A is in flight.
    expect(b).not.toBeDisabled();
    expect(b).not.toHaveAttribute('data-pending');

    release.fn?.();
    await waitFor(() => expect(a).not.toBeDisabled());
    expect(a).not.toHaveAttribute('data-pending');
  });

  it('shows a spinner while pending and keeps the label visible', async () => {
    const release = { fn: null as (() => void) | null };
    render(<TwoRows release={release} />);
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.submit(screen.getByTestId('form-a'));

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    // Label must not be replaced — swapping it would resize the button mid-flight.
    expect(screen.getByRole('button', { name: /Remove A/ })).toBeInTheDocument();
    release.fn?.();
  });

  it('honours a caller-supplied disabled even when idle', () => {
    render(<form><PendingButton disabled>Add</PendingButton></form>);
    expect(screen.getByRole('button', { name: /Add/ })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run src/components/pending-button.test.tsx`
Expected: FAIL — cannot resolve `@/components/pending-button`.

- [ ] **Step 4: Implement**

Create `src/components/pending-button.tsx`:

```tsx
'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * A submit button that derives its pending state from the enclosing <form> via
 * `useFormStatus()` instead of taking it as a prop.
 *
 * Why this shape rather than `disabled={pending}` at each call site:
 *
 *  - `useFormStatus` is scoped to the NEAREST ANCESTOR <form>. Several call sites
 *    (bookings-roster, skill-levels-editor, profile-form) deliberately hoist ONE
 *    `useActionState` into the list parent so the success toast survives the row
 *    unmounting on revalidation — but they then reused that single `pending` flag for
 *    every row, so removing one member greyed out Remove on every row. Because each row
 *    already renders its own <form>, this component gives per-row pending for free and
 *    leaves the deliberate hoisting untouched.
 *  - It removes `pending` from every component's prop surface. The policies form
 *    regressed precisely by dropping the third slot of the `useActionState` tuple; there
 *    is no third slot to drop here.
 *
 * `data-pending` is exposed so an ancestor can react in pure CSS — Tailwind's
 * `has-data-pending:` / `group-has-data-pending:` compile to `:has()`. Destructive rows
 * use that to fade IN PLACE rather than unmount: removing the node reflows every row
 * below it, and that reflow is what let a second click land on a different member's
 * booking (see spec §1.2).
 */
export function PendingButton({
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      {...props}
      disabled={disabled || pending}
      data-pending={pending ? '' : undefined}
    >
      {/*
        The label is never replaced by the spinner — swapping it would change the
        button's width mid-flight, which is its own form of layout shift.
      */}
      {pending && <Spinner />}
      {children}
    </Button>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/components/pending-button.test.tsx`
Expected: 3 passed.

- [ ] **Step 6: Mutation-check the regression test**

Temporarily change `disabled={disabled || pending}` to `disabled={disabled}`. Test 1 must fail. Revert. Then temporarily drop `data-pending` and confirm test 1 fails again. Revert. A test that passes with the implementation gutted is not a test.

- [ ] **Step 7: Full suite + commit**

Run: `pnpm vitest run && pnpm lint && pnpm exec tsc --noEmit`

```bash
git add src/components/pending-button.tsx src/components/pending-button.test.tsx vitest.config.mts
git commit -m "feat(ui): add PendingButton with form-scoped pending state"
```

---

### Task 2: Fix the policies form

**Files:**
- Modify: `app/s/[slug]/manage/policies/policies-form.tsx`
- Modify: `app/s/[slug]/manage/policies/page.tsx`
- Modify: `app/s/[slug]/manage/policies/actions.ts`
- Modify: `messages/en.json`, `messages/tr.json`
- Create: `app/s/[slug]/manage/policies/policies-form.test.tsx`

**Interfaces:**
- Consumes: `PendingButton` from Task 1.

**Context — read this before writing code.** `page.tsx:24` renders `<PoliciesForm key={club.updatedAt.getTime()} …>`, and `clubs.updatedAt` is `$onUpdate`-stamped on every write. A successful save bumps that key and **fully unmounts and remounts `PoliciesForm`**, resetting `useActionState` to its initial value. A `useEffect` toast placed inside `PoliciesForm` will therefore never fire. `app/s/[slug]/manage/profile/profile-form.tsx` already solves this exact problem — read `:18-33`, `:57` and `:96` and copy the structure: the stable outer component owns `useActionState` and the toast effect, and the `key` moves down onto the inner `<form>`.

- [ ] **Step 1: Give the action a discriminated result carrying the cause**

`actions.ts` currently returns `{ status: 'idle' | 'ok' | 'error' }`, collapsing a Zod parse failure and the `invalid_lead` domain error into one value — which is why the form always blames the lead-days field. Replace `PoliciesState` with:

```ts
export type PoliciesState =
  | { status: 'idle' }
  | { status: 'ok' }
  | { status: 'error'; cause: 'invalid_lead' | 'invalid_input' };
```

Return `{ status: 'error', cause: 'invalid_input' }` on the Zod failure and
`{ status: 'error', cause: 'invalid_lead' }` on the `invalid_lead` result from
`updateSchedulingSettings`. Leave both `revalidatePath` calls unchanged.

- [ ] **Step 2: Add i18n keys**

Add to `manage.policies` in **both** `messages/en.json` and `messages/tr.json`:

| Key | en | tr |
|---|---|---|
| `saved` | `Policies saved.` | `Politikalar kaydedildi.` |
| `errorInvalidInput` | `Check the highlighted fields and try again.` | `İşaretli alanları kontrol edip tekrar deneyin.` |

`errorInvalidLead` already exists — keep it.

- [ ] **Step 3: Restructure the component**

In `policies-form.tsx`, split into a stable outer and an inner form, mirroring `profile-form.tsx`:

- The outer component owns `useActionState`, the `useRef` identity guard, and the toast `useEffect`. On `state.status === 'ok'` fire `toast.success(t('saved'))`; on `'error'` fire `toast.error` with the message selected by `state.cause`.
- Move `key={club.updatedAt.getTime()}` off `<PoliciesForm>` in `page.tsx` and onto the inner `<form>` element (or a wrapper `div` inside the stable outer), so the form fields still reset to server values after a save while the toast effect survives.
- Replace the bare `<Button type="submit" className="self-start">` at `:115` with `<PendingButton className="self-start">{labels.save}</PendingButton>`.
- Keep the inline `<p className="text-sm text-destructive">` but drive its text from `state.cause` instead of hard-coding the lead-days message.

- [ ] **Step 4: Write the remount-hazard test**

Create `app/s/[slug]/manage/policies/policies-form.test.tsx` with the jsdom pragma. It must prove the specific hazard: render the outer component, drive a successful action, remount the inner form with a new `key`, and assert the success toast still fired exactly once. Mock `sonner`'s `toast` with `vi.mock` and mock `next-intl`'s `useTranslations` to return the key. Assert on the mocked `toast.success` call.

- [ ] **Step 5: Verify and mutation-check**

Run: `pnpm vitest run app/s/[slug]/manage/policies` — expect PASS.
Then move the toast effect back inside the keyed inner component and confirm the test **fails**. Revert. This is the whole point of the test.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "fix(policies): give Save pending state, a success toast, and a truthful error"
```

---

### Task 3: Fix the bookings roster remove

**Files:**
- Modify: `app/s/[slug]/manage/bookings/bookings-roster.tsx`
- Modify: `app/s/[slug]/manage/bookings/actions.ts`
- Modify: `messages/en.json`, `messages/tr.json`
- Create: `app/s/[slug]/manage/bookings/bookings-roster.test.tsx`

**Interfaces:**
- Consumes: `PendingButton` from Task 1.

**Context — read spec §1.2 in full first.** The bug this task fixes is *not* a missing pending state; `disabled={rmPending}` is already there and works. It is that (a) a ghost-variant button at 50% opacity for <1s is not a perceptible signal, and (b) `rmPending` flips to `false` on the same commit that re-renders the list with the removed row gone and everything below shifted up — so the moment the button becomes clickable again is the moment a different member's Remove button occupies the cursor's pixels. **Do not optimistically remove the row**; that moves the reflow earlier and makes the hazard worse.

- [ ] **Step 1: Add i18n keys**

Add to `manage.bookings` in **both** message files:

| Key | en | tr |
|---|---|---|
| `confirmRemoveTitle` | `Remove {name}'s booking?` | `{name} adlı üyenin rezervasyonu kaldırılsın mı?` |
| `confirmRemoveBody` | `This cannot be undone. If someone is waiting, the next person on the waitlist takes the seat.` | `Bu işlem geri alınamaz. Bekleme listesi doluysa sıradaki kişi koltuğu alır.` |
| `confirmRemoveCta` | `Remove booking` | `Rezervasyonu kaldır` |
| `removeAlready` | `That booking was already removed.` | `Bu rezervasyon zaten kaldırılmış.` |

- [ ] **Step 2: Stop reporting a benign race as an error**

In `actions.ts`, `ownerRemoveBookingAction` maps `ownerRemoveBooking`'s real discriminants (`'not_found' | 'not_active'`) onto a bare `{ ok: false }`, so re-removing an already-removed booking toasts "Something went wrong" at an operator whose intent was in fact satisfied. Widen the result:

```ts
export type RemoveActionResult = { ok: true } | { ok: false; error?: 'not_active' };
```

Return `{ ok: false, error: 'not_active' }` when `result.error === 'not_active'`. In the roster's toast effect, branch that to `toast.info(t('removeAlready'))` rather than `toast.error(tm('actionError'))`.

- [ ] **Step 3: Add the confirmation dialog**

The file already has the pattern: a `confirming` state object plus a `<Dialog>` at `:148-172` guarding **mark-absent** — which is *reversible* (`undoNoShowAction` exists). Removal is irreversible and cascades a waitlist promotion, and has no confirmation at all. Correct that asymmetry.

Add a second state object (e.g. `removing: { bookingId: string; name: string } | null`) and a second `<Dialog>` that submits `rmAction` with the hidden `bookingId`, using `confirmRemoveTitle` / `confirmRemoveBody` / `confirmRemoveCta` and a `variant="destructive"` `PendingButton`. Both Remove buttons — seated (`:111-114`) and waitlisted (`:131-134`) — become `type="button"` triggers that open it.

- [ ] **Step 4: Fade the row in place**

Every remaining in-row submit (`undoAction`, and the dialog's own submit) uses `PendingButton`. Add `has-data-pending:opacity-40 transition-opacity` to the seated `<li>` (`:93`) and the waitlisted `<li>` (`:129`) so a row with an in-flight action dims itself. Do not remove the row from `s.seated` / `s.waitlisted` optimistically.

- [ ] **Step 5: Drop the now-redundant shared pending flags**

`disabled={rmPending}` and `disabled={undoPending}` on per-row buttons are superseded by `PendingButton`. Remove those props. **Keep** the hoisted `useActionState` calls and their toast effects exactly as they are — the comment at `:33-34` explains why they must stay hoisted.

- [ ] **Step 6: Write the tests**

Create `bookings-roster.test.tsx` (jsdom pragma). Cover:
1. Clicking Remove opens a confirmation naming the member and does **not** dispatch the action.
2. Confirming dispatches with the correct `bookingId`.
3. While one row's remove is in flight, another row's Remove control is still enabled — the shared-pending regression.
4. The row carries `has-data-pending:opacity-40` so an in-flight descendant dims it.

- [ ] **Step 7: Mutation-check and commit**

Delete the confirm dialog wiring and confirm test 1 fails. Revert. Re-add `disabled={rmPending}` to both row buttons and confirm test 3 fails. Revert.

Run: `pnpm vitest run && pnpm lint && pnpm exec tsc --noEmit`

```bash
git add -A && git commit -m "fix(bookings): confirm before removing a booking and fade the row in place"
```

---

### Task 4: Roll `PendingButton` into the remaining no-feedback form sites

**Files (all Modify):**
- `app/s/[slug]/manage/schedule/window-form.tsx` — "Save"; also drops `pending` from its `useActionState` destructure, same defect as policies
- `app/s/[slug]/manage/schedule/schedule-editor.tsx:52-55` — "Delete" on a window row; a plain `<form action={deleteWindowAction.bind(null, slug)}>` with no `useActionState` at all. `PendingButton` works here unchanged — that is the point of reading status from the form.
- `app/s/[slug]/manage/schedule/preview/date-override-controls.tsx` — all three buttons ("Close" `:13-17`, "Force open" `:18-22`, "Reset" `:24-27`), same plain-bound-action shape
- `app/s/[slug]/manage/profile/logo-upload.tsx:91-101` — "Remove logo"

**Context:** the first four are `<form action={...}>` sites, so they take `PendingButton` directly. Logo-remove is **not** a form — it is a plain async `onClick` calling `fetch`, and today the trigger is *conditionally unmounted* mid-flight (`{url && !busy && (…)}`) so it vanishes instead of showing pending. Keep it mounted and give it the existing `busy` flag plus a `<Spinner />`, matching how the upload label already behaves at `:79-90`.

For the destructive window-delete row, also add `has-data-pending:opacity-40 transition-opacity` to its row container.

- [ ] **Step 1** Replace each submit button with `PendingButton`, removing any now-redundant `disabled={pending}`.
- [ ] **Step 2** Fix logo-remove to stay mounted and show `busy`.
- [ ] **Step 3** Run `pnpm vitest run && pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Step 4** Commit: `fix(manage): add pending feedback to schedule, override and logo controls`

---

### Task 5: Give the join form a client boundary

**Files:**
- Modify: `app/s/[slug]/join/page.tsx`
- Create: `app/s/[slug]/join/join-form.tsx`

**Context:** this is the one structural change in the rollout. `page.tsx:57-60` is a Server Component rendering a raw `<button type="submit" className={buttonVariants({...})}>` inside `<form action={joinAction.bind(null, slug)}>`. There is no client boundary, so pending state is *structurally impossible* today. Errors currently surface as a `?error=rate_limited` query param rendered inline — leave that mechanism alone.

Extract the `<form>` into a `'use client'` component that renders `PendingButton`, and have the page render it. Keep the bound-action prop shape (`action` passed as a prop) so the page keeps owning the binding.

- [ ] **Step 1** Create `join-form.tsx` as a client component taking the bound action as a prop.
- [ ] **Step 2** Render it from `page.tsx`; delete the inline `<form>`.
- [ ] **Step 3** Verify the rate-limit error path still renders.
- [ ] **Step 4** Run checks and commit: `fix(join): add pending feedback to the join request button`

---

### Task 6: Roll `PendingButton` through the group-B sites

**Files (all Modify):**
- `app/s/[slug]/manage/skill-levels/skill-levels-editor.tsx` — delete (`:55-58`), add (`:99-105`), rename (`:127-135`), reorder arrows (`:150-155`)
- `app/s/[slug]/manage/profile/profile-form.tsx` — remove social (`:106-109`), add social (`:137-147`), save (`:96`)
- `app/s/[slug]/manage/members/member-actions.tsx` — approve (`:24-29`), reject (`:42-47`)
- `app/s/[slug]/manage/boats/boats-editor.tsx` — save (`:114-123`, `:159`), active toggle (`:136-142`)
- `app/s/[slug]/(member)/bookings/bookings-list.tsx` — cancel (`:33-39`)
- `app/admin/club-status-button.tsx` — activate/suspend
- `app/s/[slug]/manage/bookings/bookings-roster.tsx` — the add-member form (`:201`), which keeps `disabled={!selected}` as a caller-supplied disabled

Replace each hand-rolled `disabled={pending}` with `PendingButton`, preserving any caller-supplied disabled condition. Add `has-data-pending:opacity-40 transition-opacity` to the row container for the **destructive** ones only: delete skill level, remove social, reject member.

Note `skill-levels-editor` and `profile-form` hoist a shared `delPending` / `rmPending` across every row — same bug as the roster, fixed the same way. Keep the hoisted `useActionState`; delete only the shared `disabled` prop.

Also fix `bookings-list.tsx`: its failure path is inline-only (`<span className="text-xs text-destructive">`) with no error toast, unlike every sibling. Give it `toast.error(tm('actionError'))` for consistency.

- [ ] **Step 1** Apply the replacements file by file.
- [ ] **Step 2** Add a test asserting per-row independence for `skill-levels-editor` (same shape as Task 3's test 3).
- [ ] **Step 3** Run `pnpm vitest run && pnpm lint && pnpm exec tsc --noEmit`.
- [ ] **Step 4** Commit: `fix(manage): per-row pending state across all list mutations`

---

### Task 7: Optimistic in-place value changes

**Files (all Modify):**
- `app/s/[slug]/manage/skill-levels/skill-levels-editor.tsx` — reorder arrows
- `app/s/[slug]/manage/boats/boats-editor.tsx` — active/inactive toggle
- `app/admin/club-status-button.tsx` — activate/suspend
- `app/s/[slug]/manage/members/skill-level-select.tsx` — the per-member skill `<Select>`

**Scope rule (deliberate, per spec §3):** optimistic updates are applied **only** where the update cannot move the layout — value swaps and equal-height reorders. Additive and destructive list changes are covered by `PendingButton` + fade-in-place and are *not* made optimistic, because inserting or removing a node reflows its siblings, which is the hazard from §1.2. Do not "finish the job" by adding optimistic add/remove.

**Pattern** (from the Next.js 16.3 *Building interactive apps* guide, Step 2 / Step 5):

```tsx
const [optimistic, setOptimistic] = useOptimistic(serverValue);
const [, startTransition] = useTransition();

function handle(next: T) {
  startTransition(async () => {
    setOptimistic(next);          // applies on the current frame
    await action(next);
  });
}
```

Two rules that must hold:
- The reducer reads from the **optimistic** value, not the server prop, so rapid repeated clicks compose rather than reading a stale closure.
- Any state update *after* an `await` must be wrapped in `startTransition` (a documented React limitation). Toasts do not need it — they do not update React state.

Reorder arrows are the highest-value case: a frequent nudge whose whole point is immediacy, and layout-safe because the cursor sits on an arrow that moves with its own row.

`skill-level-select.tsx` also drops `pending` from its `useActionState` destructure today and auto-submits from an effect — give the `<SelectTrigger>` a disabled state while in flight.

- [ ] **Step 1** Apply the pattern per file.
- [ ] **Step 2** Add a component test for the reorder arrows: clicking ↑ reorders the rendered list **before** the action resolves.
- [ ] **Step 3** Mutation-check: remove `setOptimistic` and confirm the test fails.
- [ ] **Step 4** Run checks and commit: `feat(manage): optimistic updates for toggles and reordering`

---

### Task 8: Optimistic append in the booking roster

**Files:**
- Modify: `app/s/[slug]/manage/bookings/bookings-roster.tsx` (`AddMemberForm`, `:177-204`)

The roster's add-member is the one additive path frequent enough to justify optimistic treatment (an owner seating walk-ins during a session). Appending renders below the existing rows, so it shifts nothing above it — layout-safe.

Use `useOptimistic` with an empty initial array for *pending* additions, rendered dimmed beneath the confirmed `s.seated` list, per the guide's Step 4 pattern. Reset the combobox with the `key`-increment technique from Step 6 rather than controlled state, so the field clears on success only.

- [ ] **Step 1** Implement the optimistic pending-additions list.
- [ ] **Step 2** Test: submitting shows the member immediately, dimmed, before the action resolves.
- [ ] **Step 3** Run full checks and commit: `feat(bookings): optimistic seat additions in the roster`

---

## Final verification

- [ ] `pnpm lint` → 0 warnings
- [ ] `pnpm exec tsc --noEmit` → clean
- [ ] `pnpm vitest run` → ≥275 passing, 0 failing
- [ ] `pnpm build` → succeeds
- [ ] Grep for stragglers: `grep -rn "disabled={.*[Pp]ending}" app/ src/` should return only intentional caller-supplied conditions.
