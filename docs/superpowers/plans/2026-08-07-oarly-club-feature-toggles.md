# Per-club Feature Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A club that has no MultiSport contract can switch it off, after which MultiSport is neither offered anywhere in the UI nor accepted by any server path.

**Architecture:** One boolean column on `clubs`, read through the existing loaders. No feature-flag framework — per-club optionality is already expressed as plain columns in this codebase. The invariant "no boat advertises MultiSport at a club with MultiSport off" is repaired at **write time**, which keeps `checkEligibility` pure.

**Tech Stack:** Drizzle + Postgres, Next.js 16.3, React 19.2.8, next-intl, vitest.

**Spec:** `docs/superpowers/specs/2026-08-07-oarly-club-feature-toggles-design.md` — read §5 before writing any enforcement code.

## Global Constraints

- **Never hand-author or edit `src/components/ui/*`** — shadcn CLI-managed.
- **Never add `Co-Authored-By` or any AI-attribution trailer to commits.**
- Every user-visible string goes in **both** `messages/en.json` and `messages/tr.json`. Turkish is the app default.
- `pnpm lint` at zero warnings, `pnpm exec tsc --noEmit` clean, suite green.
- Migrations: `pnpm db:generate` to author, `pnpm db:migrate` to apply. `scripts/local-migrate.mjs` **refuses any non-localhost host** unless `ALLOW_REMOTE_MIGRATE=1`. Never point it at production.
- Integration tests need the test DB: `pnpm test:integration` (port 5433). They are skipped without it — a green `pnpm vitest run` does **not** mean the integration tests ran.
- `multisport_enabled` defaults to **true** so every existing club is unaffected by the migration.
- Use `PendingButton` (`src/components/pending-button.tsx`) for any new submit control — do not hand-roll `disabled={pending}`.

---

### Task 1: Schema, migration, and the settings loader

**Files:**
- Modify: `src/db/schema/clubs.ts`, `src/db/schema/clubs.test.ts`
- Modify: `src/lib/scheduling-settings.ts`, `src/lib/schemas.ts`
- Create: `drizzle/00XX_*.sql` (generated)

**Interfaces produced:** `SchedulingSettingsInput` gains `multisportEnabled: boolean`; `getSchedulingSettings` returns it.

- [ ] **Step 1** Add the column next to `multisportMode`:

```ts
  multisportEnabled: boolean('multisport_enabled').notNull().default(true),
```

- [ ] **Step 2** `pnpm db:generate`. Inspect the generated SQL — it must be a plain `ADD COLUMN ... NOT NULL DEFAULT true` with no table rewrite of existing data beyond the default.
- [ ] **Step 3** Add `multisportEnabled` to `SchedulingSettingsInput`, to `getSchedulingSettings`'s select list, and to `updateSchedulingSettings`'s `.set({...})`.
- [ ] **Step 4** Add `multisportEnabled: z.boolean()` to `schedulingSettingsSchema` in `src/lib/schemas.ts`.
- [ ] **Step 5** Update `src/db/schema/clubs.test.ts` for the new column; run `pnpm vitest run`.
- [ ] **Step 6** Apply locally (`pnpm db:migrate` against the dev DB) and commit: `feat(db): add clubs.multisport_enabled`

---

### Task 2: Repair the boat invariant at write time

**Files:**
- Modify: `src/lib/scheduling-settings.ts`
- Modify/Create: `src/lib/scheduling-settings.integration.test.ts`

**Context — read spec §5.2.** A boat with `allowed_payment = 'multisport_only'` at a club that turns MultiSport off has **no valid payment type left and becomes silently unbookable**. Disabling must convert those boats to `regular_only` in the same transaction as the flag write. `both` needs no change — it already permits cash.

`updateSchedulingSettings` is currently a bare single `UPDATE` with no transaction. Wrap both writes in `db.transaction(...)`.

- [ ] **Step 1** Widen the result so the UI can report what happened:

```ts
export type SchedulingResult =
  | { ok: true; convertedBoats: number }
  | { ok: false; error: 'invalid_lead' };
```

- [ ] **Step 2** In the transaction, after the `clubs` update, when `input.multisportEnabled === false`, update `boatTypes` setting `allowedPayment: 'regular_only'` where `clubId` matches **and** `allowedPayment = 'multisport_only'`; return the affected row count as `convertedBoats`. When the flag is true, `convertedBoats` is 0.
- [ ] **Step 3** Integration tests: (a) disabling converts only that club's `multisport_only` boats and leaves `both` and `regular_only` alone; (b) another club's boats are untouched; (c) re-enabling does **not** convert them back; (d) a club with converted boats can still book.
- [ ] **Step 4** Mutation-check: remove the boat update and confirm test (a) fails.
- [ ] **Step 5** `pnpm test:integration` and commit: `feat(clubs): convert multisport-only boats when disabling MultiSport`

---

### Task 3: Enforce in `checkEligibility` (the member path)

**Files:**
- Modify: `src/lib/eligibility.ts`, `src/lib/eligibility.test.ts`
- Modify: `src/lib/booking.ts` (the `checkEligibility` call and the club select feeding it)
- Modify: `src/lib/member-calendar.ts` (same)

`checkEligibility` gains `clubMultisportEnabled: boolean` and rejects `paymentType === 'multisport'` when it is false, with the existing `payment_not_allowed` reason. Place the check with the other payment rules, after the skill rules, so failure ordering stays as documented.

Both call sites must now select `clubs.multisportEnabled` and pass it.

- [ ] **Step 1** Write the failing unit tests: MultiSport rejected when the club has it off, across every `allowed_payment` value; `regular` still permitted; nothing changes when the flag is true.
- [ ] **Step 2** Run them — expect FAIL.
- [ ] **Step 3** Implement; thread the flag through both call sites.
- [ ] **Step 4** `pnpm vitest run` and commit: `feat(booking): reject MultiSport when the club has it disabled`

---

### Task 4: Enforce on the owner path

**Files:**
- Modify: `src/lib/booking.ts` (`ownerAddBooking`)
- Modify: `src/lib/booking.integration.test.ts`

**Context — this is the trap, spec §5.1.** `ownerAddBooking` **deliberately does not call `checkEligibility`.** Its comment is explicit that the owner override "skips the member-facing gates — skill/payment eligibility AND the closed-day / holiday / booking-open checks". So Task 3 does **not** cover it, and an owner (or a crafted POST) could still record a MultiSport booking at a club that has MultiSport off.

The existing waiver reasoning does not apply here. That comment draws the line at "the club's gates are the owner's to waive, the card's rule is not". A club-wide "we have no MultiSport contract" is not a gate being relaxed for one member — there is no such payment arrangement to record. Reject it; do not waive it.

- [ ] **Step 1** Add the check next to the existing `multisportDayTaken` guard in the owner path, using a clear discriminant (e.g. `'multisport_disabled'`), and add it to `OwnerAddResult`'s error union.
- [ ] **Step 2** Surface it in `ownerAddBookingAction` and give it an i18n message in both files.
- [ ] **Step 3** Integration test: an owner adding a MultiSport booking at a disabled club is rejected; the same add with `regular` succeeds.
- [ ] **Step 4** Mutation-check: delete the guard and confirm the test fails.
- [ ] **Step 5** `pnpm test:integration` and commit: `feat(booking): reject owner-added MultiSport bookings when disabled`

---

### Task 5: Narrow the offered payment choices

**Files:**
- Modify: `src/lib/member-calendar.ts` (`paymentChoicesFor`, `defaultPaymentFor`, and their call sites)
- Modify: `src/lib/member-calendar.integration.test.ts`

Both helpers take the club flag. When off they return `['regular']` and `'regular'` respectively, **regardless of the boat's `allowed_payment`** — Task 2 guarantees no `multisport_only` boat survives at a disabled club, and `both` must narrow to cash.

- [ ] **Step 1** Failing test: a disabled club's sessions offer exactly `['regular']`.
- [ ] **Step 2** Implement and thread the flag.
- [ ] **Step 3** Commit: `feat(calendar): offer only cash when MultiSport is disabled`

---

### Task 6: Suppress MultiSport from every UI surface

**Files:**
- Modify: `app/s/[slug]/(member)/book/book-calendar.tsx` — `PaymentChips` must hide when only one payment type is possible. The radio picker already self-hides on `paymentChoices.length === 1`; the chips do not.
- Modify: `app/s/[slug]/manage/bookings/bookings-roster.tsx` — the add-member payment `<Select>` is hard-coded and club-unaware. Hide it when disabled and force the hidden input to `regular`. (Base UI `Select` does not serialize to FormData — the hidden input is what submits. Preserve that.)
- Modify: `app/s/[slug]/manage/boats/boats-editor.tsx` — hide the whole "Allowed payment" field when disabled, since `regular_only` is then the only possibility.
- Modify: `app/s/[slug]/manage/policies/policies-form.tsx` + `page.tsx` — add the toggle; nest the existing MultiSport-mode field under it so the mode disappears when the feature is off.
- Modify: `messages/en.json`, `messages/tr.json`.

The relevant page/loader must pass `multisportEnabled` down; `requireOwner`/`requireMember` already return the full `clubs` row, so no new fetching is needed.

**i18n:** `manage.policies.intro` hard-codes "MultiSport priority" in prose and needs a second variant for the disabled case. Add the toggle label, a hint, and the disable-confirmation copy (which must state how many boats will be converted and that re-enabling does **not** convert them back).

- [ ] **Step 1** Thread the flag to each surface.
- [ ] **Step 2** Component tests: the roster's payment `<Select>` and the booking chips are absent when disabled, present when enabled.
- [ ] **Step 3** Confirmation step on the toggle when turning it **off**, reporting the boat count from Task 2's `convertedBoats`.
- [ ] **Step 4** `pnpm vitest run && pnpm lint && pnpm exec tsc --noEmit`; commit: `feat(manage): hide MultiSport everywhere when the club disables it`

---

### Task 7: Nest dependent settings under their toggles

**Files:**
- Modify: `app/s/[slug]/manage/policies/policies-form.tsx`

Applies the same "don't show me settings for a feature I turned off" principle to the toggles that already exist: the cancellation-cutoff field appears only when self-cancellation is on, and the lead-days field only in `lead` mode (verify whether that one is already conditional before changing it).

- [ ] **Step 1** Nest the dependent fields.
- [ ] **Step 2** Verify a hidden field still submits a valid value — a field that unmounts sends nothing, and the Zod schema must still parse. This is the likely failure and the reason this is its own task.
- [ ] **Step 3** Commit: `feat(policies): hide settings that belong to a disabled feature`

---

## Final verification

- [ ] `pnpm lint` → 0 warnings; `pnpm exec tsc --noEmit` → clean
- [ ] `pnpm vitest run` → no regressions
- [ ] `pnpm test:integration` → green (these are the tests that actually cover Tasks 2 and 4)
- [ ] `pnpm build` → succeeds
- [ ] Manual: disable MultiSport on a seeded club and grep the rendered pages for "MultiSport" — it must appear nowhere.
