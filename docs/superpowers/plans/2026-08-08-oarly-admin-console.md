# Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 364-line, three-verb admin console into a real operations surface: a genuine approve/reject decision on club requests, audit logging across every owner/admin mutation plus a viewer for it, a club detail page, a users page with the platform-admin toggle, ownership transfer, and search + pagination on every list.

**Architecture:** Business logic stays in `src/lib/*.ts` as pure functions taking a Drizzle handle as their first argument and returning typed result unions (`{ ok: true, … } | { ok: false; error: '…' }`) — never thrown errors for expected outcomes. `app/admin/**` route segments are Server Components that read through those modules and call thin `'use server'` actions, which re-check `requireAdmin()` themselves (layouts do not govern server actions). Every audited mutation writes its `audit_log` row inside the same transaction as the mutation, so a mutation without an audit row is impossible. Client interactivity is confined to small `'use client'` leaf components driving `useActionState` + sonner toasts, matching `app/s/[slug]/manage/members/`.

**Tech Stack:** Next.js 16.3 App Router (React 19.2), Drizzle ORM 0.45 on Postgres 18 (`node-postgres`), Better Auth 1.6, next-intl 4.13, Zod 4, Tailwind 4 + shadcn/ui (Base UI primitives), Resend + react-email, Vitest 4 (`node` default env, `jsdom` opt-in per file).

## Global Constraints

- **Never hand-author or edit `src/components/ui/*`** — shadcn CLI-managed only. Custom components go in `src/components/`.
- **Never add `Co-Authored-By` or any AI-attribution trailer to commits.**
- Every user-visible string goes in **both** `messages/en.json` and `messages/tr.json`. Turkish is the app default.
- `pnpm lint` at zero warnings, `pnpm exec tsc --noEmit` clean, `pnpm vitest run` and `pnpm test:integration` green.
- Migrations: `pnpm db:generate` to author, `pnpm db:migrate` to apply. `scripts/local-migrate.mjs` refuses any non-localhost host unless `ALLOW_REMOTE_MIGRATE=1`. Never point it at production.
- Integration tests need the test DB on port 5433 (`docker compose up -d postgres`), and are SKIPPED without it — a green `pnpm vitest run` does NOT mean they ran.
- Use `PendingButton` (`src/components/pending-button.tsx`) for every submit control — do not hand-roll `disabled={pending}`.
- Destructive or irreversible controls get a confirmation dialog naming the subject (this codebase lost real user data to a double-click on an unconfirmed Remove).
- Component tests need `// @vitest-environment jsdom` as line 1 (project default is `environment: 'node'`).

### Additional standing rules for this cycle

- **Use the exact `action` strings from spec §4.2.** Do not invent new ones. The full list, for reference:
  `member.approve`, `member.reject`, `member.skill_assign`, `attendance.noshow`, `attendance.noshow_undo`,
  `booking.owner_add`, `booking.owner_remove`, `club.policies_update`, `club.profile_update`,
  `boat.create`, `boat.update`, `boat.set_active`,
  `skill_level.create`, `skill_level.rename`, `skill_level.reorder`, `skill_level.delete`,
  `window.create`, `window.update`, `window.delete`,
  `date_override.set`, `date_override.clear`,
  `club.create`, `club.activate`, `club.suspend`, `club.approve`, `club.reject`, `club.transfer_owner`,
  `user.admin_grant`, `user.admin_revoke`.
- `setClubLogo`, `addSocial`, `removeSocial`, `bookSeat`, `cancelBooking`, `requestToJoin` and `requestClub` are **deliberately not audited** (spec §4.2). Do not add them.
- `actingAsRole` is `'owner'` for a mutation performed through `requireOwner`, and `'admin'` for one performed through `requireAdmin`. Never leave it null on a new call site.
- Vitest's `include` is `['src/**/*.test.ts', 'src/**/*.test.tsx', 'app/**/*.test.tsx']`. A `.test.ts` file placed under `app/` **will never run**. Put logic tests in `src/`, component tests next to their `.tsx`.
- Every `.integration.test.ts` bootstraps itself: `describe.skipIf(!process.env.TEST_DATABASE_URL)`, a `Pool` in `beforeAll`, `await migrate(db, { migrationsFolder: './drizzle' })`, `await pool.end()` in `afterAll`. Copy that block verbatim from `src/lib/clubs-admin.integration.test.ts`.

---

## File Structure

**New library modules**

| File | Responsibility |
|---|---|
| `src/lib/users-admin.ts` | User search with memberships; `setPlatformAdmin` with the two guards. |
| `src/emails/club-decision.tsx` | Presentational react-email template for approve/reject notices. |

**Modified library modules**

| File | Change |
|---|---|
| `src/db/index.ts` | Export `Tx` and `DbOrTx` so `logAudit` accepts a transaction handle. |
| `src/db/schema/enums.ts` | `'admin'` on `membershipRoleEnum`; `'rejected'` on `clubStatusEnum`. |
| `src/db/schema/clubs.ts` | `reviewedAt` / `reviewedBy` / `reviewNote`; slug uniqueness moves to a partial index. |
| `src/lib/audit.ts` | Widened `logAudit` param; `'admin'` in `actingAsRole`; new `listAuditRows` keyset query. |
| `src/lib/tenant.ts` | `findClubBySlug(db, slug)` extracted; both it and `getClubBySlug` exclude rejected rows. |
| `src/lib/clubs-admin.ts` | `decideClubRequest`, restricted `setClubStatus`, `transferOwnership`, `listClubsForAdmin`, `getClubAdminDetail`; slug pre-check excludes rejected. |
| `src/lib/club-request.ts` | Slug pre-check excludes rejected. |
| `src/lib/notify.ts` | `notifyClubDecision` (best-effort, post-commit). |
| `src/emails/index.ts` | `renderClubDecision`. |
| `src/lib/members-admin.ts`, `attendance.ts`, `booking.ts`, `scheduling-settings.ts`, `club-profile.ts`, `boats.ts`, `skill-levels.ts`, `schedule.ts`, `date-overrides.ts` | Take `actorId`, wrap in a transaction where they are not already, write the audit row inside it. |

**New route files under `app/admin/`**

```
app/admin/audit/page.tsx            server: reads filters + cursor from searchParams
app/admin/audit/audit-filters.tsx   server: GET <form>, no JS
app/admin/audit/audit-table.tsx     presentational, prop-driven → jsdom-testable
app/admin/audit/audit-table.test.tsx
app/admin/users/page.tsx            server: search + pagination
app/admin/users/actions.ts          'use server': setPlatformAdminAction
app/admin/users/admin-toggle.tsx    'use client': confirm dialog + PendingButton
app/admin/clubs/[id]/page.tsx       server: club detail
app/admin/clubs/[id]/actions.ts     'use server': transferOwnershipAction
app/admin/clubs/[id]/transfer-owner.tsx  'use client': confirm dialog + PendingButton
app/admin/requests/decision-buttons.tsx  'use client': approve/reject dialogs
app/admin/requests/actions.ts       'use server': decideClubRequestAction
src/components/admin-pagination.tsx shared prev/next links for offset lists
```

Each admin page keeps its data reads in `page.tsx` and pushes anything interactive into a sibling leaf component, so `page.tsx` never needs `'use client'`.

---

### Task 1: Schema foundation — `admin` role, `rejected` status, review columns, partial slug index, widened `logAudit`, and the `getClubBySlug` fix

**Files:**
- Modify: `src/db/schema/enums.ts:4,9`
- Modify: `src/db/schema/clubs.ts:11-39`
- Modify: `src/db/index.ts:10-11`
- Modify: `src/lib/audit.ts` (whole file)
- Modify: `src/lib/clubs-admin.ts:22,30,41` (slug pre-check + delete both `as unknown as DB` casts)
- Modify: `src/lib/club-request.ts:13` (slug pre-check)
- Modify: `src/lib/tenant.ts:11-14`
- Create: `drizzle/0009_<drizzle-generated-name>.sql` (via `pnpm db:generate`)
- Test: `src/lib/tenant.integration.test.ts` (extend)

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]` and `type DbOrTx = DB | Tx`, both exported from `src/db/index.ts`.
  - `logAudit(db: DbOrTx, entry: { actorUserId: string; clubId?: string; action: string; target?: string; actingAsRole?: 'owner' | 'member' | 'admin' }): Promise<void>` — every later task calls this with a `tx`, never with a cast.
  - `findClubBySlug(db: DbOrTx, slug: string): Promise<Club | null>` in `src/lib/tenant.ts`; `getClubBySlug(slug: string): Promise<Club | null>` keeps its signature and delegates.
  - `clubs.reviewedAt: Date | null`, `clubs.reviewedBy: string | null`, `clubs.reviewNote: string | null`.
  - `clubStatusEnum` values `'pending' | 'active' | 'suspended' | 'rejected'`; `membershipRoleEnum` values `'owner' | 'member' | 'admin'`.

**Why the slug index and the `getClubBySlug` fix are ONE task and must never be split (spec §5.2):**

Today `clubs.slug` is `text NOT NULL UNIQUE`. A rejected spam request for `bogazici` would permanently burn that name, so the constraint is replaced with a unique index that exempts rejected rows. The instant that index lands, **a rejected `bogazici` and a live `bogazici` can coexist**. `getClubBySlug` is `select … where slug = ? limit 1` — `LIMIT 1` with no `ORDER BY` and no status filter returns *whichever row the planner reaches first*. Landing on the rejected one 404s a live club, intermittently, and only for clubs whose slug was once rejected — the worst possible bug shape: non-deterministic, data-dependent, invisible in CI. If this task is split and the index ships first, production has a live latent 404 generator. **The index and the status filter commit together, in the same commit, or neither ships.** The invariant to hold: *a rejected club is not addressable by slug.*

The same reasoning extends to the two slug pre-checks (`createClub` and `requestClub`): both do `select … where slug = ?` to decide `slug_taken`. If they keep matching rejected rows, the partial index frees the slug in the database while the application still refuses it — the feature would be silently dead. They are fixed here too.

**The Postgres trap in the migration — verified, not theoretical:**

`ALTER TYPE … ADD VALUE` and *using* that new value are not allowed in the same transaction unless the type itself was created in that transaction. Drizzle's migrator (`node_modules/drizzle-orm/pg-core/dialect.js:60`) runs **all pending migrations inside one `session.transaction(...)`**. So:

- On a **fresh** database (CI, a wiped test DB) migration 0000 creates `club_status` in the same transaction — a predicate `WHERE status <> 'rejected'` succeeds.
- On an **existing** database (your dev DB, staging, production) the type is old — the same predicate fails with `ERROR: unsafe use of new value "rejected" of enum type club_status`.

That is a migration that passes every test and breaks the production deploy. `WHERE status::text <> 'rejected'` does not help either — Postgres rejects it with `functions in index predicate must be marked IMMUTABLE`. The predicate must therefore be written with **only pre-existing enum values**, which is exactly equivalent today:

```sql
CREATE UNIQUE INDEX "clubs_slug_uq" ON "clubs" ("slug") WHERE "status" IN ('pending', 'active', 'suspended');
```

Both forms were run against `postgres:18` to confirm this. Use the `IN` form.

- [ ] **Step 1: Widen the enums**

`src/db/schema/enums.ts` — change exactly these two lines:

```ts
export const clubStatusEnum = pgEnum('club_status', ['pending', 'active', 'suspended', 'rejected']);
export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'member', 'admin']);
```

- [ ] **Step 2: Add the review columns and move slug uniqueness to a partial index**

`src/db/schema/clubs.ts` — add `sql` to the drizzle-orm import, drop `.unique()` from `slug`, add the three columns after `createdBy`, and give `pgTable` a third argument:

```ts
import { sql } from 'drizzle-orm';
import {
boolean, integer,   pgTable, text, timestamp, uniqueIndex,
uuid, } from 'drizzle-orm/pg-core';
```

```ts
export const clubs = pgTable('clubs', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull(),
  // …everything else unchanged…
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  // Who decided this club request, when, and why. `review_note` is required when
  // rejecting (enforced in `decideClubRequest`) and optional when approving.
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // Partial, not a plain UNIQUE: a rejected request must not hold its slug hostage,
  // or one spam request permanently burns a real club's name (spec §5.2).
  // The predicate lists the surviving statuses instead of `<> 'rejected'` because
  // `ALTER TYPE … ADD VALUE` and a use of that value cannot share a transaction, and
  // drizzle runs every pending migration in ONE transaction. `<> 'rejected'` passes on
  // a fresh DB and fails on an already-migrated one.
  uniqueIndex('clubs_slug_uq').on(t.slug).where(sql`${t.status} IN ('pending', 'active', 'suspended')`),
]);
```

- [ ] **Step 3: Generate the migration and inspect it by hand**

```bash
pnpm db:generate
```

Open the new `drizzle/0009_*.sql`. It must contain, in this order:

```sql
ALTER TYPE "public"."club_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'admin';--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "clubs" DROP CONSTRAINT "clubs_slug_unique";--> statement-breakpoint
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_slug_uq" ON "clubs" USING btree ("slug") WHERE "clubs"."status" IN ('pending', 'active', 'suspended');
```

If drizzle-kit omitted the `DROP CONSTRAINT` or the `WHERE` clause, add the missing line by hand — the file is generated but not yet applied, so editing it now is safe and expected. Do **not** merge the `ALTER TYPE` lines into another file.

- [ ] **Step 4: Apply to the already-migrated dev DB — this is the step that catches the enum trap**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/oarly_dev pnpm db:migrate
```

Expected: applies cleanly. If you see `unsafe use of new value … of enum type club_status`, the predicate is still using `'rejected'` — go back to Step 2. Running only against a freshly wiped DB would hide this.

- [ ] **Step 5: Commit the schema + migration**

```bash
git add src/db/schema/enums.ts src/db/schema/clubs.ts drizzle/
git commit -m "feat(db): add admin role, rejected club status, review columns, partial slug index"
```

- [ ] **Step 6: Export the transaction handle types**

`src/db/index.ts`, append after the existing exports:

```ts
export const db = drizzle(pool, { schema });
export type DB = typeof db;

/** The drizzle transaction handle — the first argument to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Anything that can run a statement. Helpers that must be callable both standalone
 * and inside a caller's transaction take this, so no call site needs
 * `tx as unknown as DB` — a cast that silently defeats the type system's only
 * check that an audit row lands in the same transaction as its mutation.
 */
export type DbOrTx = DB | Tx;
```

- [ ] **Step 7: Widen `logAudit` and delete the casts**

Replace `src/lib/audit.ts` entirely:

```ts
import type { DbOrTx } from '@/db';
import { auditLog } from '@/db/schema';

export type ActingAsRole = 'owner' | 'member' | 'admin';

export type AuditEntry = {
  actorUserId: string;
  clubId?: string;
  action: string;
  target?: string;
  actingAsRole?: ActingAsRole;
};

/**
 * Append one audit row. Takes `DbOrTx` so callers pass their own `tx` directly:
 * the row must commit with the mutation or not at all, and a mutation that
 * succeeded with no audit row is the exact failure an audit log exists to prevent.
 */
export async function logAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    clubId: entry.clubId ?? null,
    action: entry.action,
    target: entry.target ?? null,
    actingAsRole: entry.actingAsRole ?? null,
  });
}
```

In `src/lib/clubs-admin.ts`, change both call sites from `logAudit(tx as unknown as DB, …)` to `logAudit(tx, …)` and add `actingAsRole: 'admin'` to each (both are admin-driven; spec §4.1 explains this is why they were null):

```ts
await logAudit(tx, { actorUserId: input.createdBy, clubId: club.id, action: 'club.create', target: club.id, actingAsRole: 'admin' });
```

```ts
await logAudit(tx, {
  actorUserId: input.actorId,
  clubId: input.clubId,
  action: input.status === 'active' ? 'club.activate' : 'club.suspend',
  target: input.clubId,
  actingAsRole: 'admin',
});
```

- [ ] **Step 8: Verify no `as unknown as DB` remains**

```bash
grep -rn "as unknown as DB" src app
```

Expected: no output.

- [ ] **Step 9: Write the failing integration test for the §5.2 trap**

Append to `src/lib/tenant.integration.test.ts` (inside the existing `describe`), and add `findClubBySlug` to the import on line 9 — it will not exist yet, which is the point:

```ts
  it('resolves a live club whose slug was previously rejected, not the rejected row', async () => {
    const slug = `trap-${Date.now()}`;
    // A rejected request that once held this slug…
    await db.insert(schema.clubs).values({ slug, name: 'Rejected Squatter', status: 'rejected' });
    // …must not stop the real club from claiming it, and must never be resolved by it.
    await db.insert(schema.clubs).values({ slug, name: 'Real Club', status: 'active' });

    // Ten reads: an unordered `limit 1` can return either row, so a single read can
    // pass by luck. This loop makes the flake into a failure.
    for (let i = 0; i < 10; i++) {
      const found = await findClubBySlug(db, slug);
      expect(found?.name).toBe('Real Club');
    }
  });

  it('does not resolve a rejected club at all', async () => {
    const slug = `gone-${Date.now()}`;
    await db.insert(schema.clubs).values({ slug, name: 'Only Rejected', status: 'rejected' });
    expect(await findClubBySlug(db, slug)).toBeNull();
  });
```

- [ ] **Step 10: Run it and watch it fail**

```bash
pnpm test:integration -- src/lib/tenant.integration.test.ts
```

Expected: FAIL — `findClubBySlug is not a function` / no export named `findClubBySlug`.

- [ ] **Step 11: Implement the tenant lookup**

Replace lines 1-14 of `src/lib/tenant.ts`:

```ts
import { and, eq, ne } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { db as appDb, type DbOrTx } from '@/db';
import { clubs } from '@/db/schema';

export type Club = typeof clubs.$inferSelect;

/**
 * Look up a club by slug, EXCLUDING rejected rows.
 *
 * The exclusion is not cosmetic. `clubs_slug_uq` is partial — it exempts rejected
 * rows so a rejected request cannot burn a real club's name (spec §5.2) — which
 * means a rejected `bogazici` and a live `bogazici` legitimately coexist. Without
 * this filter, `limit 1` with no `order by` would return either one at the planner's
 * discretion and intermittently 404 a live club. Invariant: a rejected club is not
 * addressable by slug.
 *
 * Takes a handle so integration tests can exercise it against the test database;
 * `getClubBySlug` is the request-memoized app-wide entry point.
 */
export async function findClubBySlug(db: DbOrTx, slug: string): Promise<Club | null> {
  const [club] = await db
    .select()
    .from(clubs)
    .where(and(eq(clubs.slug, slug), ne(clubs.status, 'rejected')))
    .limit(1);
  return club ?? null;
}

/** Look up a club by slug, memoized per request. */
export const getClubBySlug = cache(async (slug: string): Promise<Club | null> => findClubBySlug(appDb, slug));
```

Leave the `getTenantSlug` note and `requireClub` below untouched.

- [ ] **Step 12: Fix both slug pre-checks so a rejected slug is genuinely free**

`src/lib/clubs-admin.ts` — add `ne` to the drizzle-orm import and change the duplicate check:

```ts
import { and, eq, ne } from 'drizzle-orm';
```

```ts
  // `ne(status, 'rejected')` mirrors the partial index `clubs_slug_uq`: a rejected
  // request no longer holds its slug, so it must not report `slug_taken` either.
  const [existing] = await db.select({ id: clubs.id }).from(clubs)
    .where(and(eq(clubs.slug, input.slug), ne(clubs.status, 'rejected'))).limit(1);
  if (existing) return { ok: false, error: 'slug_taken' };
```

`src/lib/club-request.ts` — identical change on line 13:

```ts
import { and, eq, ne } from 'drizzle-orm';
```

```ts
  const [existing] = await db.select({ id: clubs.id }).from(clubs)
    .where(and(eq(clubs.slug, input.slug), ne(clubs.status, 'rejected'))).limit(1);
  if (existing) return { ok: false, error: 'slug_taken' };
```

- [ ] **Step 13: Add the "rejecting frees the slug" integration test**

Append to `src/lib/club-request.integration.test.ts` inside its existing `describe` (keep that file's own bootstrap — do not add a second one):

```ts
  it('lets a new request take a slug that a rejected club still holds', async () => {
    const owner = await mkUser();
    const slug = `freed-${Date.now()}`;
    await db.insert(schema.clubs).values({ slug, name: 'Spam', status: 'rejected' });
    const res = await requestClub(db, { name: 'Real', slug, ownerId: owner.id });
    expect(res).toMatchObject({ ok: true });
  });
```

If that file's helper for creating a user is named something other than `mkUser`, use its name; do not introduce a second helper.

- [ ] **Step 14: Run the tests to verify they pass**

```bash
pnpm test:integration -- src/lib/tenant.integration.test.ts src/lib/club-request.integration.test.ts src/lib/clubs-admin.integration.test.ts
```

Expected: PASS. (`clubs-admin` is included because Step 7 touched it.)

- [ ] **Step 15: Prove the tests fail when the implementation is reverted**

The mutation the tests must detect: **`findClubBySlug` losing its status filter.**

Temporarily change the `where` in `src/lib/tenant.ts` back to `eq(clubs.slug, slug)` alone and re-run:

```bash
pnpm test:integration -- src/lib/tenant.integration.test.ts
```

Expected: FAIL on `does not resolve a rejected club at all` (returns the rejected row instead of `null`). Restore the `and(…, ne(…))`.

Second mutation: **the slug pre-check losing its `ne`.** Revert the `club-request.ts` change and re-run `src/lib/club-request.integration.test.ts` — expected FAIL with `{ ok: false, error: 'slug_taken' }`. Restore it.

- [ ] **Step 16: Full verification and commit**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm vitest run && pnpm test:integration
```

```bash
git add src/db/index.ts src/lib/audit.ts src/lib/clubs-admin.ts src/lib/club-request.ts src/lib/tenant.ts src/lib/tenant.integration.test.ts src/lib/club-request.integration.test.ts
git commit -m "feat(audit): accept a transaction in logAudit; exclude rejected clubs from slug lookups"
```

---

### Task 2: `decideClubRequest`, and `setClubStatus` restricted to `active ↔ suspended`

**Files:**
- Modify: `src/lib/clubs-admin.ts` (add `decideClubRequest`, rewrite `setClubStatus`)
- Modify: `app/admin/actions.ts:8-25` (adapt to the new return type)
- Test: `src/lib/clubs-admin.integration.test.ts`

**Interfaces:**
- Consumes: `logAudit(db: DbOrTx, entry)` and `DbOrTx` from Task 1; `clubs.reviewedAt/reviewedBy/reviewNote`; `clubStatusEnum` value `'rejected'`.
- Produces:
  ```ts
  export type DecideClubRequestResult =
    | { ok: true; status: 'active' | 'rejected'; requesterId: string | null; clubName: string; clubSlug: string }
    | { ok: false; error: 'not_found' | 'not_pending' | 'note_required' };

  export function decideClubRequest(
    db: DB,
    input: { clubId: string; decision: 'approve' | 'reject'; note: string | null; actorId: string },
  ): Promise<DecideClubRequestResult>;

  export type SetClubStatusResult =
    | { ok: true; status: 'active' | 'suspended' }
    | { ok: false; error: 'not_found' | 'not_decided' };

  export function setClubStatus(
    db: DB,
    input: { clubId: string; status: 'active' | 'suspended'; actorId: string },
  ): Promise<SetClubStatusResult>;
  ```
  Task 3 consumes `requesterId` / `clubName` / `clubSlug` off the success branch; Task 9 renders both.

**Why the two verbs are separated (spec §5.3):** approving a request and un-suspending a club are today literally the same component with the same `targetStatus="active"`, so the audit trail cannot tell a brand-new club from a reinstated one. Splitting them at the library level is what makes it impossible for the UI to reunite them.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/clubs-admin.integration.test.ts`, importing `decideClubRequest` alongside the existing imports on line 9:

```ts
  it('approves a pending club: status active, review stamped, club.approve audited', async () => {
    const admin = await mkUser();
    const requester = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `ap-${Date.now()}`, name: 'Ap', status: 'pending', createdBy: requester.id }).returning();

    const res = await decideClubRequest(db, { clubId: club.id, decision: 'approve', note: null, actorId: admin.id });
    expect(res).toMatchObject({ ok: true, status: 'active', requesterId: requester.id, clubName: 'Ap' });

    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(after.status).toBe('active');
    expect(after.reviewedBy).toBe(admin.id);
    expect(after.reviewedAt).not.toBeNull();

    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    expect(audit.map((a) => a.action)).toContain('club.approve');
    expect(audit.find((a) => a.action === 'club.approve')?.actingAsRole).toBe('admin');
  });

  it('rejects a pending club and stores the note', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `rj-${Date.now()}`, name: 'Rj', status: 'pending' }).returning();

    const res = await decideClubRequest(db, { clubId: club.id, decision: 'reject', note: '  Duplicate of an existing club  ', actorId: admin.id });
    expect(res).toMatchObject({ ok: true, status: 'rejected' });

    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(after.status).toBe('rejected');
    expect(after.reviewNote).toBe('Duplicate of an existing club');

    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    expect(audit.map((a) => a.action)).toContain('club.reject');
  });

  it('refuses to reject without a note, and does not touch the row', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `nn-${Date.now()}`, name: 'Nn', status: 'pending' }).returning();

    expect(await decideClubRequest(db, { clubId: club.id, decision: 'reject', note: '   ', actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'note_required' });

    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(after.status).toBe('pending');
  });

  it('refuses to decide a club that is not pending', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `np-${Date.now()}`, name: 'Np', status: 'active' }).returning();
    expect(await decideClubRequest(db, { clubId: club.id, decision: 'approve', note: null, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_pending' });
  });

  it('setClubStatus refuses a pending club and refuses a rejected club', async () => {
    const admin = await mkUser();
    const [pendingClub] = await db.insert(schema.clubs)
      .values({ slug: `sp-${Date.now()}`, name: 'Sp', status: 'pending' }).returning();
    expect(await setClubStatus(db, { clubId: pendingClub.id, status: 'active', actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_decided' });
    const [stillPending] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, pendingClub.id));
    expect(stillPending.status).toBe('pending');

    const [rejectedClub] = await db.insert(schema.clubs)
      .values({ slug: `sr-${Date.now()}`, name: 'Sr', status: 'rejected' }).returning();
    expect(await setClubStatus(db, { clubId: rejectedClub.id, status: 'active', actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_decided' });
  });

  it('setClubStatus suspends and reinstates an active club, auditing each way', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `ss-${Date.now()}`, name: 'Ss', status: 'active' }).returning();

    expect(await setClubStatus(db, { clubId: club.id, status: 'suspended', actorId: admin.id })).toMatchObject({ ok: true });
    const [suspended] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(suspended.status).toBe('suspended');

    expect(await setClubStatus(db, { clubId: club.id, status: 'active', actorId: admin.id })).toMatchObject({ ok: true });
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    expect(audit.map((a) => a.action).sort()).toEqual(['club.activate', 'club.suspend']);
  });
```

Then **delete the old `setClubStatus flips status and audits` test** (lines 56-64): it starts from a `pending` club and asserts the transition this task deliberately forbids. The two tests above replace it.

- [ ] **Step 2: Run and confirm they fail**

```bash
pnpm test:integration -- src/lib/clubs-admin.integration.test.ts
```

Expected: FAIL — `decideClubRequest` is not exported, and `setClubStatus` returns `undefined` so `toMatchObject` fails.

- [ ] **Step 3: Implement `decideClubRequest`**

Append to `src/lib/clubs-admin.ts`:

```ts
export type DecideClubRequestResult =
  | { ok: true; status: 'active' | 'rejected'; requesterId: string | null; clubName: string; clubSlug: string }
  | { ok: false; error: 'not_found' | 'not_pending' | 'note_required' };

/**
 * Decide a club REQUEST. Valid only on a row that is currently `pending`.
 *
 * Deliberately not `setClubStatus`: approving a new club and reinstating a
 * suspended one were indistinguishable to the audit trail when they shared one
 * function (spec §5.3). The note is required when rejecting so the requester's
 * email can say why, and optional when approving.
 *
 * Returns the requester and club identity on success so the caller can send the
 * decision email AFTER the transaction commits — mail is best-effort and must
 * never roll back the decision (spec §5.4).
 */
export async function decideClubRequest(
  db: DB,
  input: { clubId: string; decision: 'approve' | 'reject'; note: string | null; actorId: string },
): Promise<DecideClubRequestResult> {
  const note = input.note?.trim() ? input.note.trim() : null;
  if (input.decision === 'reject' && !note) return { ok: false, error: 'note_required' };

  return db.transaction(async (tx) => {
    const [club] = await tx
      .select({ id: clubs.id, status: clubs.status, name: clubs.name, slug: clubs.slug, createdBy: clubs.createdBy })
      .from(clubs)
      .where(eq(clubs.id, input.clubId))
      .limit(1);
    if (!club) return { ok: false, error: 'not_found' };
    if (club.status !== 'pending') return { ok: false, error: 'not_pending' };

    const status = input.decision === 'approve' ? ('active' as const) : ('rejected' as const);
    await tx.update(clubs)
      .set({ status, reviewedAt: new Date(), reviewedBy: input.actorId, reviewNote: note })
      .where(eq(clubs.id, club.id));
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: club.id,
      action: input.decision === 'approve' ? 'club.approve' : 'club.reject',
      target: club.id,
      actingAsRole: 'admin',
    });
    return { ok: true, status, requesterId: club.createdBy, clubName: club.name, clubSlug: club.slug };
  });
}
```

- [ ] **Step 4: Rewrite `setClubStatus` to refuse `pending` and `rejected`**

Replace the existing `setClubStatus` in `src/lib/clubs-admin.ts`:

```ts
export type SetClubStatusResult =
  | { ok: true; status: 'active' | 'suspended' }
  | { ok: false; error: 'not_found' | 'not_decided' };

/**
 * Suspend or reinstate an ALREADY-DECIDED club. `pending` and `rejected` are
 * unreachable through here: a request is decided by `decideClubRequest`, and a
 * rejection is final. Reaching either through this function is a typed error,
 * not a silent write — that refusal is what stops the requests queue and the
 * clubs list from sharing one control again (spec §5.3).
 */
export async function setClubStatus(
  db: DB,
  input: { clubId: string; status: 'active' | 'suspended'; actorId: string },
): Promise<SetClubStatusResult> {
  return db.transaction(async (tx) => {
    const [club] = await tx.select({ id: clubs.id, status: clubs.status })
      .from(clubs).where(eq(clubs.id, input.clubId)).limit(1);
    if (!club) return { ok: false, error: 'not_found' };
    if (club.status !== 'active' && club.status !== 'suspended') return { ok: false, error: 'not_decided' };

    await tx.update(clubs).set({ status: input.status }).where(eq(clubs.id, input.clubId));
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: input.status === 'active' ? 'club.activate' : 'club.suspend',
      target: input.clubId,
      actingAsRole: 'admin',
    });
    return { ok: true, status: input.status };
  });
}
```

- [ ] **Step 5: Adapt the existing admin action to the new return type**

Replace `app/admin/actions.ts` lines 8-25:

```ts
export type SetClubStatusState = { ok: boolean; status?: 'active' | 'suspended'; error?: 'not_decided' | 'failed' };

export async function setClubStatusAction(
  _prev: SetClubStatusState | null,
  formData: FormData,
): Promise<SetClubStatusState> {
  const admin = await requireAdmin();
  const clubId = String(formData.get('clubId'));
  const status = String(formData.get('status')) === 'active' ? 'active' : 'suspended';
  let res;
  try {
    res = await setClubStatus(db, { clubId, status, actorId: admin.id });
  } catch {
    return { ok: false, error: 'failed' };
  }
  if (!res.ok) return { ok: false, error: res.error === 'not_decided' ? 'not_decided' : 'failed' };
  revalidatePath('/admin');
  revalidatePath(`/admin/clubs/${clubId}`);
  return { ok: true, status: res.status };
}
```

Note `revalidatePath('/admin/requests')` is dropped: this action can no longer affect that page.

- [ ] **Step 6: Surface the new error in the client control**

`app/admin/club-status-button.tsx`, inside `handleSubmit`, replace the result handling:

```ts
    const result = await setClubStatusAction(null, formData);
    if (result.ok) {
      toast.success(result.status === 'active' ? t('activated') : t('suspended2'));
    } else if (result.error === 'not_decided') {
      toast.error(t('errorNotDecided'));
    } else {
      toast.error(t('actionError'));
    }
```

Add the key to **both** message files under `admin`:

```json
"errorNotDecided": "Only an approved club can be suspended or reinstated."
```

```json
"errorNotDecided": "Yalnızca onaylanmış bir kulüp askıya alınabilir veya yeniden etkinleştirilebilir."
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm test:integration -- src/lib/clubs-admin.integration.test.ts
```

Expected: PASS, all six.

- [ ] **Step 8: Prove the tests fail when the implementation is reverted**

Mutation 1 — **the pending/rejected guard removed from `setClubStatus`.** Delete the `if (club.status !== 'active' && club.status !== 'suspended')` line and re-run. Expected: FAIL on `setClubStatus refuses a pending club and refuses a rejected club` (the club becomes `active`, and the result is `{ ok: true }`). Restore.

Mutation 2 — **the note requirement removed.** Delete the `if (input.decision === 'reject' && !note)` line and re-run. Expected: FAIL on `refuses to reject without a note` (status becomes `rejected`). Restore.

Mutation 3 — **`club.approve` swapped for `club.activate`.** Change the action string in `decideClubRequest` and re-run. Expected: FAIL on `approves a pending club` (`toContain('club.approve')`). Restore.

- [ ] **Step 9: Verify and commit**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm vitest run && pnpm test:integration
```

```bash
git add src/lib/clubs-admin.ts src/lib/clubs-admin.integration.test.ts app/admin/actions.ts app/admin/club-status-button.tsx messages/en.json messages/tr.json
git commit -m "feat(admin): add decideClubRequest and restrict setClubStatus to active/suspended"
```

---

### Task 3: Approve / reject email to the requester

**Files:**
- Create: `src/emails/club-decision.tsx`
- Modify: `src/emails/index.ts` (add `renderClubDecision`)
- Modify: `src/lib/notify.ts` (add `notifyClubDecision`)
- Modify: `messages/en.json`, `messages/tr.json` (`emails.clubApproved`, `emails.clubRejected`)
- Test: `src/lib/notify.integration.test.ts`, `src/emails/club-decision.test.ts` (new)

**Interfaces:**
- Consumes: `decideClubRequest`'s success branch (`requesterId`, `clubName`, `clubSlug`) from Task 2; `sendEmail` from `src/lib/email.ts`; `clubUrl` / `parseAppOrigin` from `src/lib/urls.ts`.
- Produces:
  ```ts
  // src/emails/club-decision.tsx
  export type ClubDecisionProps = { heading: string; intro: string; noteLabel: string; note: string | null; button: string | null; url: string | null; locale: string };
  export function ClubDecisionEmail(props: ClubDecisionProps): React.ReactElement;

  // src/emails/index.ts
  export function renderClubDecision(
    locale: string,
    data: { clubName: string; decision: 'approved' | 'rejected'; note: string | null; url: string | null },
  ): Promise<RenderedEmail>;

  // src/lib/notify.ts
  export function notifyClubDecision(
    db: DB,
    input: { clubId: string; decision: 'approved' | 'rejected'; note: string | null },
  ): Promise<void>;  // never throws
  ```
  Task 9's `decideClubRequestAction` calls `notifyClubDecision` **after** `decideClubRequest` has returned, i.e. after the transaction has committed.

**Why post-commit and swallowed (spec §5.4):** today a requester submits and never learns the outcome. But a Resend outage must not undo an approval. `notifyClubDecision` follows the shape every other notifier in `src/lib/notify.ts` already uses: a `try { … } catch (err) { console.error(…) }` wrapper that returns `void` and cannot throw.

- [ ] **Step 1: Add the message keys to both files**

`messages/en.json`, under `emails`:

```json
"clubApproved": {
  "subject": "Oarly — Your club request was approved",
  "heading": "{clubName} is live",
  "intro": "Your club request was approved. Your club page is ready and you can start setting up boats, schedule and members.",
  "noteLabel": "Note from the reviewer",
  "button": "Open my club"
},
"clubRejected": {
  "subject": "Oarly — Your club request was declined",
  "heading": "Your request for {clubName} was declined",
  "intro": "We could not approve this club request. The reason is below. You're welcome to submit a new request once it's addressed.",
  "noteLabel": "Reason"
}
```

`messages/tr.json`, under `emails`:

```json
"clubApproved": {
  "subject": "Oarly — Kulüp isteğin onaylandı",
  "heading": "{clubName} yayında",
  "intro": "Kulüp isteğin onaylandı. Kulüp sayfan hazır; tekneleri, programı ve üyeleri şimdi ayarlayabilirsin.",
  "noteLabel": "İnceleyenin notu",
  "button": "Kulübümü aç"
},
"clubRejected": {
  "subject": "Oarly — Kulüp isteğin reddedildi",
  "heading": "{clubName} isteğin reddedildi",
  "intro": "Bu kulüp isteğini onaylayamadık. Gerekçe aşağıda. Gerekli düzeltmeyi yaptıktan sonra yeni bir istek gönderebilirsin.",
  "noteLabel": "Gerekçe"
}
```

- [ ] **Step 2: Write the failing render test**

Create `src/emails/club-decision.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { renderClubDecision } from './index';

describe('renderClubDecision', () => {
  it('renders the approval notice with the club name and a link', async () => {
    const email = await renderClubDecision('en', {
      clubName: 'Boğaziçi Kürek',
      decision: 'approved',
      note: null,
      url: 'https://bogazici.oarly.test',
    });
    expect(email.subject).toBe('Oarly — Your club request was approved');
    expect(email.html).toContain('Boğaziçi Kürek');
    expect(email.html).toContain('https://bogazici.oarly.test');
  });

  it('renders the rejection notice and carries the note verbatim', async () => {
    const email = await renderClubDecision('en', {
      clubName: 'Spam Club',
      decision: 'rejected',
      note: 'Duplicate of an existing club',
      url: null,
    });
    expect(email.subject).toBe('Oarly — Your club request was declined');
    expect(email.text).toContain('Duplicate of an existing club');
    expect(email.html).not.toContain('Open my club');
  });

  it('falls back to Turkish for an unknown locale', async () => {
    const email = await renderClubDecision('de', { clubName: 'X', decision: 'rejected', note: 'neden', url: null });
    expect(email.subject).toBe('Oarly — Kulüp isteğin reddedildi');
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

```bash
pnpm vitest run src/emails/club-decision.test.ts
```

Expected: FAIL — `renderClubDecision` is not exported from `src/emails/index.ts`.

- [ ] **Step 4: Create the template**

`src/emails/club-decision.tsx`:

```tsx
import { Button, Heading, Text } from 'react-email';

import { EmailLayout } from './layout';

export type ClubDecisionProps = {
  heading: string;
  intro: string;
  noteLabel: string;
  note: string | null;
  button: string | null;
  url: string | null;
  locale: string;
};

/**
 * Approve / reject notice for a club request. Takes already-translated strings,
 * matching every other template in this folder — the template stays i18n-agnostic
 * and `renderClubDecision` owns the message keys.
 */
export function ClubDecisionEmail({ heading, intro, noteLabel, note, button, url, locale }: ClubDecisionProps) {
  return (
    <EmailLayout preview={heading} locale={locale}>
      <Heading style={headingStyle}>{heading}</Heading>
      <Text style={textStyle}>{intro}</Text>
      {note ? (
        <Text style={noteStyle}>
          <strong>{noteLabel}:</strong> {note}
        </Text>
      ) : null}
      {button && url ? (
        <Button href={url} style={buttonStyle}>{button}</Button>
      ) : null}
    </EmailLayout>
  );
}

export default ClubDecisionEmail;

const headingStyle = { fontSize: '20px', fontWeight: 'bold' as const, color: '#18181b', margin: '0 0 16px' };
const textStyle = { fontSize: '14px', lineHeight: '22px', color: '#3f3f46', margin: '0 0 16px' };
const noteStyle = { fontSize: '14px', lineHeight: '22px', color: '#18181b', margin: '0 0 16px' };
const buttonStyle = { backgroundColor: '#18181b', borderRadius: '6px', color: '#ffffff', display: 'inline-block', fontSize: '14px', fontWeight: 'bold' as const, padding: '12px 20px', textDecoration: 'none' };
```

If `Button` is not exported from `react-email` at this version, check `src/emails/verify-email.tsx` for how it renders its call-to-action and copy that import.

- [ ] **Step 5: Add the renderer**

Append to `src/emails/index.ts`, and add `ClubDecisionEmail` to the imports at the top:

```ts
import { ClubDecisionEmail } from './club-decision';
```

```ts
export async function renderClubDecision(
  locale: string,
  data: { clubName: string; decision: 'approved' | 'rejected'; note: string | null; url: string | null },
): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  const ns = data.decision === 'approved' ? 'clubApproved' : 'clubRejected';
  const approved = data.decision === 'approved';
  const element = ClubDecisionEmail({
    heading: t(`${ns}.heading`, { clubName: data.clubName }),
    intro: t(`${ns}.intro`),
    noteLabel: t(`${ns}.noteLabel`),
    note: data.note,
    button: approved ? t('clubApproved.button') : null,
    url: approved ? data.url : null,
    locale: validLocale,
  });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: t(`${ns}.subject`), html, text };
}
```

If next-intl's `createTranslator` rejects the template-literal key (it types keys against the message shape), write the two branches out explicitly rather than fighting the types:

```ts
  const subject = approved ? t('clubApproved.subject') : t('clubRejected.subject');
  const heading = approved ? t('clubApproved.heading', { clubName: data.clubName }) : t('clubRejected.heading', { clubName: data.clubName });
  const intro = approved ? t('clubApproved.intro') : t('clubRejected.intro');
  const noteLabel = approved ? t('clubApproved.noteLabel') : t('clubRejected.noteLabel');
```

- [ ] **Step 6: Run the render test to verify it passes**

```bash
pnpm vitest run src/emails/club-decision.test.ts
```

Expected: PASS, all three.

- [ ] **Step 7: Write the failing notifier test**

Append to `src/lib/notify.integration.test.ts` inside its existing `describe` (reuse that file's bootstrap and user helper):

```ts
  it('sends the decision notice to the club requester and never throws', async () => {
    const requester = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `nd-${Date.now()}`, name: 'Notify Club', status: 'rejected', createdBy: requester.id }).returning();
    await expect(notifyClubDecision(db, { clubId: club.id, decision: 'rejected', note: 'because' })).resolves.toBeUndefined();
  });

  it('is a no-op when the club has no requester on record', async () => {
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `nr-${Date.now()}`, name: 'Orphan', status: 'active', createdBy: null }).returning();
    await expect(notifyClubDecision(db, { clubId: club.id, decision: 'approved', note: null })).resolves.toBeUndefined();
  });
```

Import `notifyClubDecision` from `./notify`.

- [ ] **Step 8: Run and confirm it fails**

```bash
pnpm test:integration -- src/lib/notify.integration.test.ts
```

Expected: FAIL — `notifyClubDecision is not a function`.

- [ ] **Step 9: Implement the notifier**

Append to `src/lib/notify.ts`, extending the top-of-file imports with `renderClubDecision`, `clubs`, `env`, `apexUrl`/`clubUrl`/`parseAppOrigin`:

```ts
/**
 * Best-effort: tells the requester their club request was approved or rejected.
 * Never throws — call it AFTER `decideClubRequest` has committed, so a mail
 * outage cannot roll back the decision (spec §5.4). `created_by` is
 * `on delete set null`, so a requester whose account is gone is simply skipped;
 * the decision itself stands.
 */
export async function notifyClubDecision(
  db: DB,
  { clubId, decision, note }: { clubId: string; decision: 'approved' | 'rejected'; note: string | null },
): Promise<void> {
  try {
    const [row] = await db
      .select({ toEmail: user.email, locale: user.locale, clubName: clubs.name, slug: clubs.slug })
      .from(clubs)
      .innerJoin(user, eq(user.id, clubs.createdBy))
      .where(eq(clubs.id, clubId))
      .limit(1);
    if (!row) return;
    const url = decision === 'approved' ? clubUrl(row.slug, parseAppOrigin(env.APP_URL)) : null;
    const email = await renderClubDecision(row.locale, { clubName: row.clubName, decision, note, url });
    await sendEmail({ to: row.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyClubDecision failed', err);
  }
}
```

- [ ] **Step 10: Run the notifier test to verify it passes**

```bash
pnpm test:integration -- src/lib/notify.integration.test.ts
```

Expected: PASS. (`RESEND_API_KEY` is unset under vitest, so `sendEmail` logs `[email:dev]` instead of calling Resend.)

- [ ] **Step 11: Prove the tests fail when the implementation is reverted**

Mutation 1 — **the note dropped from the rejection email.** Change `note: data.note` to `note: null` in `renderClubDecision` and re-run `src/emails/club-decision.test.ts`. Expected: FAIL on `carries the note verbatim`. Restore.

Mutation 2 — **the swallow removed.** Replace `notifyClubDecision`'s `catch` body with `throw err` and change the `innerJoin` to a deliberately broken column so it throws; re-run `src/lib/notify.integration.test.ts`. Expected: FAIL on `never throws` (the promise rejects instead of resolving). Restore both.

- [ ] **Step 12: Verify and commit**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm vitest run && pnpm test:integration
```

```bash
git add src/emails/ src/lib/notify.ts src/lib/notify.integration.test.ts messages/en.json messages/tr.json
git commit -m "feat(email): notify the requester when a club request is approved or rejected"
```

---

### Task 4: Audit coverage group A — membership decisions, attendance, owner booking actions

**Files:**
- Modify: `src/lib/members-admin.ts` (both functions)
- Modify: `src/lib/attendance.ts` (`markNoShow` / `markNoShowTx`, `undoNoShow` / `undoNoShowTx`)
- Modify: `src/lib/booking.ts` (`ownerRemoveBooking`, `ownerAddBooking`)
- Modify: `app/s/[slug]/manage/members/actions.ts` (3 actions)
- Modify: `app/s/[slug]/manage/bookings/attendance-actions.ts` (2 actions)
- Modify: `app/s/[slug]/manage/bookings/actions.ts` (2 actions)
- Test: `src/lib/members-admin.integration.test.ts`, `src/lib/attendance.integration.test.ts`, `src/lib/booking.integration.test.ts`

**Interfaces:**
- Consumes: `logAudit(db: DbOrTx, entry)` from Task 1.
- Produces (each is the existing function with one added input field; return types are unchanged):
  ```ts
  setMembershipStatus(db: DB, input: { membershipId: string; clubId: string; status: 'approved' | 'rejected'; actorId: string }): Promise<boolean>
  assignSkillLevel(db: DB, input: { membershipId: string; clubId: string; skillLevelId: string | null; actorId: string }): Promise<boolean>
  markNoShow(db: DB, input: { clubId: string; bookingId: string; actorId: string; now?: Date }): Promise<MarkNoShowResult>
  undoNoShow(db: DB, input: { clubId: string; bookingId: string; actorId: string }): Promise<UndoNoShowResult>
  ownerRemoveBooking(db: DB, input: { clubId: string; bookingId: string; actorId: string }): Promise<OwnerRemoveResult>
  ownerAddBooking(db: DB, input: OwnerAddInput & { actorId: string }): Promise<OwnerAddResult>
  ```
  `actorId` is **required**, not optional — an optional field would let a call site silently skip the audit row, which is the exact hole this cycle closes.

**The audit rule (spec §4.2), restated so it is applied rather than copied:** record every mutation an owner or admin performs *against another person, or against configuration that binds other people*. `bookSeat`, `cancelBooking` and `requestToJoin` are member self-service and stay unaudited. Everything in this task is an owner acting on someone else's membership, attendance record or seat.

**Log only on success.** Each function already returns `false` / `{ ok: false }` for a target that does not exist or is in the wrong state; the `logAudit` call goes after the mutation and only on the path that actually mutated. A log line for a no-op is noise that makes the log less trustworthy, not more.

**The atomicity probe used throughout this task and Task 5.** `audit_log.actor_user_id` is a foreign key onto `user.id`. Passing an `actorId` that does not exist makes the audit insert fail *inside* the transaction, which rolls the mutation back and rethrows. So a single test —

```ts
await expect(fn(db, { …, actorId: 'no-such-user' })).rejects.toThrow();
// then: assert the row is UNCHANGED
```

— fails in both directions the implementation can be wrong: if the audit call is missing, nothing throws and the `rejects` assertion fails; if the audit call is present but outside a transaction, the mutation commits and the "unchanged" assertion fails. That is stronger than asserting an audit row exists, which passes for a non-transactional implementation too. Do not replace it with a presence-only check.

- [ ] **Step 1: Write the failing tests for `members-admin`**

Append to `src/lib/members-admin.integration.test.ts` (reuse its existing bootstrap and fixture helpers; if it seeds a club + membership through a helper, call that helper rather than adding a second one):

```ts
  it('audits member.approve and member.reject with the acting owner', async () => {
    const owner = await mkUser();
    const { clubId, membershipId } = await mkPendingMembership();

    expect(await setMembershipStatus(db, { membershipId, clubId, status: 'approved', actorId: owner.id })).toBe(true);
    const approved = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(approved.map((a) => a.action)).toContain('member.approve');
    expect(approved[0].actingAsRole).toBe('owner');
    expect(approved[0].actorUserId).toBe(owner.id);
    expect(approved[0].clubId).toBe(clubId);

    expect(await setMembershipStatus(db, { membershipId, clubId, status: 'rejected', actorId: owner.id })).toBe(true);
    const both = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(both.map((a) => a.action).sort()).toEqual(['member.approve', 'member.reject']);
  });

  it('audits member.skill_assign', async () => {
    const owner = await mkUser();
    const { clubId, membershipId, skillLevelId } = await mkApprovedMembershipWithSkill();
    expect(await assignSkillLevel(db, { membershipId, clubId, skillLevelId, actorId: owner.id })).toBe(true);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(rows.map((a) => a.action)).toContain('member.skill_assign');
  });

  it('rolls the status change back when the audit insert fails', async () => {
    const { clubId, membershipId } = await mkPendingMembership();
    await expect(setMembershipStatus(db, { membershipId, clubId, status: 'approved', actorId: 'no-such-user' }))
      .rejects.toThrow();
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId));
    expect(after.status).toBe('pending');
  });

  it('writes no audit row for a membership that does not match the club', async () => {
    const owner = await mkUser();
    const { clubId } = await mkPendingMembership();
    const ghost = '00000000-0000-0000-0000-000000000000';
    expect(await setMembershipStatus(db, { membershipId: ghost, clubId, status: 'approved', actorId: owner.id })).toBe(false);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, ghost));
    expect(rows).toHaveLength(0);
  });
```

If `mkPendingMembership` / `mkApprovedMembershipWithSkill` do not exist in that file, write them at the top of the `describe` as small helpers that insert a user, a club, a membership (and a skill level) and return their ids — mirroring `mkUser` in `clubs-admin.integration.test.ts`.

- [ ] **Step 2: Run and confirm they fail**

```bash
pnpm test:integration -- src/lib/members-admin.integration.test.ts
```

Expected: FAIL — TypeScript rejects the extra `actorId` property, and no audit rows are written.

- [ ] **Step 3: Implement `members-admin`**

Replace `src/lib/members-admin.ts` entirely:

```ts
import { and, eq } from 'drizzle-orm';

import type { DB } from '@/db';
import { memberships, skillLevels } from '@/db/schema';
import { logAudit } from '@/lib/audit';

/**
 * Approve or reject a join request. Wrapped in a transaction purely so the audit
 * row commits with the decision: a membership decision that left no trace is the
 * failure the audit log exists to prevent, and a statement plus an insert is a
 * trivial transaction (spec §4.3).
 */
export async function setMembershipStatus(
  db: DB,
  input: { membershipId: string; clubId: string; status: 'approved' | 'rejected'; actorId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const res = await tx.update(memberships)
      .set({ status: input.status })
      .where(and(eq(memberships.id, input.membershipId), eq(memberships.clubId, input.clubId)))
      .returning({ id: memberships.id });
    if (res.length === 0) return false;
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: input.status === 'approved' ? 'member.approve' : 'member.reject',
      target: input.membershipId,
      actingAsRole: 'owner',
    });
    return true;
  });
}

export async function assignSkillLevel(
  db: DB,
  input: { membershipId: string; clubId: string; skillLevelId: string | null; actorId: string },
): Promise<boolean> {
  if (input.skillLevelId) {
    const [lvl] = await db.select({ id: skillLevels.id }).from(skillLevels)
      .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId))).limit(1);
    if (!lvl) return false;
  }
  return db.transaction(async (tx) => {
    const res = await tx.update(memberships)
      .set({ skillLevelId: input.skillLevelId })
      .where(and(
        eq(memberships.id, input.membershipId),
        eq(memberships.clubId, input.clubId),
        eq(memberships.status, 'approved'),
      ))
      .returning({ id: memberships.id });
    if (res.length === 0) return false;
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: 'member.skill_assign',
      target: input.membershipId,
      actingAsRole: 'owner',
    });
    return true;
  });
}
```

- [ ] **Step 4: Thread `actorId` through the members actions**

`app/s/[slug]/manage/members/actions.ts` — destructure `user` from `requireOwner` in all three actions and pass it:

```ts
export async function approveMemberAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club, user } = await requireOwner(slug);
  const ok = await setMembershipStatus(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, status: 'approved', actorId: user.id });
  revalidatePath(`/s/${slug}/manage/members`);
  return { ok };
}

export async function rejectMemberAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club, user } = await requireOwner(slug);
  const ok = await setMembershipStatus(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, status: 'rejected', actorId: user.id });
  revalidatePath(`/s/${slug}/manage/members`);
  return { ok };
}

export async function assignSkillAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club, user } = await requireOwner(slug);
  const raw = String(formData.get('skillLevelId') ?? '');
  const ok = await assignSkillLevel(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, skillLevelId: raw || null, actorId: user.id });
  revalidatePath(`/s/${slug}/manage/members`);
  return { ok };
}
```

- [ ] **Step 5: Run the members tests to verify they pass**

```bash
pnpm test:integration -- src/lib/members-admin.integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write the failing attendance tests**

Append to `src/lib/attendance.integration.test.ts`, reusing whatever fixture builder that file already has for "a club with a started session and a booked member" (do not build a second one):

```ts
  it('audits attendance.noshow and attendance.noshow_undo', async () => {
    const owner = await mkUser();
    const f = await seedStartedBooking();

    const marked = await markNoShow(db, { clubId: f.clubId, bookingId: f.bookingId, actorId: owner.id, now: f.afterStart });
    expect(marked.ok).toBe(true);
    const afterMark = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, f.bookingId));
    expect(afterMark.map((a) => a.action)).toContain('attendance.noshow');
    expect(afterMark[0].actingAsRole).toBe('owner');

    const undone = await undoNoShow(db, { clubId: f.clubId, bookingId: f.bookingId, actorId: owner.id });
    expect(undone.ok).toBe(true);
    const afterUndo = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, f.bookingId));
    expect(afterUndo.map((a) => a.action).sort()).toEqual(['attendance.noshow', 'attendance.noshow_undo']);
  });

  it('rolls the absence back when the audit insert fails', async () => {
    const f = await seedStartedBooking();
    await expect(markNoShow(db, { clubId: f.clubId, bookingId: f.bookingId, actorId: 'no-such-user', now: f.afterStart }))
      .rejects.toThrow();
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.bookingId));
    expect(booking.status).toBe('booked');
    const penalties = await db.select().from(schema.penalties).where(eq(schema.penalties.bookingId, f.bookingId));
    expect(penalties).toHaveLength(0);
  });

  it('writes no audit row when the booking was already marked', async () => {
    const owner = await mkUser();
    const f = await seedStartedBooking();
    await markNoShow(db, { clubId: f.clubId, bookingId: f.bookingId, actorId: owner.id, now: f.afterStart });
    const before = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, f.bookingId));
    expect(await markNoShow(db, { clubId: f.clubId, bookingId: f.bookingId, actorId: owner.id, now: f.afterStart }))
      .toMatchObject({ ok: false, error: 'already_marked' });
    const after = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, f.bookingId));
    expect(after).toHaveLength(before.length);
  });
```

- [ ] **Step 7: Run and confirm they fail**

```bash
pnpm test:integration -- src/lib/attendance.integration.test.ts
```

Expected: FAIL — `actorId` is not an accepted property.

- [ ] **Step 8: Implement the attendance audit**

`src/lib/attendance.ts`:

1. Add `import { logAudit } from '@/lib/audit';`.
2. Widen the two public signatures and pass `actorId` down to the `*Tx` helpers:

```ts
export async function markNoShow(
  db: DB,
  input: { clubId: string; bookingId: string; actorId: string; now?: Date },
): Promise<MarkNoShowResult> {
  const now = input.now ?? new Date();
  try {
    return await markNoShowTx(db, input, now);
  } catch (err) {
    if (isUniqueViolation(err, 'penalties_booking_uq')) return { ok: false, error: 'already_marked' };
    throw err;
  }
}

async function markNoShowTx(
  db: DB,
  input: { clubId: string; bookingId: string; actorId: string },
  now: Date,
): Promise<MarkNoShowResult> {
```

```ts
export async function undoNoShow(
  db: DB,
  input: { clubId: string; bookingId: string; actorId: string },
): Promise<UndoNoShowResult> {
```

```ts
async function undoNoShowTx(
  db: DB,
  input: { clubId: string; bookingId: string; actorId: string },
): Promise<UndoNoShowResult> {
```

3. In `markNoShowTx`, immediately before its `return { ok: true, bannedUntil: ban.bannedUntil, … }` line, add:

```ts
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: 'attendance.noshow',
      target: input.bookingId,
      actingAsRole: 'owner',
    });
```

4. In `undoNoShowTx`, immediately before its success `return`, add the same block with `action: 'attendance.noshow_undo'`.

Both go on the success path only — every early `return { ok: false, … }` above them leaves no audit row, which is what the "already marked" test asserts.

- [ ] **Step 9: Thread `actorId` through the attendance actions**

`app/s/[slug]/manage/bookings/attendance-actions.ts`:

```ts
  const { club, user } = await requireOwner(slug);
  // …
  const result = await markNoShow(db, { clubId: club.id, bookingId: parsed.data.bookingId, actorId: user.id });
```

```ts
  const { club, user } = await requireOwner(slug);
  // …
  const result = await undoNoShow(db, { clubId: club.id, bookingId: parsed.data.bookingId, actorId: user.id });
```

- [ ] **Step 10: Write the failing owner-booking tests**

Append to `src/lib/booking.integration.test.ts`, reusing its existing seeding helpers:

```ts
  it('audits booking.owner_remove', async () => {
    const owner = await mkUser();
    const f = await seedOwnerBooking();
    expect(await ownerRemoveBooking(db, { clubId: f.clubId, bookingId: f.bookingId, actorId: owner.id }))
      .toMatchObject({ ok: true });
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, f.bookingId));
    expect(rows.map((a) => a.action)).toContain('booking.owner_remove');
    expect(rows[0].actingAsRole).toBe('owner');
  });

  it('rolls the removal back when the audit insert fails', async () => {
    const f = await seedOwnerBooking();
    await expect(ownerRemoveBooking(db, { clubId: f.clubId, bookingId: f.bookingId, actorId: 'no-such-user' }))
      .rejects.toThrow();
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.bookingId));
    expect(booking.status).toBe('booked');
  });

  it('audits booking.owner_add against the created booking', async () => {
    const owner = await mkUser();
    const f = await seedOwnerAddContext();
    const res = await ownerAddBooking(db, { ...f.input, actorId: owner.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, res.bookingId));
    expect(rows.map((a) => a.action)).toContain('booking.owner_add');
  });
```

- [ ] **Step 11: Implement the owner-booking audit**

`src/lib/booking.ts` — add `import { logAudit } from '@/lib/audit';`, then:

`ownerRemoveBooking`: widen the input to `{ clubId: string; bookingId: string; actorId: string }` and insert the audit call after `applySeating`, before the return:

```ts
    const { promotedUserId } = await applySeating(tx, row.sessionId, row.capacity, row.multisportMode);
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: 'booking.owner_remove',
      target: input.bookingId,
      actingAsRole: 'owner',
    });
    return promotedUserId ? { ok: true, promoted: { userId: promotedUserId, sessionId: row.sessionId } } : { ok: true };
```

`ownerAddBooking`: change the type to `export type OwnerAddInput = { clubId: string; windowId: string; boatTypeId: string; startAt: Date; userId: string; paymentType: 'regular' | 'multisport'; actorId: string; now?: Date };` and add, immediately before the transaction's success `return { ok: true, bookingId: … }`:

```ts
      await logAudit(tx, {
        actorUserId: input.actorId,
        clubId: input.clubId,
        action: 'booking.owner_add',
        target: bookingId,
        actingAsRole: 'owner',
      });
```

using whatever local variable that function already holds the new booking id in — the `target` must be the booking id it returns, because the test looks the row up by it.

- [ ] **Step 12: Thread `actorId` through the bookings actions**

`app/s/[slug]/manage/bookings/actions.ts`:

```ts
  const { club, user } = await requireOwner(slug);
  // …
  const result = await ownerRemoveBooking(db, { clubId: club.id, bookingId: parsed.data.bookingId, actorId: user.id });
```

```ts
  const { club, user } = await requireOwner(slug);
  // …
  const result = await ownerAddBooking(db, {
    clubId: club.id,
    windowId: parsed.data.windowId,
    boatTypeId: parsed.data.boatTypeId,
    startAt: new Date(parsed.data.startAt),
    userId: parsed.data.userId,
    paymentType: parsed.data.paymentType,
    actorId: user.id,
  });
```

- [ ] **Step 13: Run all three suites to verify they pass**

```bash
pnpm test:integration -- src/lib/members-admin.integration.test.ts src/lib/attendance.integration.test.ts src/lib/booking.integration.test.ts
```

Expected: PASS.

- [ ] **Step 14: Prove the tests fail when the implementation is reverted**

Mutation 1 — **the transaction wrapper removed.** In `setMembershipStatus`, replace `return db.transaction(async (tx) => { … })` with the original non-transactional body plus a trailing `await logAudit(db, …)`. Re-run `members-admin`. Expected: FAIL on `rolls the status change back when the audit insert fails` — the status is `approved` because the update already committed. Restore.

Mutation 2 — **the audit call removed entirely.** Delete the `logAudit` call from `markNoShowTx` and re-run `attendance`. Expected: FAIL twice: `audits attendance.noshow…` (missing action) *and* `rolls the absence back…` (nothing throws, so `rejects.toThrow()` fails). Restore.

Mutation 3 — **logging moved off the success path.** In `setMembershipStatus`, move the `logAudit` call above the `if (res.length === 0) return false;` guard and re-run `members-admin`. Expected: FAIL on `writes no audit row for a membership that does not match the club`. Restore.

- [ ] **Step 15: Verify and commit**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm vitest run && pnpm test:integration
```

`tsc` is the safety net for the call sites: `actorId` being required means any caller you forgot is a compile error, not a silent gap.

```bash
git add src/lib/members-admin.ts src/lib/attendance.ts src/lib/booking.ts src/lib/*.integration.test.ts "app/s/[slug]/manage/members/actions.ts" "app/s/[slug]/manage/bookings/actions.ts" "app/s/[slug]/manage/bookings/attendance-actions.ts"
git commit -m "feat(audit): record membership decisions, attendance changes and owner booking actions"
```

---

### Task 5: Audit coverage group B — club configuration

**Files:**
- Modify: `src/lib/scheduling-settings.ts` (`updateSchedulingSettings`)
- Modify: `src/lib/club-profile.ts` (`updateClubProfile` only)
- Modify: `src/lib/boats.ts` (`createBoat`, `updateBoat`, `setBoatActive`)
- Modify: `src/lib/skill-levels.ts` (`createSkillLevel`, `renameSkillLevel`, `reorderSkillLevel`, `deleteSkillLevel`)
- Modify: `src/lib/schedule.ts` (`createWindow`, `updateWindow`, `deleteWindow`)
- Modify: `src/lib/date-overrides.ts` (`setDateOverride`, `clearDateOverride`)
- Modify: `app/s/[slug]/manage/policies/actions.ts`, `.../profile/actions.ts`, `.../boats/actions.ts`, `.../skill-levels/actions.ts`, `.../schedule/actions.ts`, `.../schedule/preview/actions.ts`
- Test: `src/lib/scheduling-settings.integration.test.ts`, `club-profile.integration.test.ts`, `boats.integration.test.ts`, `skill-levels.integration.test.ts`, `schedule.integration.test.ts`, `date-overrides.integration.test.ts`

**Interfaces:**
- Consumes: `logAudit(db: DbOrTx, entry)` from Task 1; the atomicity-probe pattern from Task 4.
- Produces (existing functions, one added required field each; return types unchanged):
  ```ts
  updateSchedulingSettings(db: DB, clubId: string, input: SchedulingSettingsInput, actorId: string): Promise<SchedulingResult>
  updateClubProfile(db: DB, clubId: string, input: ProfileInput, actorId: string): Promise<boolean>
  createBoat(db: DB, clubId: string, input: BoatInput, actorId: string): Promise<{ ok: true; id: string } | { ok: false; error: 'skill_not_in_club' }>
  updateBoat(db: DB, input: { clubId: string; boatId: string; actorId: string } & BoatInput): Promise<{ ok: true } | { ok: false; error: 'skill_not_in_club' | 'not_found' }>
  setBoatActive(db: DB, input: { clubId: string; boatId: string; active: boolean; actorId: string }): Promise<boolean>
  createSkillLevel(db: DB, input: { clubId: string; name: string; actorId: string }): Promise<SkillLevel>
  renameSkillLevel(db: DB, input: { clubId: string; skillLevelId: string; name: string; actorId: string }): Promise<boolean>
  reorderSkillLevel(db: DB, input: { clubId: string; skillLevelId: string; direction: 'up' | 'down'; actorId: string }): Promise<boolean>
  deleteSkillLevel(db: DB, input: { clubId: string; skillLevelId: string; actorId: string }): Promise<boolean>
  createWindow(db: DB, clubId: string, input: WindowInput, actorId: string): Promise<WindowResult>
  updateWindow(db: DB, input: { clubId: string; windowId: string; actorId: string } & WindowInput): Promise<WindowResult>
  deleteWindow(db: DB, input: { clubId: string; windowId: string; actorId: string }): Promise<boolean>
  setDateOverride(db: DB, clubId: string, input: { dateISO: string; isOpen: boolean }, actorId: string): Promise<boolean>
  clearDateOverride(db: DB, clubId: string, dateISO: string, actorId: string): Promise<boolean>
  ```
  The positional-vs-object shape of each `actorId` follows whatever that function already uses — functions taking `(db, clubId, input)` gain a fourth positional argument; functions taking `(db, input)` gain a field on `input`. Do not reshape signatures beyond that; the churn is not worth it.

**Which of these already have a transaction (spec §4.3):** `updateSchedulingSettings`, `createWindow`, `updateWindow` and `reorderSkillLevel` already open `db.transaction(...)` — put `logAudit(tx, …)` inside the existing block. `updateClubProfile`, `createBoat`, `updateBoat`, `setBoatActive`, `createSkillLevel`, `renameSkillLevel`, `deleteSkillLevel`, `deleteWindow`, `setDateOverride` and `clearDateOverride` are single statements today and **must be wrapped**. A statement plus an insert is a trivial transaction; the alternative is a config change that binds every member of the club with no record of who made it.

**`setClubLogo`, `addSocial` and `removeSocial` stay unaudited.** Spec §4.2 owns this call: they are cosmetic self-description carrying no authority over a person, and they would drown the log. Do not add them, and do not flag their absence in review.

- [ ] **Step 1: Write the failing tests, one file at a time**

For each of the six suites, add two tests using its own existing fixtures. The template, shown for `boats`:

```ts
  it('audits boat.create, boat.update and boat.set_active', async () => {
    const owner = await mkUser();
    const clubId = await mkClub();

    const created = await createBoat(db, clubId, { name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: 1 }, owner.id);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await updateBoat(db, { clubId, boatId: created.id, actorId: owner.id, name: 'Quad B', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: 1 });
    await setBoatActive(db, { clubId, boatId: created.id, active: false, actorId: owner.id });

    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, created.id));
    expect(rows.map((a) => a.action).sort()).toEqual(['boat.create', 'boat.set_active', 'boat.update']);
    expect(rows.every((a) => a.actingAsRole === 'owner' && a.actorUserId === owner.id && a.clubId === clubId)).toBe(true);
  });

  it('rolls the boat creation back when the audit insert fails', async () => {
    const clubId = await mkClub();
    const before = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.clubId, clubId));
    await expect(createBoat(db, clubId, { name: 'Ghost', seats: 2, minSkillLevelId: null, allowedPayment: 'both', minAttendance: 1 }, 'no-such-user'))
      .rejects.toThrow();
    const after = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.clubId, clubId));
    expect(after).toHaveLength(before.length);
  });
```

Repeat that shape with these action strings and targets — the `target` is the id of the thing changed, and for the two club-wide functions it is the club id:

| Suite | Positive assertion | Atomicity probe |
|---|---|---|
| `scheduling-settings` | one `club.policies_update` row with `target === clubId` | `updateSchedulingSettings(db, clubId, input, 'no-such-user')` rejects, and `clubs.noshowPenalty` is unchanged |
| `club-profile` | one `club.profile_update` row with `target === clubId` | `updateClubProfile(db, clubId, input, 'no-such-user')` rejects, and `clubs.name` is unchanged |
| `boats` | `boat.create` / `boat.update` / `boat.set_active` on the boat id | as written above |
| `skill-levels` | `skill_level.create` / `.rename` / `.reorder` / `.delete` on the skill-level id | `createSkillLevel(db, { clubId, name: 'X', actorId: 'no-such-user' })` rejects, and no row named `X` exists |
| `schedule` | `window.create` / `.update` / `.delete` on the window id | `deleteWindow(db, { clubId, windowId, actorId: 'no-such-user' })` rejects, and the window still exists |
| `date-overrides` | `date_override.set` / `.clear` with `target === dateISO` | `clearDateOverride(db, clubId, dateISO, 'no-such-user')` rejects, and the override row still exists |

For `skill_level.delete` the audit row must be written **before** the row disappears is irrelevant — the audit row references the id as free text, not a foreign key, so log after the delete returns, still inside the transaction.

- [ ] **Step 2: Run all six and confirm they fail**

```bash
pnpm test:integration -- src/lib/scheduling-settings.integration.test.ts src/lib/club-profile.integration.test.ts src/lib/boats.integration.test.ts src/lib/skill-levels.integration.test.ts src/lib/schedule.integration.test.ts src/lib/date-overrides.integration.test.ts
```

Expected: FAIL — the extra `actorId` argument is a type error and no audit rows are written.

- [ ] **Step 3: `scheduling-settings` — log inside the existing transaction**

`src/lib/scheduling-settings.ts`: add `import { logAudit } from '@/lib/audit';`, widen the signature, and add the call just before the transaction's `return { ok: true, convertedBoats }`:

```ts
export async function updateSchedulingSettings(
  db: DB,
  clubId: string,
  input: SchedulingSettingsInput,
  actorId: string,
): Promise<SchedulingResult> {
```

```ts
    await logAudit(tx, { actorUserId: actorId, clubId, action: 'club.policies_update', target: clubId, actingAsRole: 'owner' });
    return { ok: true, convertedBoats };
```

- [ ] **Step 4: `club-profile` — wrap and log**

```ts
import { logAudit } from '@/lib/audit';
```

```ts
/** Wrapped in a transaction so the audit row commits with the profile change (spec §4.3). */
export async function updateClubProfile(db: DB, clubId: string, input: ProfileInput, actorId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const res = await tx.update(clubs).set({
      name: input.name, tagline: input.tagline, description: input.description,
      phone: input.phone, brandAccent: input.brandAccent, headingFont: input.headingFont,
      logoUrl: input.logoUrl,
    }).where(eq(clubs.id, clubId)).returning({ id: clubs.id });
    if (res.length === 0) return false;
    await logAudit(tx, { actorUserId: actorId, clubId, action: 'club.profile_update', target: clubId, actingAsRole: 'owner' });
    return true;
  });
}
```

Leave `setClubLogo`, `addSocial`, `removeSocial` and `ownedClubId` untouched.

- [ ] **Step 5: `boats` — wrap all three and log**

```ts
import { logAudit } from '@/lib/audit';
```

```ts
export async function createBoat(db: DB, clubId: string, input: BoatInput, actorId: string): Promise<{ ok: true; id: string } | { ok: false; error: 'skill_not_in_club' }> {
  if (input.minSkillLevelId && !(await skillBelongsToClub(db, clubId, input.minSkillLevelId))) {
    return { ok: false, error: 'skill_not_in_club' };
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(boatTypes).values({
      clubId, name: input.name, seats: input.seats, minSkillLevelId: input.minSkillLevelId,
      allowedPayment: input.allowedPayment, minAttendance: input.minAttendance,
    }).returning({ id: boatTypes.id });
    await logAudit(tx, { actorUserId: actorId, clubId, action: 'boat.create', target: row.id, actingAsRole: 'owner' });
    return { ok: true, id: row.id };
  });
}

export async function updateBoat(db: DB, input: { clubId: string; boatId: string; actorId: string } & BoatInput): Promise<{ ok: true } | { ok: false; error: 'skill_not_in_club' | 'not_found' }> {
  if (input.minSkillLevelId && !(await skillBelongsToClub(db, input.clubId, input.minSkillLevelId))) {
    return { ok: false, error: 'skill_not_in_club' };
  }
  return db.transaction(async (tx) => {
    const res = await tx.update(boatTypes).set({
      name: input.name, seats: input.seats, minSkillLevelId: input.minSkillLevelId,
      allowedPayment: input.allowedPayment, minAttendance: input.minAttendance,
    }).where(and(eq(boatTypes.id, input.boatId), eq(boatTypes.clubId, input.clubId)))
      .returning({ id: boatTypes.id });
    if (res.length === 0) return { ok: false, error: 'not_found' };
    await logAudit(tx, { actorUserId: input.actorId, clubId: input.clubId, action: 'boat.update', target: input.boatId, actingAsRole: 'owner' });
    return { ok: true };
  });
}

export async function setBoatActive(db: DB, input: { clubId: string; boatId: string; active: boolean; actorId: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const res = await tx.update(boatTypes).set({ active: input.active })
      .where(and(eq(boatTypes.id, input.boatId), eq(boatTypes.clubId, input.clubId)))
      .returning({ id: boatTypes.id });
    if (res.length === 0) return false;
    await logAudit(tx, { actorUserId: input.actorId, clubId: input.clubId, action: 'boat.set_active', target: input.boatId, actingAsRole: 'owner' });
    return true;
  });
}
```

- [ ] **Step 6: `skill-levels` — wrap three, log inside the fourth**

```ts
import { logAudit } from '@/lib/audit';
```

```ts
export async function createSkillLevel(db: DB, input: { clubId: string; name: string; actorId: string }): Promise<SkillLevel> {
  return db.transaction(async (tx) => {
    const [agg] = await tx.select({ maxRank: sql<number | null>`max(${skillLevels.rank})` }).from(skillLevels).where(eq(skillLevels.clubId, input.clubId));
    const nextRank = (agg?.maxRank ?? 0) + 1;
    const [row] = await tx.insert(skillLevels).values({ clubId: input.clubId, name: input.name, rank: nextRank }).returning();
    await logAudit(tx, { actorUserId: input.actorId, clubId: input.clubId, action: 'skill_level.create', target: row.id, actingAsRole: 'owner' });
    return row;
  });
}

export async function renameSkillLevel(db: DB, input: { clubId: string; skillLevelId: string; name: string; actorId: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const res = await tx.update(skillLevels).set({ name: input.name })
      .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId)))
      .returning({ id: skillLevels.id });
    if (res.length === 0) return false;
    await logAudit(tx, { actorUserId: input.actorId, clubId: input.clubId, action: 'skill_level.rename', target: input.skillLevelId, actingAsRole: 'owner' });
    return true;
  });
}

export async function deleteSkillLevel(db: DB, input: { clubId: string; skillLevelId: string; actorId: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const res = await tx.delete(skillLevels)
      .where(and(eq(skillLevels.id, input.skillLevelId), eq(skillLevels.clubId, input.clubId)))
      .returning({ id: skillLevels.id });
    if (res.length === 0) return false;
    await logAudit(tx, { actorUserId: input.actorId, clubId: input.clubId, action: 'skill_level.delete', target: input.skillLevelId, actingAsRole: 'owner' });
    return true;
  });
}
```

`reorderSkillLevel` keeps its existing transaction and its sentinel-rank comment untouched — widen its input to include `actorId` and add, just before the final `return true;`:

```ts
    await logAudit(tx, { actorUserId: input.actorId, clubId: input.clubId, action: 'skill_level.reorder', target: input.skillLevelId, actingAsRole: 'owner' });
    return true;
```

- [ ] **Step 7: `schedule` — log in the two existing transactions, wrap the third**

```ts
import { logAudit } from '@/lib/audit';
```

In `createWindow` (signature becomes `(db: DB, clubId: string, input: WindowInput, actorId: string)`), before its `return { ok: true, id: w.id }`:

```ts
    await logAudit(tx, { actorUserId: actorId, clubId, action: 'window.create', target: w.id, actingAsRole: 'owner' });
```

In `updateWindow` (input gains `actorId: string`), before its `return { ok: true, id: input.windowId }`:

```ts
    await logAudit(tx, { actorUserId: input.actorId, clubId: input.clubId, action: 'window.update', target: input.windowId, actingAsRole: 'owner' });
```

`deleteWindow` gets wrapped:

```ts
export async function deleteWindow(db: DB, input: { clubId: string; windowId: string; actorId: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const res = await tx.delete(scheduleWindows)
      .where(and(eq(scheduleWindows.id, input.windowId), eq(scheduleWindows.clubId, input.clubId)))
      .returning({ id: scheduleWindows.id });
    if (res.length === 0) return false;
    await logAudit(tx, { actorUserId: input.actorId, clubId: input.clubId, action: 'window.delete', target: input.windowId, actingAsRole: 'owner' });
    return true;
  });
}
```

- [ ] **Step 8: `date-overrides` — wrap both**

```ts
import { logAudit } from '@/lib/audit';
```

```ts
export async function setDateOverride(
  db: DB,
  clubId: string,
  input: { dateISO: string; isOpen: boolean },
  actorId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .insert(clubHolidayOverrides)
      .values({ clubId, date: input.dateISO, isOpen: input.isOpen })
      .onConflictDoUpdate({
        target: [clubHolidayOverrides.clubId, clubHolidayOverrides.date],
        set: { isOpen: input.isOpen },
      });
    await logAudit(tx, { actorUserId: actorId, clubId, action: 'date_override.set', target: input.dateISO, actingAsRole: 'owner' });
    return true;
  });
}

export async function clearDateOverride(db: DB, clubId: string, dateISO: string, actorId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(clubHolidayOverrides)
      .where(and(eq(clubHolidayOverrides.clubId, clubId), eq(clubHolidayOverrides.date, dateISO)))
      .returning({ id: clubHolidayOverrides.id });
    if (removed.length === 0) return false;
    await logAudit(tx, { actorUserId: actorId, clubId, action: 'date_override.clear', target: dateISO, actingAsRole: 'owner' });
    return true;
  });
}
```

- [ ] **Step 9: Thread `actorId` through all six action modules**

In each, change `const { club } = await requireOwner(slug);` to `const { club, user } = await requireOwner(slug);` and pass `user.id`:

```ts
// app/s/[slug]/manage/policies/actions.ts
const result = await updateSchedulingSettings(db, club.id, parsed.data, user.id);

// app/s/[slug]/manage/profile/actions.ts
const ok = await updateClubProfile(db, club.id, { /* …unchanged fields… */ }, user.id);

// app/s/[slug]/manage/boats/actions.ts
const res = await createBoat(db, club.id, clampAllowedPayment(parsed.data, club.multisportEnabled), user.id);
const res = await updateBoat(db, { clubId: club.id, boatId: String(formData.get('boatId')), actorId: user.id, ...clampAllowedPayment(parsed.data, club.multisportEnabled) });
const ok = await setBoatActive(db, { clubId: club.id, boatId: String(formData.get('boatId')), active: formData.get('active') === 'true', actorId: user.id });

// app/s/[slug]/manage/skill-levels/actions.ts
await createSkillLevel(db, { clubId: club.id, name: parsed.data.name, actorId: user.id });
const ok = await renameSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')), name: parsed.data.name, actorId: user.id });
const ok = await reorderSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')), direction, actorId: user.id });
const ok = await deleteSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')), actorId: user.id });

// app/s/[slug]/manage/schedule/actions.ts
const res = windowId
  ? await updateWindow(db, { clubId: club.id, windowId: String(windowId), actorId: user.id, ...parsed.data })
  : await createWindow(db, club.id, parsed.data, user.id);
await deleteWindow(db, { clubId: club.id, windowId: String(formData.get('windowId')), actorId: user.id });

// app/s/[slug]/manage/schedule/preview/actions.ts
await setDateOverride(db, club.id, parsed.data, user.id);
await clearDateOverride(db, club.id, dateISO, user.id);
```

- [ ] **Step 10: Run all six suites to verify they pass**

```bash
pnpm test:integration -- src/lib/scheduling-settings.integration.test.ts src/lib/club-profile.integration.test.ts src/lib/boats.integration.test.ts src/lib/skill-levels.integration.test.ts src/lib/schedule.integration.test.ts src/lib/date-overrides.integration.test.ts
```

Expected: PASS.

- [ ] **Step 11: Prove the tests fail when the implementation is reverted**

Mutation 1 — **`createBoat` un-wrapped.** Replace its transaction with the original `db.insert(...)` followed by `await logAudit(db, …)`. Re-run `boats`. Expected: FAIL on `rolls the boat creation back when the audit insert fails` — the boat row survives. Restore.

Mutation 2 — **`window.update` mislabelled as `window.create`.** Change the action string in `updateWindow` and re-run `schedule`. Expected: FAIL on the sorted-actions assertion. Restore.

Mutation 3 — **`clearDateOverride`'s audit call deleted.** Re-run `date-overrides`. Expected: FAIL twice — the missing `date_override.clear` action, and the atomicity probe no longer throwing. Restore.

- [ ] **Step 12: Confirm every table row in spec §4.2 is now covered**

```bash
grep -rn "action: '" src/lib | grep -o "action: '[a-z_.]*'" | sort -u
```

Expected: 29 distinct action strings, matching the list in Global Constraints exactly. Any string not on that list is a bug; any list entry missing is an uncovered mutation.

- [ ] **Step 13: Verify and commit**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm vitest run && pnpm test:integration
```

```bash
git add src/lib/ "app/s/[slug]/manage/"
git commit -m "feat(audit): record club configuration changes across policies, profile, boats, skill levels, schedule and date overrides"
```

---

### Task 6: The audit viewer — `/admin/audit`

**Files:**
- Modify: `src/lib/audit.ts` (add `listAuditRows`)
- Create: `app/admin/audit/page.tsx`
- Create: `app/admin/audit/audit-filters.tsx`
- Create: `app/admin/audit/audit-table.tsx`
- Create: `app/admin/audit/audit-table.test.tsx`
- Modify: `app/admin/_nav.tsx` (add the tab)
- Modify: `messages/en.json`, `messages/tr.json`
- Test: `src/lib/audit.integration.test.ts` (new), `app/admin/audit/audit-table.test.tsx`

**Interfaces:**
- Consumes: `auditLog` schema, `DbOrTx` from Task 1; all 29 action strings from Tasks 2, 4, 5.
- Produces:
  ```ts
  // src/lib/audit.ts
  export type AuditRow = {
    id: string;
    createdAt: Date;
    action: string;
    target: string | null;
    actingAsRole: ActingAsRole | null;
    actorUserId: string | null;
    actorName: string | null;
    actorEmail: string | null;
    clubId: string | null;
    clubName: string | null;
  };
  export type AuditCursor = { createdAt: Date; id: string };
  export type AuditFilters = { clubId?: string; actorUserId?: string; actionPrefix?: string };
  export function listAuditRows(
    db: DbOrTx,
    opts: { filters?: AuditFilters; cursor?: AuditCursor | null; limit?: number },
  ): Promise<{ rows: AuditRow[]; nextCursor: AuditCursor | null }>;
  ```
  Task 8's club detail page calls `listAuditRows(db, { filters: { clubId }, limit: 20 })` and renders the same `AuditTable`.

**The non-negotiable rendering requirement (spec §4.4).** `audit_log.actor_user_id` and `audit_log.club_id` are both `on delete set null`. A row whose actor account or club has since been deleted is still evidence and **must render** — a dash or the raw id, never a crash. That is why `AuditTable` is a plain prop-driven component with no data access of its own: it can be rendered in jsdom with a deliberately null-everything row, which is exactly the test this task requires. `target` is free text holding an id — render it verbatim, do not resolve it.

**Why keyset and not offset.** The log only grows, and it grows at the head. Offset pagination on a `created_at desc` list shifts every page boundary each time a row is written, so an admin paging through an incident sees rows twice or not at all. `(created_at, id)` is a total order — `id` breaks ties between rows written in the same millisecond.

- [ ] **Step 1: Write the failing query test**

Create `src/lib/audit.integration.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { listAuditRows, logAudit } from './audit';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('listAuditRows', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function mkUser() {
    const id = `au-${Date.now()}-${Math.floor(performance.now())}`;
    await db.insert(schema.user).values({ id, name: 'Auditor', email: `${id}@t.co` });
    return { id, email: `${id}@t.co` };
  }

  it('returns newest first, resolves actor and club, and pages by keyset without repeats', async () => {
    const actor = await mkUser();
    const [club] = await db.insert(schema.clubs).values({ slug: `aud-${Date.now()}`, name: 'Audit Club', status: 'active' }).returning();
    for (let i = 0; i < 5; i++) {
      await logAudit(db, { actorUserId: actor.id, clubId: club.id, action: `boat.update`, target: `t-${i}`, actingAsRole: 'owner' });
    }

    const first = await listAuditRows(db, { filters: { clubId: club.id }, limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.rows[0].actorName).toBe('Auditor');
    expect(first.rows[0].clubName).toBe('Audit Club');
    expect(first.rows[0].createdAt.getTime()).toBeGreaterThanOrEqual(first.rows[1].createdAt.getTime());
    expect(first.nextCursor).not.toBeNull();

    const second = await listAuditRows(db, { filters: { clubId: club.id }, cursor: first.nextCursor, limit: 2 });
    const ids = [...first.rows, ...second.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    const third = await listAuditRows(db, { filters: { clubId: club.id }, cursor: second.nextCursor, limit: 2 });
    expect(third.rows).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
  });

  it('filters by action prefix and by actor', async () => {
    const actor = await mkUser();
    const other = await mkUser();
    const [club] = await db.insert(schema.clubs).values({ slug: `f-${Date.now()}`, name: 'F', status: 'active' }).returning();
    await logAudit(db, { actorUserId: actor.id, clubId: club.id, action: 'skill_level.create', target: 's1' });
    await logAudit(db, { actorUserId: actor.id, clubId: club.id, action: 'boat.create', target: 'b1' });
    await logAudit(db, { actorUserId: other.id, clubId: club.id, action: 'boat.update', target: 'b2' });

    const byPrefix = await listAuditRows(db, { filters: { clubId: club.id, actionPrefix: 'boat.' } });
    expect(byPrefix.rows.map((r) => r.action).sort()).toEqual(['boat.create', 'boat.update']);

    const byActor = await listAuditRows(db, { filters: { clubId: club.id, actorUserId: actor.id } });
    expect(byActor.rows.map((r) => r.action).sort()).toEqual(['boat.create', 'skill_level.create']);
  });

  it('returns a row whose actor and club have both been deleted', async () => {
    const actor = await mkUser();
    const [club] = await db.insert(schema.clubs).values({ slug: `gone-${Date.now()}`, name: 'Gone', status: 'active' }).returning();
    await logAudit(db, { actorUserId: actor.id, clubId: club.id, action: 'club.suspend', target: club.id, actingAsRole: 'admin' });

    await db.delete(schema.clubs).where(eq(schema.clubs.id, club.id));
    await db.delete(schema.user).where(eq(schema.user.id, actor.id));

    const { rows } = await listAuditRows(db, { filters: { actionPrefix: 'club.suspend' }, limit: 50 });
    const orphan = rows.find((r) => r.target === club.id);
    expect(orphan).toBeDefined();
    expect(orphan?.actorUserId).toBeNull();
    expect(orphan?.clubId).toBeNull();
    expect(orphan?.actorName).toBeNull();
  });
});
```

The last test is the one that proves the `leftJoin`s are left joins: an inner join would drop the row entirely, which is precisely how an audit log quietly loses the evidence of a deletion.

- [ ] **Step 2: Run and confirm it fails**

```bash
pnpm test:integration -- src/lib/audit.integration.test.ts
```

Expected: FAIL — `listAuditRows` is not exported.

- [ ] **Step 3: Implement `listAuditRows`**

Append to `src/lib/audit.ts`, extending the imports:

```ts
import { and, desc, eq, like, type SQL, sql } from 'drizzle-orm';

import { auditLog, clubs, user } from '@/db/schema';
```

```ts
export type AuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  target: string | null;
  actingAsRole: ActingAsRole | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  clubId: string | null;
  clubName: string | null;
};

export type AuditCursor = { createdAt: Date; id: string };
export type AuditFilters = { clubId?: string; actorUserId?: string; actionPrefix?: string };

export const AUDIT_PAGE_SIZE = 50;

/**
 * Newest-first audit page.
 *
 * Keyset, not offset: the log grows at the head, so an offset would shift every
 * page boundary between clicks and show rows twice or not at all. `(created_at, id)`
 * is a total order — `id` breaks ties inside the same millisecond.
 *
 * Both joins are LEFT joins on purpose. `actor_user_id` and `club_id` are
 * `on delete set null`, and a row whose actor or club is gone is still evidence
 * (spec §4.4). An inner join here would silently delete history.
 */
export async function listAuditRows(
  db: DbOrTx,
  opts: { filters?: AuditFilters; cursor?: AuditCursor | null; limit?: number } = {},
): Promise<{ rows: AuditRow[]; nextCursor: AuditCursor | null }> {
  const limit = opts.limit ?? AUDIT_PAGE_SIZE;
  const f = opts.filters ?? {};
  const conds: SQL[] = [];
  if (f.clubId) conds.push(eq(auditLog.clubId, f.clubId));
  if (f.actorUserId) conds.push(eq(auditLog.actorUserId, f.actorUserId));
  if (f.actionPrefix) {
    // Escape LIKE metacharacters so an operator pasting `boat_` gets a literal match.
    const escaped = f.actionPrefix.replace(/[\\%_]/g, (c) => `\\${c}`);
    conds.push(like(auditLog.action, `${escaped}%`));
  }
  if (opts.cursor) {
    conds.push(sql`(${auditLog.createdAt}, ${auditLog.id}) < (${opts.cursor.createdAt}::timestamptz, ${opts.cursor.id}::uuid)`);
  }

  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      action: auditLog.action,
      target: auditLog.target,
      actingAsRole: auditLog.actingAsRole,
      actorUserId: auditLog.actorUserId,
      actorName: user.name,
      actorEmail: user.email,
      clubId: auditLog.clubId,
      clubName: clubs.name,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorUserId))
    .leftJoin(clubs, eq(clubs.id, auditLog.clubId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null;
  return { rows: page, nextCursor };
}
```

`limit + 1` is how "is there a next page" is answered without a second `count(*)` over a table that only grows.

- [ ] **Step 4: Run the query test to verify it passes**

```bash
pnpm test:integration -- src/lib/audit.integration.test.ts
```

Expected: PASS, all three.

- [ ] **Step 5: Write the failing component test**

Create `app/admin/audit/audit-table.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AuditRow } from '@/lib/audit';

import { AuditTable } from './audit-table';

const labels = {
  when: 'when', actor: 'actor', club: 'club', action: 'action', target: 'target', empty: 'empty', unknown: '—',
};

function row(overrides: Partial<AuditRow>): AuditRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    createdAt: new Date('2026-08-08T09:00:00Z'),
    action: 'club.suspend',
    target: 'abc',
    actingAsRole: 'admin',
    actorUserId: 'u1',
    actorName: 'Ada',
    actorEmail: 'ada@example.com',
    clubId: 'c1',
    clubName: 'Boğaziçi',
    ...overrides,
  };
}

describe('AuditTable', () => {
  it('renders a row whose actor and club are both null without crashing', () => {
    const orphan = row({
      id: '22222222-2222-2222-2222-222222222222',
      actorUserId: null, actorName: null, actorEmail: null,
      clubId: null, clubName: null,
    });
    render(<AuditTable rows={[orphan]} labels={labels} locale="en" timeZone="UTC" />);

    // The row is still evidence: its action and target must be on screen…
    expect(screen.getByText('club.suspend')).toBeInTheDocument();
    expect(screen.getByText('abc')).toBeInTheDocument();
    // …and the two missing subjects render as the placeholder, not as a crash.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('renders the actor name and club name when they resolve', () => {
    render(<AuditTable rows={[row({})]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Boğaziçi')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('renders the target verbatim rather than resolving it', () => {
    render(<AuditTable rows={[row({ target: 'not-a-real-id' })]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.getByText('not-a-real-id')).toBeInTheDocument();
  });

  it('shows the empty state when there are no rows', () => {
    render(<AuditTable rows={[]} labels={labels} locale="en" timeZone="UTC" />);
    expect(screen.getByText('empty')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run and confirm it fails**

```bash
pnpm vitest run "app/admin/audit/audit-table.test.tsx"
```

Expected: FAIL — cannot resolve `./audit-table`.

- [ ] **Step 7: Implement the table**

Create `app/admin/audit/audit-table.tsx` (no `'use client'` — it has no interactivity, and staying a plain function component is what makes it renderable in the jsdom test above):

```tsx
import { Card } from '@/components/ui/card';
import type { AuditRow } from '@/lib/audit';

export type AuditTableLabels = {
  when: string;
  actor: string;
  club: string;
  action: string;
  target: string;
  empty: string;
  /** Rendered in place of an actor or club that has since been deleted. */
  unknown: string;
};

/**
 * Prop-driven on purpose: it does no data access, so it can be rendered in jsdom
 * with a deliberately null-everything row. `actor_user_id` and `club_id` are
 * `on delete set null`, and a row whose subject is gone is still evidence — it
 * must render, never crash (spec §4.4).
 */
export function AuditTable({ rows, labels, locale, timeZone }: {
  rows: AuditRow[];
  labels: AuditTableLabels;
  locale: string;
  timeZone: string;
}) {
  if (rows.length === 0) return <p className="text-muted-foreground">{labels.empty}</p>;
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return (
    <Card className="gap-0 divide-y divide-border py-0">
      {rows.map((r) => (
        <div key={r.id} className="flex flex-col gap-1 p-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-heading font-semibold">{r.action}</span>
            <span className="text-xs text-muted-foreground">{fmt.format(r.createdAt)}</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <dt>{labels.actor}</dt>
            <dd className="text-foreground">{r.actorName ?? r.actorUserId ?? labels.unknown}</dd>
            <dt>{labels.club}</dt>
            <dd className="text-foreground">{r.clubName ?? r.clubId ?? labels.unknown}</dd>
            <dt>{labels.target}</dt>
            {/* Free text holding an id — rendered verbatim, never resolved (spec §4.4). */}
            <dd className="break-all text-foreground">{r.target ?? labels.unknown}</dd>
          </dl>
        </div>
      ))}
    </Card>
  );
}
```

`r.actorName ?? r.actorUserId ?? labels.unknown` is the whole point: a name if we have one, the raw id if the account is gone but the id survived, and the placeholder only when both are null.

- [ ] **Step 8: Run the component test to verify it passes**

```bash
pnpm vitest run "app/admin/audit/audit-table.test.tsx"
```

Expected: PASS, all four.

- [ ] **Step 9: Add the message keys to both files**

`messages/en.json` under `admin`:

```json
"audit": "Audit log",
"auditWhen": "When",
"auditActor": "Actor",
"auditClub": "Club",
"auditAction": "Action",
"auditTarget": "Target",
"auditEmpty": "No audit entries match these filters.",
"auditUnknown": "—",
"auditFilterClub": "Club id",
"auditFilterActor": "Actor user id",
"auditFilterAction": "Action starts with",
"auditApply": "Apply",
"auditClear": "Clear",
"auditNext": "Older",
"auditFirst": "Newest"
```

`messages/tr.json` under `admin`:

```json
"audit": "Denetim kaydı",
"auditWhen": "Tarih",
"auditActor": "İşlemi yapan",
"auditClub": "Kulüp",
"auditAction": "İşlem",
"auditTarget": "Hedef",
"auditEmpty": "Bu filtrelerle eşleşen kayıt yok.",
"auditUnknown": "—",
"auditFilterClub": "Kulüp kimliği",
"auditFilterActor": "Kullanıcı kimliği",
"auditFilterAction": "İşlem şununla başlıyor",
"auditApply": "Uygula",
"auditClear": "Temizle",
"auditNext": "Daha eski",
"auditFirst": "En yeni"
```

- [ ] **Step 10: Build the filter form**

Create `app/admin/audit/audit-filters.tsx` — a plain GET form, so filters live in the URL, survive a refresh, and need no JavaScript:

```tsx
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export async function AuditFilters({ clubId, actorUserId, actionPrefix }: {
  clubId?: string;
  actorUserId?: string;
  actionPrefix?: string;
}) {
  const t = await getTranslations('admin');
  return (
    // GET, not a server action: the filter state belongs in the URL so a page of
    // the log can be linked to, and so "Older" can carry the same filters forward.
    <form method="get" action="/admin/audit" className="mb-6">
      <FieldGroup className="sm:flex-row sm:items-end sm:gap-3">
        <Field>
          <FieldLabel htmlFor="clubId">{t('auditFilterClub')}</FieldLabel>
          <Input id="clubId" name="clubId" defaultValue={clubId ?? ''} />
        </Field>
        <Field>
          <FieldLabel htmlFor="actorUserId">{t('auditFilterActor')}</FieldLabel>
          <Input id="actorUserId" name="actorUserId" defaultValue={actorUserId ?? ''} />
        </Field>
        <Field>
          <FieldLabel htmlFor="action">{t('auditFilterAction')}</FieldLabel>
          <Input id="action" name="action" defaultValue={actionPrefix ?? ''} placeholder="boat." />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" size="sm">{t('auditApply')}</Button>
          <Button type="submit" size="sm" variant="ghost" name="reset" value="1">{t('auditClear')}</Button>
        </div>
      </FieldGroup>
    </form>
  );
}
```

- [ ] **Step 11: Build the page**

Create `app/admin/audit/page.tsx`:

```tsx
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { db } from '@/db';
import { type AuditCursor, listAuditRows } from '@/lib/audit';

import { AuditFilters } from './audit-filters';
import { AuditTable } from './audit-table';

export const metadata = { robots: { index: false, follow: false } };

/** `<createdAtISO>~<uuid>`. `~` cannot appear in either half, so a split(1) is unambiguous. */
function parseCursor(raw: string | undefined): AuditCursor | null {
  if (!raw) return null;
  const sep = raw.indexOf('~');
  if (sep < 0) return null;
  const when = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(when.getTime()) || !id) return null;
  return { createdAt: when, id };
}

export default async function AdminAuditPage({ searchParams }: {
  searchParams: Promise<{ clubId?: string; actorUserId?: string; action?: string; cursor?: string; reset?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('admin');
  const locale = await getLocale();
  const reset = sp.reset === '1';
  const clubId = reset ? undefined : sp.clubId?.trim() || undefined;
  const actorUserId = reset ? undefined : sp.actorUserId?.trim() || undefined;
  const actionPrefix = reset ? undefined : sp.action?.trim() || undefined;

  const { rows, nextCursor } = await listAuditRows(db, {
    filters: { clubId, actorUserId, actionPrefix },
    cursor: reset ? null : parseCursor(sp.cursor),
  });

  const query = new URLSearchParams();
  if (clubId) query.set('clubId', clubId);
  if (actorUserId) query.set('actorUserId', actorUserId);
  if (actionPrefix) query.set('action', actionPrefix);
  const firstHref = `/admin/audit${query.toString() ? `?${query}` : ''}`;
  const nextQuery = new URLSearchParams(query);
  if (nextCursor) nextQuery.set('cursor', `${nextCursor.createdAt.toISOString()}~${nextCursor.id}`);

  return (
    <>
      <AuditFilters clubId={clubId} actorUserId={actorUserId} actionPrefix={actionPrefix} />
      <AuditTable
        rows={rows}
        locale={locale}
        timeZone="Europe/Istanbul"
        labels={{
          when: t('auditWhen'), actor: t('auditActor'), club: t('auditClub'),
          action: t('auditAction'), target: t('auditTarget'),
          empty: t('auditEmpty'), unknown: t('auditUnknown'),
        }}
      />
      <div className="mt-4 flex justify-between">
        <Button asChild size="sm" variant="ghost" disabled={!sp.cursor}>
          <Link href={firstHref}>{t('auditFirst')}</Link>
        </Button>
        {nextCursor && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/admin/audit?${nextQuery}`}>{t('auditNext')}</Link>
          </Button>
        )}
      </div>
    </>
  );
}
```

If shadcn's `Button` in this project does not support `asChild`, render the two links as plain `<Link>` elements with the same `text-sm` classes the nav uses — do not edit `src/components/ui/button.tsx`.

- [ ] **Step 12: Add the nav tab**

`app/admin/_nav.tsx`, extend `items`:

```ts
const items = [
  { href: '/admin', key: 'clubs' },
  { href: '/admin/requests', key: 'requests' },
  { href: '/admin/users', key: 'users' },
  { href: '/admin/audit', key: 'audit' },
  { href: '/admin/clubs/new', key: 'newClub' },
] as const;
```

`users` is added here and its page arrives in Task 7; the tab is dead for one task. Add the `"users": "Users"` / `"users": "Kullanıcılar"` key to both message files now so the nav does not throw a missing-key error in the meantime.

- [ ] **Step 13: Prove the tests fail when the implementation is reverted**

Mutation 1 — **`leftJoin` changed to `innerJoin`.** Change both joins in `listAuditRows` and re-run `src/lib/audit.integration.test.ts`. Expected: FAIL on `returns a row whose actor and club have both been deleted` (`orphan` is `undefined`). Restore.

Mutation 2 — **the null fallbacks removed.** In `audit-table.tsx`, change `{r.actorName ?? r.actorUserId ?? labels.unknown}` to `{r.actorName}` and the club cell likewise, then re-run the component test. Expected: FAIL on `renders a row whose actor and club are both null` (`getAllByText('—')` finds none). Restore.

Mutation 3 — **the keyset cursor dropped.** Delete the `opts.cursor` condition and re-run the query test. Expected: FAIL on the page-2 duplicate check (`new Set(ids).size` is smaller than `ids.length`). Restore.

- [ ] **Step 14: Verify and commit**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm vitest run && pnpm test:integration
```

```bash
git add src/lib/audit.ts src/lib/audit.integration.test.ts app/admin/audit/ app/admin/_nav.tsx messages/en.json messages/tr.json
git commit -m "feat(admin): add the audit log viewer with keyset pagination and filters"
```

---

### Task 7: `src/lib/users-admin.ts` and `/admin/users`

**Files:**
- Create: `src/lib/users-admin.ts`
- Create: `src/lib/users-admin.integration.test.ts`
- Create: `src/components/admin-pagination.tsx`
- Create: `app/admin/users/page.tsx`
- Create: `app/admin/users/actions.ts`
- Create: `app/admin/users/admin-toggle.tsx`
- Create: `app/admin/users/admin-toggle.test.tsx`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `logAudit` and `DbOrTx` from Task 1.
- Produces:
  ```ts
  export type UserMembershipSummary = { clubId: string; clubName: string; role: 'owner' | 'member' | 'admin'; status: 'pending' | 'approved' | 'rejected' | 'banned' };
  export type AdminUserRow = { id: string; name: string; email: string; isAdmin: boolean; createdAt: Date; memberships: UserMembershipSummary[] };

  export const USERS_PAGE_SIZE = 25;

  export function searchUsers(
    db: DbOrTx,
    opts: { q?: string; page?: number; pageSize?: number },
  ): Promise<{ rows: AdminUserRow[]; total: number; page: number; pageSize: number }>;

  export type SetPlatformAdminResult =
    | { ok: true; isAdmin: boolean }
    | { ok: false; error: 'not_found' | 'self_revoke' | 'last_admin' };

  export function setPlatformAdmin(
    db: DB,
    input: { targetUserId: string; isAdmin: boolean; actorId: string },
  ): Promise<SetPlatformAdminResult>;
  ```
- Also produces `src/components/admin-pagination.tsx`, reused by Task 9:
  ```ts
  export function AdminPagination(props: { basePath: string; query: Record<string, string | undefined>; page: number; pageSize: number; total: number; prevLabel: string; nextLabel: string; rangeLabel: string }): React.ReactElement | null;
  ```

**The two guards, both server-side (spec §6.2).** *An admin may not revoke their own admin flag* — otherwise one misclick locks the operator out of the console they are standing in. *The last remaining admin may not be revoked* — counted **inside the same transaction as the update**, with the admin rows locked (`FOR UPDATE`), so two concurrent revokes cannot both read "2 admins" and both proceed, emptying the set. A count taken before the transaction, or without the lock, is not a guard; it is a race with a comment on it.

Offset pagination is correct here (unlike the audit log): the user table does not grow at the head of a name-ordered list, and an admin wants "page 3 of the M's".

- [ ] **Step 1: Write the failing library tests**

Create `src/lib/users-admin.integration.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { searchUsers, setPlatformAdmin } from './users-admin';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('users-admin', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function mkUser(opts: { name?: string; isAdmin?: boolean } = {}) {
    const id = `ua-${Date.now()}-${Math.floor(performance.now())}`;
    await db.insert(schema.user).values({ id, name: opts.name ?? 'User', email: `${id}@t.co`, isAdmin: opts.isAdmin ?? false });
    return { id, email: `${id}@t.co` };
  }

  it('finds a user by a case-insensitive fragment of email or name, with their memberships', async () => {
    const stamp = `${Date.now()}${Math.floor(performance.now())}`;
    const u = await mkUser({ name: `Zeynep ${stamp}` });
    const [club] = await db.insert(schema.clubs).values({ slug: `u-${stamp}`, name: 'Search Club', status: 'active' }).returning();
    await db.insert(schema.memberships).values({ userId: u.id, clubId: club.id, role: 'owner', status: 'approved' });

    const byName = await searchUsers(db, { q: `zeynep ${stamp}`.toUpperCase() });
    expect(byName.rows.map((r) => r.id)).toContain(u.id);
    const hit = byName.rows.find((r) => r.id === u.id);
    expect(hit?.memberships).toEqual([{ clubId: club.id, clubName: 'Search Club', role: 'owner', status: 'approved' }]);

    const byEmail = await searchUsers(db, { q: u.email.slice(0, 12).toUpperCase() });
    expect(byEmail.rows.map((r) => r.id)).toContain(u.id);
  });

  it('paginates and reports a total larger than the page', async () => {
    const stamp = `pg${Date.now()}`;
    for (let i = 0; i < 3; i++) await mkUser({ name: `${stamp}-${i}` });
    const first = await searchUsers(db, { q: stamp, page: 1, pageSize: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.total).toBe(3);
    const second = await searchUsers(db, { q: stamp, page: 2, pageSize: 2 });
    expect(second.rows).toHaveLength(1);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(3);
  });

  it('grants admin and audits user.admin_grant', async () => {
    const actor = await mkUser({ isAdmin: true });
    const target = await mkUser();
    expect(await setPlatformAdmin(db, { targetUserId: target.id, isAdmin: true, actorId: actor.id }))
      .toMatchObject({ ok: true, isAdmin: true });
    const [after] = await db.select().from(schema.user).where(eq(schema.user.id, target.id));
    expect(after.isAdmin).toBe(true);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, target.id));
    expect(rows.map((a) => a.action)).toContain('user.admin_grant');
    expect(rows[0].actingAsRole).toBe('admin');
  });

  it('refuses a self-revoke and leaves the flag set', async () => {
    const actor = await mkUser({ isAdmin: true });
    await mkUser({ isAdmin: true }); // so last_admin is not the reason for the refusal
    expect(await setPlatformAdmin(db, { targetUserId: actor.id, isAdmin: false, actorId: actor.id }))
      .toMatchObject({ ok: false, error: 'self_revoke' });
    const [after] = await db.select().from(schema.user).where(eq(schema.user.id, actor.id));
    expect(after.isAdmin).toBe(true);
  });

  it('refuses to revoke the last remaining admin', async () => {
    // Start from a known-empty admin set so the count is deterministic.
    await db.update(schema.user).set({ isAdmin: false }).where(eq(schema.user.isAdmin, true));
    const actor = await mkUser({ isAdmin: false });
    const onlyAdmin = await mkUser({ isAdmin: true });
    expect(await setPlatformAdmin(db, { targetUserId: onlyAdmin.id, isAdmin: false, actorId: actor.id }))
      .toMatchObject({ ok: false, error: 'last_admin' });
    const [after] = await db.select().from(schema.user).where(eq(schema.user.id, onlyAdmin.id));
    expect(after.isAdmin).toBe(true);
  });

  it('rolls the flag change back when the audit insert fails', async () => {
    const target = await mkUser();
    await expect(setPlatformAdmin(db, { targetUserId: target.id, isAdmin: true, actorId: 'no-such-user' }))
      .rejects.toThrow();
    const [after] = await db.select().from(schema.user).where(eq(schema.user.id, target.id));
    expect(after.isAdmin).toBe(false);
  });
});
```

Note the `last_admin` test wipes the admin flag first. Run this suite with `--no-file-parallelism` (which `pnpm test:integration` already sets) so it cannot race another suite's fixtures.

- [ ] **Step 2: Run and confirm it fails**

```bash
pnpm test:integration -- src/lib/users-admin.integration.test.ts
```

Expected: FAIL — module `./users-admin` does not exist.

- [ ] **Step 3: Implement `users-admin.ts`**

Create `src/lib/users-admin.ts`:

```ts
import { asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import type { DB, DbOrTx } from '@/db';
import { clubs, memberships, user } from '@/db/schema';
import { logAudit } from '@/lib/audit';

export type UserMembershipSummary = {
  clubId: string;
  clubName: string;
  role: 'owner' | 'member' | 'admin';
  status: 'pending' | 'approved' | 'rejected' | 'banned';
};

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  createdAt: Date;
  memberships: UserMembershipSummary[];
};

export const USERS_PAGE_SIZE = 25;

/**
 * Paged user search over email and name, case-insensitive substring.
 *
 * Offset pagination, unlike the audit log's keyset: this list is ordered by name
 * and does not grow at its head, so page boundaries are stable between clicks and
 * an operator can meaningfully ask for "page 3".
 *
 * Memberships are fetched in one follow-up query keyed by the page's user ids
 * rather than joined into the main select — a join would multiply the user rows
 * by their membership count and break both LIMIT and the total.
 */
export async function searchUsers(
  db: DbOrTx,
  opts: { q?: string; page?: number; pageSize?: number },
): Promise<{ rows: AdminUserRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = opts.pageSize ?? USERS_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim();
  // Escape LIKE metacharacters so a literal `_` or `%` in a search box matches itself.
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where = pattern ? or(ilike(user.email, pattern), ilike(user.name, pattern)) : undefined;

  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(user).where(where);
  const total = countRow?.n ?? 0;

  const people = await db
    .select({ id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin, createdAt: user.createdAt })
    .from(user)
    .where(where)
    .orderBy(asc(user.name), asc(user.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = people.map((p) => p.id);
  const links = ids.length
    ? await db
        .select({ userId: memberships.userId, clubId: clubs.id, clubName: clubs.name, role: memberships.role, status: memberships.status })
        .from(memberships)
        .innerJoin(clubs, eq(clubs.id, memberships.clubId))
        .where(inArray(memberships.userId, ids))
        .orderBy(asc(clubs.name))
    : [];

  const byUser = new Map<string, UserMembershipSummary[]>();
  for (const l of links) {
    const list = byUser.get(l.userId) ?? [];
    list.push({ clubId: l.clubId, clubName: l.clubName, role: l.role, status: l.status });
    byUser.set(l.userId, list);
  }

  return {
    rows: people.map((p) => ({ ...p, memberships: byUser.get(p.id) ?? [] })),
    total,
    page,
    pageSize,
  };
}

export type SetPlatformAdminResult =
  | { ok: true; isAdmin: boolean }
  | { ok: false; error: 'not_found' | 'self_revoke' | 'last_admin' };

/**
 * Grant or revoke the platform-admin flag.
 *
 * Two guards, both here rather than in the UI, because a server action is
 * reachable by a direct POST and a layout does not govern it (spec §6.2):
 *
 *  - self-revoke is refused, so one misclick cannot lock the operator out of the
 *    console they are standing in;
 *  - the last remaining admin cannot be revoked, counted INSIDE this transaction
 *    with the admin rows locked `for update`. A count taken outside, or without
 *    the lock, lets two concurrent revokes each observe two admins and each
 *    proceed — emptying the set with nobody left to refill it.
 */
export async function setPlatformAdmin(
  db: DB,
  input: { targetUserId: string; isAdmin: boolean; actorId: string },
): Promise<SetPlatformAdminResult> {
  if (!input.isAdmin && input.targetUserId === input.actorId) return { ok: false, error: 'self_revoke' };

  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.id, input.targetUserId)).limit(1);
    if (!target) return { ok: false, error: 'not_found' };

    if (!input.isAdmin) {
      const admins = await tx.select({ id: user.id }).from(user).where(eq(user.isAdmin, true)).for('update');
      if (admins.length <= 1) return { ok: false, error: 'last_admin' };
    }

    await tx.update(user).set({ isAdmin: input.isAdmin }).where(eq(user.id, input.targetUserId));
    await logAudit(tx, {
      actorUserId: input.actorId,
      action: input.isAdmin ? 'user.admin_grant' : 'user.admin_revoke',
      target: input.targetUserId,
      actingAsRole: 'admin',
    });
    return { ok: true, isAdmin: input.isAdmin };
  });
}
```

There is no `clubId` on this audit entry — the platform-admin flag is not scoped to a club, and inventing one would be a lie in the log.

- [ ] **Step 4: Run the library tests to verify they pass**

```bash
pnpm test:integration -- src/lib/users-admin.integration.test.ts
```

Expected: PASS, all six.

- [ ] **Step 5: Add the message keys to both files**

`messages/en.json` under `admin`:

```json
"usersSearch": "Search by name or email",
"usersSearchCta": "Search",
"usersEmpty": "No users match that search.",
"usersAdminBadge": "Platform admin",
"usersGrant": "Make admin",
"usersRevoke": "Remove admin",
"usersNoMemberships": "No club memberships.",
"usersGranted": "Platform admin granted.",
"usersRevoked": "Platform admin removed.",
"usersErrorSelfRevoke": "You can't remove your own admin access.",
"usersErrorLastAdmin": "This is the last platform admin. Grant admin to someone else first.",
"confirmGrantTitle": "Make {name} a platform admin?",
"confirmGrantBody": "They will get full access to every club and to this console.",
"confirmRevokeTitle": "Remove platform admin from {name}?",
"confirmRevokeBody": "They will immediately lose access to this console.",
"cancel": "Cancel",
"paginationPrev": "Previous",
"paginationNext": "Next",
"paginationRange": "{from}–{to} of {total}"
```

`messages/tr.json` under `admin`:

```json
"usersSearch": "Ada veya e-postaya göre ara",
"usersSearchCta": "Ara",
"usersEmpty": "Bu aramayla eşleşen kullanıcı yok.",
"usersAdminBadge": "Platform yöneticisi",
"usersGrant": "Yönetici yap",
"usersRevoke": "Yöneticiliği kaldır",
"usersNoMemberships": "Kulüp üyeliği yok.",
"usersGranted": "Platform yöneticiliği verildi.",
"usersRevoked": "Platform yöneticiliği kaldırıldı.",
"usersErrorSelfRevoke": "Kendi yönetici yetkini kaldıramazsın.",
"usersErrorLastAdmin": "Bu son platform yöneticisi. Önce başka birine yöneticilik ver.",
"confirmGrantTitle": "{name} platform yöneticisi yapılsın mı?",
"confirmGrantBody": "Her kulübe ve bu konsola tam erişimi olacak.",
"confirmRevokeTitle": "{name} kullanıcısının platform yöneticiliği kaldırılsın mı?",
"confirmRevokeBody": "Bu konsola erişimi anında sona erecek.",
"cancel": "Vazgeç",
"paginationPrev": "Önceki",
"paginationNext": "Sonraki",
"paginationRange": "{total} kayıttan {from}–{to}"
```

- [ ] **Step 6: Build the shared pagination control**

Create `src/components/admin-pagination.tsx`:

```tsx
import Link from 'next/link';

/**
 * Prev / next links for the offset-paginated admin lists (users, clubs). Renders
 * nothing when everything fits on one page. Links, not buttons: pagination is
 * navigation, and the page number belongs in the URL so a result set can be shared.
 */
export function AdminPagination({ basePath, query, page, pageSize, total, prevLabel, nextLabel, rangeLabel }: {
  basePath: string;
  query: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
  prevLabel: string;
  nextLabel: string;
  rangeLabel: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) sp.set(k, v);
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <nav className="mt-4 flex items-center justify-between text-sm">
      {page > 1 ? <Link href={href(page - 1)} className="text-brand hover:underline">{prevLabel}</Link> : <span />}
      <span className="text-muted-foreground">{rangeLabel}</span>
      {page < pages ? <Link href={href(page + 1)} className="text-brand hover:underline">{nextLabel}</Link> : <span />}
    </nav>
  );
}
```

- [ ] **Step 7: Write the server action**

Create `app/admin/users/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireAdmin } from '@/lib/session';
import { setPlatformAdmin } from '@/lib/users-admin';

export type SetPlatformAdminState =
  | { ok: true; isAdmin: boolean }
  | { ok: false; error: 'self_revoke' | 'last_admin' | 'failed' };

export async function setPlatformAdminAction(
  _prev: SetPlatformAdminState | null,
  formData: FormData,
): Promise<SetPlatformAdminState> {
  // Re-checked here, not inherited from the layout: layouts do not govern server
  // actions, so this is reachable by a direct POST.
  const admin = await requireAdmin();
  const targetUserId = String(formData.get('userId'));
  const isAdmin = formData.get('isAdmin') === 'true';
  let res;
  try {
    res = await setPlatformAdmin(db, { targetUserId, isAdmin, actorId: admin.id });
  } catch {
    return { ok: false, error: 'failed' };
  }
  if (!res.ok) {
    return { ok: false, error: res.error === 'not_found' ? 'failed' : res.error };
  }
  revalidatePath('/admin/users');
  return { ok: true, isAdmin: res.isAdmin };
}
```

- [ ] **Step 8: Write the failing component test for the toggle**

Create `app/admin/users/admin-toggle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('./actions', () => ({ setPlatformAdminAction: vi.fn() }));

import { setPlatformAdminAction } from './actions';
import { AdminToggle } from './admin-toggle';

describe('AdminToggle', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not submit until the confirmation dialog is confirmed', async () => {
    render(<AdminToggle userId="u1" userName="Ada" isAdmin={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'usersGrant' }));
    expect(setPlatformAdminAction).not.toHaveBeenCalled();

    // The dialog must name the subject — a bare "Are you sure?" is what let a
    // misclick hit the wrong row before.
    expect(await screen.findByText('confirmGrantTitle:{"name":"Ada"}')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'usersGrant' , hidden: true }));
    await waitFor(() => expect(setPlatformAdminAction).toHaveBeenCalled());
  });

  it('names the subject in the revoke confirmation', async () => {
    render(<AdminToggle userId="u1" userName="Ada" isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'usersRevoke' }));
    expect(await screen.findByText('confirmRevokeTitle:{"name":"Ada"}')).toBeInTheDocument();
  });
});
```

If the confirm submit button and the trigger end up sharing an accessible name, give the dialog's submit its own label key and select on that instead — do not weaken the assertion to `getAllByRole(...)[1]`.

- [ ] **Step 9: Run and confirm it fails**

```bash
pnpm vitest run "app/admin/users/admin-toggle.test.tsx"
```

Expected: FAIL — cannot resolve `./admin-toggle`.

- [ ] **Step 10: Implement the toggle**

Create `app/admin/users/admin-toggle.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { setPlatformAdminAction, type SetPlatformAdminState } from './actions';

/**
 * Granting or removing platform admin is irreversible from the victim's side —
 * a removed admin cannot restore themselves — so it goes behind a confirmation
 * that NAMES the user. An unnamed confirm is what let a double-click land on the
 * wrong row and destroy real data in this codebase before.
 */
export function AdminToggle({ userId, userName, isAdmin }: { userId: string; userName: string; isAdmin: boolean }) {
  const t = useTranslations('admin');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<SetPlatformAdminState | null, FormData>(setPlatformAdminAction, null);
  const handled = useRef<SetPlatformAdminState | null>(null);

  useEffect(() => {
    if (state === null || state === handled.current) return;
    handled.current = state;
    setOpen(false);
    if (state.ok) toast.success(state.isAdmin ? t('usersGranted') : t('usersRevoked'));
    else if (state.error === 'self_revoke') toast.error(t('usersErrorSelfRevoke'));
    else if (state.error === 'last_admin') toast.error(t('usersErrorLastAdmin'));
    else toast.error(t('actionError'));
  }, [state, t]);

  const next = !isAdmin;
  const triggerLabel = isAdmin ? t('usersRevoke') : t('usersGrant');

  return (
    <>
      <Button size="sm" variant={isAdmin ? 'destructive' : 'default'} onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={formAction}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="isAdmin" value={String(next)} />
            <DialogHeader>
              <DialogTitle>
                {isAdmin ? t('confirmRevokeTitle', { name: userName }) : t('confirmGrantTitle', { name: userName })}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {isAdmin ? t('confirmRevokeBody') : t('confirmGrantBody')}
            </p>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>{t('cancel')}</DialogClose>
              <PendingButton variant={isAdmin ? 'destructive' : 'default'}>{triggerLabel}</PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 11: Build the users page**

Create `app/admin/users/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';

import { AdminPagination } from '@/components/admin-pagination';
import { StatusPill } from '@/components/booking-status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { searchUsers, USERS_PAGE_SIZE } from '@/lib/users-admin';

import { AdminToggle } from './admin-toggle';

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminUsersPage({ searchParams }: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('admin');
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const { rows, total } = await searchUsers(db, { q, page, pageSize: USERS_PAGE_SIZE });
  const from = total === 0 ? 0 : (page - 1) * USERS_PAGE_SIZE + 1;
  const to = Math.min(page * USERS_PAGE_SIZE, total);

  return (
    <>
      <form method="get" action="/admin/users" className="mb-6 flex gap-2">
        <Input name="q" defaultValue={q ?? ''} placeholder={t('usersSearch')} aria-label={t('usersSearch')} />
        <Button type="submit" size="sm">{t('usersSearchCta')}</Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('usersEmpty')}</p>
      ) : (
        <Card className="gap-0 divide-y divide-border py-0">
          {rows.map((u) => (
            <div key={u.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 font-medium">
                  {u.name}
                  {u.isAdmin && <StatusPill tone="accent">{t('usersAdminBadge')}</StatusPill>}
                </span>
                <span className="text-sm text-muted-foreground">{u.email}</span>
                {u.memberships.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t('usersNoMemberships')}</span>
                ) : (
                  <ul className="text-xs text-muted-foreground">
                    {u.memberships.map((m) => (
                      <li key={m.clubId}>{m.clubName} — {m.role} / {m.status}</li>
                    ))}
                  </ul>
                )}
              </div>
              <AdminToggle userId={u.id} userName={u.name} isAdmin={u.isAdmin} />
            </div>
          ))}
        </Card>
      )}

      <AdminPagination
        basePath="/admin/users"
        query={{ q }}
        page={page}
        pageSize={USERS_PAGE_SIZE}
        total={total}
        prevLabel={t('paginationPrev')}
        nextLabel={t('paginationNext')}
        rangeLabel={t('paginationRange', { from, to, total })}
      />
    </>
  );
}
```

- [ ] **Step 12: Run the component test to verify it passes**

```bash
pnpm vitest run "app/admin/users/admin-toggle.test.tsx"
```

Expected: PASS, both.

- [ ] **Step 13: Prove the tests fail when the implementation is reverted**

Mutation 1 — **the self-revoke guard removed.** Delete the `if (!input.isAdmin && input.targetUserId === input.actorId)` line and re-run `src/lib/users-admin.integration.test.ts`. Expected: FAIL on `refuses a self-revoke` — the flag is now `false`. Restore.

Mutation 2 — **the last-admin count moved outside the transaction.** Move the `admins` query above `db.transaction(...)` and drop `.for('update')`. The functional test still passes, so instead assert the lock is present by re-running with the count changed to `admins.length <= 0`; expected: FAIL on `refuses to revoke the last remaining admin`. Restore the correct `<= 1` and the in-transaction `for('update')`.

Mutation 3 — **the confirmation dialog bypassed.** In `admin-toggle.tsx`, change the trigger `<Button onClick={() => setOpen(true)}>` into a direct submit of the form, and re-run the component test. Expected: FAIL on `does not submit until the confirmation dialog is confirmed`. Restore.

- [ ] **Step 14: Verify and commit**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm vitest run && pnpm test:integration
```

```bash
git add src/lib/users-admin.ts src/lib/users-admin.integration.test.ts src/components/admin-pagination.tsx app/admin/users/ messages/en.json messages/tr.json
git commit -m "feat(admin): add the users page with search, pagination and the platform-admin toggle"
```

---

### Task 8: `transferOwnership` and the club detail page `/admin/clubs/[id]`

**Files:**
- Modify: `src/lib/clubs-admin.ts` (add `transferOwnership`, `getClubAdminDetail`)
- Modify: `src/lib/clubs-admin.integration.test.ts`
- Create: `app/admin/clubs/[id]/page.tsx`
- Create: `app/admin/clubs/[id]/actions.ts`
- Create: `app/admin/clubs/[id]/transfer-owner.tsx`
- Create: `app/admin/clubs/[id]/transfer-owner.test.tsx`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `logAudit` (Task 1), `setClubStatus` + `SetClubStatusResult` (Task 2), `listAuditRows` + `AuditTable` (Task 6).
- Produces:
  ```ts
  export type TransferOwnershipResult =
    | { ok: true; fromUserId: string | null }
    | { ok: false; error: 'club_not_found' | 'target_not_member' | 'already_owner' };

  export function transferOwnership(
    db: DB,
    input: { clubId: string; toUserId: string; actorId: string },
  ): Promise<TransferOwnershipResult>;

  export type ClubAdminDetail = {
    club: typeof clubs.$inferSelect;
    reviewedByName: string | null;
    owners: { userId: string; name: string; email: string }[];
    memberCounts: { pending: number; approved: number; rejected: number; banned: number };
    transferCandidates: { userId: string; name: string; email: string }[];
    boatCount: number;
    windowCount: number;
  };

  export function getClubAdminDetail(db: DbOrTx, clubId: string): Promise<ClubAdminDetail | null>;
  ```
- Task 9 links each clubs-list row to `/admin/clubs/${club.id}`.

**Keyed by id, not slug (spec §6.1).** Task 1 made slugs non-unique across rejected rows, so a slug-keyed admin route would be ambiguous for exactly the clubs an admin most needs to inspect. `clubs.id` is a uuid primary key and always resolves to one row.

**Transfer, not invitation (spec §6.3).** `memberships.role` is currently only ever written at insert time — no `setRole` exists anywhere — so a club whose owner leaves cannot be reassigned by anyone today. The target **must already be an approved member of that club**. Promoting a stranger would be an invitation flow, which is explicitly deferred (spec §7). The demote-then-promote runs in one transaction so the club is never ownerless and never has two owners; this cycle does not introduce multiple owners.

- [ ] **Step 1: Write the failing library tests**

Append to `src/lib/clubs-admin.integration.test.ts`:

```ts
  it('transfers ownership, leaving exactly one owner, and audits club.transfer_owner', async () => {
    const admin = await mkUser();
    const oldOwner = await mkUser();
    const newOwner = await mkUser();
    const [club] = await db.insert(schema.clubs).values({ slug: `to-${Date.now()}`, name: 'To', status: 'active' }).returning();
    await db.insert(schema.memberships).values([
      { userId: oldOwner.id, clubId: club.id, role: 'owner', status: 'approved' },
      { userId: newOwner.id, clubId: club.id, role: 'member', status: 'approved' },
    ]);

    expect(await transferOwnership(db, { clubId: club.id, toUserId: newOwner.id, actorId: admin.id }))
      .toMatchObject({ ok: true, fromUserId: oldOwner.id });

    const rows = await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, club.id));
    const owners = rows.filter((m) => m.role === 'owner');
    expect(owners).toHaveLength(1);
    expect(owners[0].userId).toBe(newOwner.id);
    expect(rows.find((m) => m.userId === oldOwner.id)?.role).toBe('member');

    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    const entry = audit.find((a) => a.action === 'club.transfer_owner');
    expect(entry?.target).toBe(newOwner.id);
    expect(entry?.actingAsRole).toBe('admin');
  });

  it('refuses a target who is not an approved member, and leaves the owner in place', async () => {
    const admin = await mkUser();
    const oldOwner = await mkUser();
    const stranger = await mkUser();
    const pendingMember = await mkUser();
    const [club] = await db.insert(schema.clubs).values({ slug: `tn-${Date.now()}`, name: 'Tn', status: 'active' }).returning();
    await db.insert(schema.memberships).values([
      { userId: oldOwner.id, clubId: club.id, role: 'owner', status: 'approved' },
      { userId: pendingMember.id, clubId: club.id, role: 'member', status: 'pending' },
    ]);

    expect(await transferOwnership(db, { clubId: club.id, toUserId: stranger.id, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'target_not_member' });
    expect(await transferOwnership(db, { clubId: club.id, toUserId: pendingMember.id, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'target_not_member' });

    const rows = await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, club.id));
    expect(rows.filter((m) => m.role === 'owner').map((m) => m.userId)).toEqual([oldOwner.id]);
  });

  it('rolls the transfer back when the audit insert fails', async () => {
    const oldOwner = await mkUser();
    const newOwner = await mkUser();
    const [club] = await db.insert(schema.clubs).values({ slug: `tr-${Date.now()}`, name: 'Tr', status: 'active' }).returning();
    await db.insert(schema.memberships).values([
      { userId: oldOwner.id, clubId: club.id, role: 'owner', status: 'approved' },
      { userId: newOwner.id, clubId: club.id, role: 'member', status: 'approved' },
    ]);

    await expect(transferOwnership(db, { clubId: club.id, toUserId: newOwner.id, actorId: 'no-such-user' }))
      .rejects.toThrow();

    const rows = await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, club.id));
    expect(rows.filter((m) => m.role === 'owner').map((m) => m.userId)).toEqual([oldOwner.id]);
  });

  it('getClubAdminDetail reports owners, member counts and transfer candidates', async () => {
    const owner = await mkUser();
    const approved = await mkUser();
    const pending = await mkUser();
    const [club] = await db.insert(schema.clubs).values({ slug: `gd-${Date.now()}`, name: 'Gd', status: 'active' }).returning();
    await db.insert(schema.memberships).values([
      { userId: owner.id, clubId: club.id, role: 'owner', status: 'approved' },
      { userId: approved.id, clubId: club.id, role: 'member', status: 'approved' },
      { userId: pending.id, clubId: club.id, role: 'member', status: 'pending' },
    ]);

    const detail = await getClubAdminDetail(db, club.id);
    expect(detail).not.toBeNull();
    expect(detail?.owners.map((o) => o.userId)).toEqual([owner.id]);
    expect(detail?.memberCounts).toMatchObject({ approved: 2, pending: 1 });
    // Candidates are approved non-owners only: the current owner and the pending
    // member must not be offered as transfer targets.
    expect(detail?.transferCandidates.map((c) => c.userId)).toEqual([approved.id]);
  });

  it('getClubAdminDetail returns null for an unknown id', async () => {
    expect(await getClubAdminDetail(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
```

Add `getClubAdminDetail` and `transferOwnership` to the import on line 9.

- [ ] **Step 2: Run and confirm they fail**

```bash
pnpm test:integration -- src/lib/clubs-admin.integration.test.ts
```

Expected: FAIL — neither function is exported.

- [ ] **Step 3: Implement `transferOwnership`**

Append to `src/lib/clubs-admin.ts`:

```ts
export type TransferOwnershipResult =
  | { ok: true; fromUserId: string | null }
  | { ok: false; error: 'club_not_found' | 'target_not_member' | 'already_owner' };

/**
 * Move ownership of a club to an existing approved member.
 *
 * A TRANSFER, not an invitation: the target must already be an approved member
 * of this club. Promoting a stranger is the invitation flow, deferred (spec §7).
 *
 * Demote-then-promote in ONE transaction, so the club is never observed
 * ownerless and never observed with two owners — this cycle does not introduce
 * multiple owners. Until now `memberships.role` was only ever written at insert
 * time, so a club whose owner left could not be reassigned by anyone (spec §6.3).
 */
export async function transferOwnership(
  db: DB,
  input: { clubId: string; toUserId: string; actorId: string },
): Promise<TransferOwnershipResult> {
  return db.transaction(async (tx) => {
    const [club] = await tx.select({ id: clubs.id }).from(clubs).where(eq(clubs.id, input.clubId)).limit(1);
    if (!club) return { ok: false, error: 'club_not_found' };

    const [target] = await tx
      .select({ id: memberships.id, role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.clubId, input.clubId), eq(memberships.userId, input.toUserId)))
      .limit(1);
    if (!target || target.status !== 'approved') return { ok: false, error: 'target_not_member' };
    if (target.role === 'owner') return { ok: false, error: 'already_owner' };

    const demoted = await tx.update(memberships).set({ role: 'member' })
      .where(and(eq(memberships.clubId, input.clubId), eq(memberships.role, 'owner')))
      .returning({ userId: memberships.userId });
    await tx.update(memberships).set({ role: 'owner' }).where(eq(memberships.id, target.id));

    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: 'club.transfer_owner',
      target: input.toUserId,
      actingAsRole: 'admin',
    });
    return { ok: true, fromUserId: demoted[0]?.userId ?? null };
  });
}
```

- [ ] **Step 4: Implement `getClubAdminDetail`**

Append to `src/lib/clubs-admin.ts`, extending the imports with `asc`, `count`-style `sql`, `boatTypes`, `scheduleWindows`, `user` and `DbOrTx`:

```ts
export type ClubAdminDetail = {
  club: typeof clubs.$inferSelect;
  reviewedByName: string | null;
  owners: { userId: string; name: string; email: string }[];
  memberCounts: { pending: number; approved: number; rejected: number; banned: number };
  transferCandidates: { userId: string; name: string; email: string }[];
  boatCount: number;
  windowCount: number;
};

/** Everything `/admin/clubs/[id]` renders, in one place, keyed by id (spec §6.1). */
export async function getClubAdminDetail(db: DbOrTx, clubId: string): Promise<ClubAdminDetail | null> {
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId)).limit(1);
  if (!club) return null;

  const people = await db
    .select({ userId: memberships.userId, name: user.name, email: user.email, role: memberships.role, status: memberships.status })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.clubId, clubId))
    .orderBy(asc(user.name));

  const memberCounts = { pending: 0, approved: 0, rejected: 0, banned: 0 };
  for (const p of people) memberCounts[p.status] += 1;

  const [boats] = await db.select({ n: sql<number>`count(*)::int` }).from(boatTypes).where(eq(boatTypes.clubId, clubId));
  const [windows] = await db.select({ n: sql<number>`count(*)::int` }).from(scheduleWindows).where(eq(scheduleWindows.clubId, clubId));

  let reviewedByName: string | null = null;
  if (club.reviewedBy) {
    const [reviewer] = await db.select({ name: user.name }).from(user).where(eq(user.id, club.reviewedBy)).limit(1);
    reviewedByName = reviewer?.name ?? null;
  }

  return {
    club,
    reviewedByName,
    owners: people.filter((p) => p.role === 'owner').map(({ userId, name, email }) => ({ userId, name, email })),
    memberCounts,
    // Approved non-owners only — `transferOwnership` refuses anyone else, so
    // offering them here would only produce a guaranteed error toast.
    transferCandidates: people
      .filter((p) => p.role !== 'owner' && p.status === 'approved')
      .map(({ userId, name, email }) => ({ userId, name, email })),
    boatCount: boats?.n ?? 0,
    windowCount: windows?.n ?? 0,
  };
}
```

- [ ] **Step 5: Run the library tests to verify they pass**

```bash
pnpm test:integration -- src/lib/clubs-admin.integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add the message keys to both files**

`messages/en.json` under `admin`:

```json
"statusRejected": "Rejected",
"detailBack": "All clubs",
"detailOwners": "Owners",
"detailNoOwner": "This club has no owner.",
"detailMembers": "Members",
"detailBoats": "Boats",
"detailWindows": "Schedule windows",
"detailReviewedBy": "Reviewed by {name}",
"detailReviewNote": "Review note",
"detailRecentAudit": "Recent activity",
"transferTitle": "Transfer ownership",
"transferSelect": "New owner",
"transferCta": "Transfer",
"transferNoCandidates": "No approved members are available to take ownership.",
"confirmTransferTitle": "Make {name} the owner of {club}?",
"confirmTransferBody": "The current owner is demoted to member. This club will still have exactly one owner.",
"transferred": "Ownership transferred.",
"transferErrorNotMember": "That person is not an approved member of this club.",
"transferErrorAlreadyOwner": "That person is already the owner."
```

`messages/tr.json` under `admin`:

```json
"statusRejected": "Reddedildi",
"detailBack": "Tüm kulüpler",
"detailOwners": "Yöneticiler",
"detailNoOwner": "Bu kulübün yöneticisi yok.",
"detailMembers": "Üyeler",
"detailBoats": "Tekneler",
"detailWindows": "Program aralıkları",
"detailReviewedBy": "İnceleyen: {name}",
"detailReviewNote": "İnceleme notu",
"detailRecentAudit": "Son işlemler",
"transferTitle": "Yöneticiliği devret",
"transferSelect": "Yeni yönetici",
"transferCta": "Devret",
"transferNoCandidates": "Yöneticiliği devralabilecek onaylı üye yok.",
"confirmTransferTitle": "{club} kulübünün yöneticiliği {name} kişisine verilsin mi?",
"confirmTransferBody": "Mevcut yönetici üyeliğe düşürülecek. Kulübün yine tek bir yöneticisi olacak.",
"transferred": "Yöneticilik devredildi.",
"transferErrorNotMember": "Bu kişi kulübün onaylı üyesi değil.",
"transferErrorAlreadyOwner": "Bu kişi zaten yönetici."
```

- [ ] **Step 7: Write the transfer server action**

Create `app/admin/clubs/[id]/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { transferOwnership } from '@/lib/clubs-admin';
import { requireAdmin } from '@/lib/session';

export type TransferOwnerState =
  | { ok: true }
  | { ok: false; error: 'target_not_member' | 'already_owner' | 'failed' };

export async function transferOwnershipAction(
  clubId: string,
  _prev: TransferOwnerState | null,
  formData: FormData,
): Promise<TransferOwnerState> {
  const admin = await requireAdmin();
  const toUserId = String(formData.get('toUserId') ?? '');
  if (!toUserId) return { ok: false, error: 'failed' };
  let res;
  try {
    res = await transferOwnership(db, { clubId, toUserId, actorId: admin.id });
  } catch {
    return { ok: false, error: 'failed' };
  }
  if (!res.ok) return { ok: false, error: res.error === 'club_not_found' ? 'failed' : res.error };
  revalidatePath(`/admin/clubs/${clubId}`);
  return { ok: true };
}
```

- [ ] **Step 8: Write the failing component test**

Create `app/admin/clubs/[id]/transfer-owner.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => ({ transferOwnershipAction: vi.fn() }));

import { transferOwnershipAction } from './actions';
import { TransferOwner } from './transfer-owner';

const candidates = [
  { userId: 'u1', name: 'Ada', email: 'ada@example.com' },
  { userId: 'u2', name: 'Bora', email: 'bora@example.com' },
];

describe('TransferOwner', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('confirms with both the new owner and the club named before submitting', async () => {
    render(<TransferOwner clubId="c1" clubName="Boğaziçi" candidates={candidates} />);

    fireEvent.change(screen.getByLabelText('transferSelect'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'transferCta' }));

    expect(transferOwnershipAction).not.toHaveBeenCalled();
    expect(await screen.findByText('confirmTransferTitle:{"name":"Bora","club":"Boğaziçi"}')).toBeInTheDocument();
  });

  it('renders the empty state instead of a control when nobody is eligible', () => {
    render(<TransferOwner clubId="c1" clubName="Boğaziçi" candidates={[]} />);
    expect(screen.getByText('transferNoCandidates')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'transferCta' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Run and confirm it fails**

```bash
pnpm vitest run "app/admin/clubs/[id]/transfer-owner.test.tsx"
```

Expected: FAIL — cannot resolve `./transfer-owner`.

- [ ] **Step 10: Implement the transfer control**

Create `app/admin/clubs/[id]/transfer-owner.tsx`. It uses a native `<select>` rather than the shadcn `Select`: this control lives inside a confirmation `<form>` whose value must be readable from `FormData`, and a native select is both simpler and directly assertable in jsdom.

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { transferOwnershipAction, type TransferOwnerState } from './actions';

export type TransferCandidate = { userId: string; name: string; email: string };

/**
 * Ownership transfer is irreversible without a second transfer, and it demotes
 * a real person, so it goes behind a confirmation naming BOTH the new owner and
 * the club — an admin looking at a list of clubs must not be able to reassign
 * the wrong one from muscle memory.
 */
export function TransferOwner({ clubId, clubName, candidates }: {
  clubId: string;
  clubName: string;
  candidates: TransferCandidate[];
}) {
  const t = useTranslations('admin');
  const [selected, setSelected] = useState(candidates[0]?.userId ?? '');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<TransferOwnerState | null, FormData>(
    transferOwnershipAction.bind(null, clubId),
    null,
  );
  const handled = useRef<TransferOwnerState | null>(null);

  useEffect(() => {
    if (state === null || state === handled.current) return;
    handled.current = state;
    setOpen(false);
    if (state.ok) toast.success(t('transferred'));
    else if (state.error === 'target_not_member') toast.error(t('transferErrorNotMember'));
    else if (state.error === 'already_owner') toast.error(t('transferErrorAlreadyOwner'));
    else toast.error(t('actionError'));
  }, [state, t]);

  if (candidates.length === 0) return <p className="text-sm text-muted-foreground">{t('transferNoCandidates')}</p>;

  const chosen = candidates.find((c) => c.userId === selected) ?? candidates[0];

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t('transferSelect')}</span>
        <select
          aria-label={t('transferSelect')}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {candidates.map((c) => (
            <option key={c.userId} value={c.userId}>{c.name} — {c.email}</option>
          ))}
        </select>
      </label>
      <Button size="sm" onClick={() => setOpen(true)}>{t('transferCta')}</Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={formAction}>
            <input type="hidden" name="toUserId" value={chosen.userId} />
            <DialogHeader>
              <DialogTitle>{t('confirmTransferTitle', { name: chosen.name, club: clubName })}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{t('confirmTransferBody')}</p>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>{t('cancel')}</DialogClose>
              <PendingButton>{t('transferCta')}</PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

If the dialog's `PendingButton` and the trigger collide on the accessible name `transferCta` in the test, give the dialog submit its own key (`confirmTransferCta`, added to both message files) and select on that.

- [ ] **Step 11: Build the detail page**

Create `app/admin/clubs/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { type BadgeTone, StatusPill } from '@/components/booking-status-badge';
import { Card } from '@/components/ui/card';
import { db } from '@/db';
import { listAuditRows } from '@/lib/audit';
import { getClubAdminDetail } from '@/lib/clubs-admin';

import { AuditTable } from '../../audit/audit-table';
import { ClubStatusButton } from '../../club-status-button';
import { TransferOwner } from './transfer-owner';

export const metadata = { robots: { index: false, follow: false } };

const toneByStatus: Record<string, BadgeTone> = {
  active: 'ok', pending: 'warn', suspended: 'bad', rejected: 'neutral',
};

export default async function AdminClubDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getClubAdminDetail(db, id);
  if (!detail) notFound();
  const t = await getTranslations('admin');
  const locale = await getLocale();
  const { rows } = await listAuditRows(db, { filters: { clubId: id }, limit: 20 });

  const statusLabel: Record<string, string> = {
    active: t('statusActive'), pending: t('statusPending'),
    suspended: t('statusSuspended'), rejected: t('statusRejected'),
  };
  const { club } = detail;
  const decided = club.status === 'active' || club.status === 'suspended';

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin" className="text-sm text-brand hover:underline">{t('detailBack')}</Link>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-heading text-lg font-semibold">{club.name}</span>
            <span className="text-sm text-muted-foreground">{club.slug}</span>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill tone={toneByStatus[club.status] ?? 'neutral'}>{statusLabel[club.status]}</StatusPill>
            {/* Only a DECIDED club can be suspended or reinstated — a pending one is
                decided on /admin/requests, and a rejection is final (spec §5.3). */}
            {decided && (
              <ClubStatusButton
                clubId={club.id}
                targetStatus={club.status === 'active' ? 'suspended' : 'active'}
                label={club.status === 'active' ? t('suspend') : t('activate')}
              />
            )}
          </div>
        </div>
        {detail.reviewedByName && (
          <p className="text-xs text-muted-foreground">{t('detailReviewedBy', { name: detail.reviewedByName })}</p>
        )}
        {club.reviewNote && (
          <p className="text-sm"><span className="text-muted-foreground">{t('detailReviewNote')}: </span>{club.reviewNote}</p>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="font-heading text-sm font-semibold">{t('detailOwners')}</h2>
        {detail.owners.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detailNoOwner')}</p>
        ) : (
          <ul className="text-sm">
            {detail.owners.map((o) => <li key={o.userId}>{o.name} — {o.email}</li>)}
          </ul>
        )}
        <h2 className="mt-3 font-heading text-sm font-semibold">{t('transferTitle')}</h2>
        <TransferOwner clubId={club.id} clubName={club.name} candidates={detail.transferCandidates} />
      </Card>

      <Card className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
        <div><div className="text-muted-foreground">{t('detailMembers')}</div><div>{detail.memberCounts.approved} / {detail.memberCounts.pending} / {detail.memberCounts.banned}</div></div>
        <div><div className="text-muted-foreground">{t('detailBoats')}</div><div>{detail.boatCount}</div></div>
        <div><div className="text-muted-foreground">{t('detailWindows')}</div><div>{detail.windowCount}</div></div>
      </Card>

      <section>
        <h2 className="mb-3 font-heading text-sm font-semibold">{t('detailRecentAudit')}</h2>
        <AuditTable
          rows={rows}
          locale={locale}
          timeZone={club.timezone}
          labels={{
            when: t('auditWhen'), actor: t('auditActor'), club: t('auditClub'),
            action: t('auditAction'), target: t('auditTarget'),
            empty: t('auditEmpty'), unknown: t('auditUnknown'),
          }}
        />
      </section>
    </div>
  );
}
```

The member counts render as `approved / pending / banned`; if a clearer layout is wanted, keep the same three numbers and the same three keys.

- [ ] **Step 12: Run the component test to verify it passes**

```bash
pnpm vitest run "app/admin/clubs/[id]/transfer-owner.test.tsx"
```

Expected: PASS, both.

- [ ] **Step 13: Prove the tests fail when the implementation is reverted**

Mutation 1 — **the demote step dropped.** Delete the `tx.update(memberships).set({ role: 'member' })` statement and re-run the library suite. Expected: FAIL on `transfers ownership, leaving exactly one owner` (two owners). Restore.

Mutation 2 — **the approved-member check weakened.** Change `if (!target || target.status !== 'approved')` to `if (!target)` and re-run. Expected: FAIL on `refuses a target who is not an approved member` (the pending member is promoted). Restore.

Mutation 3 — **the confirmation dialog bypassed.** Make the trigger `<Button>` submit the form directly and re-run the component test. Expected: FAIL on `confirms with both the new owner and the club named before submitting`. Restore.

Mutation 4 — **candidates unfiltered.** Change `getClubAdminDetail`'s `transferCandidates` filter to `people.map(...)` and re-run the library suite. Expected: FAIL on `reports owners, member counts and transfer candidates`. Restore.

- [ ] **Step 14: Verify and commit**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm vitest run && pnpm test:integration
```

```bash
git add src/lib/clubs-admin.ts src/lib/clubs-admin.integration.test.ts "app/admin/clubs/[id]/" messages/en.json messages/tr.json
git commit -m "feat(admin): add ownership transfer and the club detail page"
```

---

### Task 9: Clubs list search + pagination, and the requests page rebuilt around approve / reject

**Files:**
- Modify: `src/lib/clubs-admin.ts` (add `listClubsForAdmin`, `listPendingClubRequests`)
- Modify: `src/lib/clubs-admin.integration.test.ts`
- Modify: `app/admin/page.tsx` (search, pagination, link to detail)
- Rewrite: `app/admin/requests/page.tsx`
- Create: `app/admin/requests/actions.ts`
- Create: `app/admin/requests/decision-buttons.tsx`
- Create: `app/admin/requests/decision-buttons.test.tsx`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `decideClubRequest` (Task 2), `notifyClubDecision` (Task 3), `AdminPagination` (Task 7), `getClubAdminDetail` route from Task 8.
- Produces:
  ```ts
  export const CLUBS_PAGE_SIZE = 25;

  export type AdminClubRow = { id: string; slug: string; name: string; status: 'pending' | 'active' | 'suspended' | 'rejected'; createdAt: Date; memberCount: number };

  export function listClubsForAdmin(
    db: DbOrTx,
    opts: { q?: string; page?: number; pageSize?: number },
  ): Promise<{ rows: AdminClubRow[]; total: number; page: number; pageSize: number }>;

  export type PendingClubRequest = { id: string; slug: string; name: string; createdAt: Date; requesterName: string | null; requesterEmail: string | null };

  export function listPendingClubRequests(db: DbOrTx): Promise<PendingClubRequest[]>;
  ```

**The unbounded select is the bug being fixed (spec §6.4).** `app/admin/page.tsx:25` is `db.select().from(clubs)` with no limit. Every list page in this cycle takes a search term and a page, and none may issue an unbounded select — including this one.

**The requests page stops sharing `ClubStatusButton`.** Today `/admin/requests` renders the *same component* as the un-suspend control on `/admin`, with the same `targetStatus="active"`, which is why approving a new club and reinstating a suspended one are indistinguishable in the audit trail (spec §1). After this task the requests page has its own control pair, backed by `decideClubRequest`, and `ClubStatusButton` no longer appears on it. Rejection requires a note; approval takes an optional one.

- [ ] **Step 1: Write the failing list-query tests**

Append to `src/lib/clubs-admin.integration.test.ts`:

```ts
  it('listClubsForAdmin searches case-insensitively on name and slug, and paginates', async () => {
    const stamp = `lc${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await db.insert(schema.clubs).values({ slug: `${stamp}-${i}`, name: `Club ${stamp} ${i}`, status: 'active' });
    }
    const first = await listClubsForAdmin(db, { q: stamp.toUpperCase(), page: 1, pageSize: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.total).toBe(3);
    const second = await listClubsForAdmin(db, { q: stamp, page: 2, pageSize: 2 });
    expect(second.rows).toHaveLength(1);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(3);
  });

  it('listClubsForAdmin never returns more rows than the page size', async () => {
    const { rows } = await listClubsForAdmin(db, { pageSize: 3 });
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it('listPendingClubRequests returns only pending clubs, with the requester attached', async () => {
    const requester = await mkUser();
    const stamp = Date.now();
    const [pendingClub] = await db.insert(schema.clubs)
      .values({ slug: `pq-${stamp}`, name: 'Pending Q', status: 'pending', createdBy: requester.id }).returning();
    await db.insert(schema.clubs).values({ slug: `aq-${stamp}`, name: 'Active Q', status: 'active' });
    await db.insert(schema.clubs).values({ slug: `rq-${stamp}`, name: 'Rejected Q', status: 'rejected' });

    const rows = await listPendingClubRequests(db);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(pendingClub.id);
    expect(rows.find((r) => r.id === pendingClub.id)?.requesterEmail).toBe(requester.email);
    expect(rows.every((r) => r.name !== 'Active Q' && r.name !== 'Rejected Q')).toBe(true);
  });

  it('listPendingClubRequests keeps a request whose requester account is gone', async () => {
    const requester = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `orph-${Date.now()}`, name: 'Orphaned Request', status: 'pending', createdBy: requester.id }).returning();
    await db.delete(schema.user).where(eq(schema.user.id, requester.id));

    const rows = await listPendingClubRequests(db);
    const hit = rows.find((r) => r.id === club.id);
    expect(hit).toBeDefined();
    expect(hit?.requesterEmail).toBeNull();
  });
```

The last test is the same `on delete set null` hazard as the audit viewer: `created_by` is nullable, so an inner join would drop the request from the queue entirely and it could never be decided.

- [ ] **Step 2: Run and confirm they fail**

```bash
pnpm test:integration -- src/lib/clubs-admin.integration.test.ts
```

Expected: FAIL — neither list function is exported.

- [ ] **Step 3: Implement the two list queries**

Append to `src/lib/clubs-admin.ts`:

```ts
export const CLUBS_PAGE_SIZE = 25;

export type AdminClubRow = {
  id: string;
  slug: string;
  name: string;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  createdAt: Date;
  memberCount: number;
};

/**
 * Paged, searchable club list. Replaces the unbounded `db.select().from(clubs)`
 * the admin index used to run (spec §6.4) — no list page in the console may issue
 * an unbounded select.
 */
export async function listClubsForAdmin(
  db: DbOrTx,
  opts: { q?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: AdminClubRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = opts.pageSize ?? CLUBS_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim();
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where = pattern ? or(ilike(clubs.name, pattern), ilike(clubs.slug, pattern)) : undefined;

  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(clubs).where(where);

  const rows = await db
    .select({
      id: clubs.id,
      slug: clubs.slug,
      name: clubs.name,
      status: clubs.status,
      createdAt: clubs.createdAt,
      memberCount: sql<number>`(select count(*)::int from ${memberships} where ${memberships.clubId} = ${clubs.id})`,
    })
    .from(clubs)
    .where(where)
    .orderBy(desc(clubs.createdAt), desc(clubs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total: countRow?.n ?? 0, page, pageSize };
}

export type PendingClubRequest = {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
  requesterName: string | null;
  requesterEmail: string | null;
};

/**
 * The requests queue. LEFT join on the requester: `created_by` is
 * `on delete set null`, and a request whose requester deleted their account must
 * still be decidable — an inner join would strand it in the queue forever.
 */
export async function listPendingClubRequests(db: DbOrTx): Promise<PendingClubRequest[]> {
  return db
    .select({
      id: clubs.id,
      slug: clubs.slug,
      name: clubs.name,
      createdAt: clubs.createdAt,
      requesterName: user.name,
      requesterEmail: user.email,
    })
    .from(clubs)
    .leftJoin(user, eq(user.id, clubs.createdBy))
    .where(eq(clubs.status, 'pending'))
    .orderBy(desc(clubs.createdAt));
}
```

Extend the file's drizzle-orm import to `import { and, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';` and its schema import to include `memberships` and `user` (both already imported) plus nothing else.

- [ ] **Step 4: Run the list tests to verify they pass**

```bash
pnpm test:integration -- src/lib/clubs-admin.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add the message keys to both files**

`messages/en.json` under `admin`:

```json
"clubsSearch": "Search clubs by name or slug",
"clubsSearchCta": "Search",
"clubsMemberCount": "{count} members",
"requestBy": "Requested by {name}",
"requestByUnknown": "Requester account deleted",
"approve": "Approve",
"reject": "Reject",
"approveNote": "Note (optional)",
"rejectNote": "Reason (required)",
"confirmApproveTitle": "Approve {club}?",
"confirmApproveBody": "The club goes live immediately and the requester is emailed.",
"confirmRejectTitle": "Reject {club}?",
"confirmRejectBody": "The requester is emailed with your reason. The slug becomes available again for a new request.",
"approved": "Club approved.",
"rejected": "Club request rejected.",
"errorNoteRequired": "A reason is required when rejecting.",
"errorNotPending": "This request has already been decided."
```

`messages/tr.json` under `admin`:

```json
"clubsSearch": "Kulüpleri ada veya slug'a göre ara",
"clubsSearchCta": "Ara",
"clubsMemberCount": "{count} üye",
"requestBy": "İsteyen: {name}",
"requestByUnknown": "İstek sahibinin hesabı silinmiş",
"approve": "Onayla",
"reject": "Reddet",
"approveNote": "Not (isteğe bağlı)",
"rejectNote": "Gerekçe (zorunlu)",
"confirmApproveTitle": "{club} onaylansın mı?",
"confirmApproveBody": "Kulüp anında yayına alınır ve isteği yapan kişiye e-posta gönderilir.",
"confirmRejectTitle": "{club} reddedilsin mi?",
"confirmRejectBody": "İsteği yapan kişiye gerekçenle birlikte e-posta gönderilir. Slug yeni bir istek için tekrar kullanılabilir olur.",
"approved": "Kulüp onaylandı.",
"rejected": "Kulüp isteği reddedildi.",
"errorNoteRequired": "Reddederken gerekçe zorunludur.",
"errorNotPending": "Bu istek zaten karara bağlanmış."
```

- [ ] **Step 6: Write the decision server action**

Create `app/admin/requests/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { decideClubRequest } from '@/lib/clubs-admin';
import { notifyClubDecision } from '@/lib/notify';
import { requireAdmin } from '@/lib/session';

export type DecideState =
  | { ok: true; decision: 'approve' | 'reject' }
  | { ok: false; error: 'note_required' | 'not_pending' | 'failed' };

export async function decideClubRequestAction(
  _prev: DecideState | null,
  formData: FormData,
): Promise<DecideState> {
  const admin = await requireAdmin();
  const clubId = String(formData.get('clubId'));
  const decision = String(formData.get('decision')) === 'approve' ? 'approve' : 'reject';
  const note = String(formData.get('note') ?? '');

  let res;
  try {
    res = await decideClubRequest(db, { clubId, decision, note, actorId: admin.id });
  } catch {
    return { ok: false, error: 'failed' };
  }
  if (!res.ok) {
    return { ok: false, error: res.error === 'not_found' ? 'failed' : res.error };
  }

  // AFTER the transaction has committed, and best-effort: `notifyClubDecision`
  // swallows its own errors, so a mail outage cannot undo a decision (spec §5.4).
  await notifyClubDecision(db, {
    clubId,
    decision: decision === 'approve' ? 'approved' : 'rejected',
    note: note.trim() || null,
  });

  revalidatePath('/admin/requests');
  revalidatePath('/admin');
  revalidatePath(`/admin/clubs/${clubId}`);
  return { ok: true, decision };
}
```

- [ ] **Step 7: Add the shadcn Textarea via the CLI**

The reject dialog needs a multi-line note field and `src/components/ui/textarea.tsx` does not exist. Never hand-author it:

```bash
pnpm dlx shadcn@latest add textarea
```

Commit the generated file as-is; do not reformat it (the ESLint config already exempts `src/components/ui/**` from import sorting for exactly this reason).

- [ ] **Step 8: Write the failing component test**

Create `app/admin/requests/decision-buttons.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => ({ decideClubRequestAction: vi.fn() }));

import { decideClubRequestAction } from './actions';
import { DecisionButtons } from './decision-buttons';

describe('DecisionButtons', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('names the club in the approve confirmation and does not submit before it', async () => {
    render(<DecisionButtons clubId="c1" clubName="Boğaziçi" />);
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    expect(decideClubRequestAction).not.toHaveBeenCalled();
    expect(await screen.findByText('confirmApproveTitle:{"club":"Boğaziçi"}')).toBeInTheDocument();
  });

  it('names the club in the reject confirmation and requires a note', async () => {
    render(<DecisionButtons clubId="c1" clubName="Boğaziçi" />);
    fireEvent.click(screen.getByRole('button', { name: 'reject' }));
    expect(await screen.findByText('confirmRejectTitle:{"club":"Boğaziçi"}')).toBeInTheDocument();
    // The note field is `required`, so an empty reject cannot even be submitted.
    expect(screen.getByLabelText('rejectNote')).toBeRequired();
  });
});
```

- [ ] **Step 9: Run and confirm it fails**

```bash
pnpm vitest run "app/admin/requests/decision-buttons.test.tsx"
```

Expected: FAIL — cannot resolve `./decision-buttons`.

- [ ] **Step 10: Implement the decision controls**

Create `app/admin/requests/decision-buttons.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

import { decideClubRequestAction, type DecideState } from './actions';

/**
 * The approve/reject pair for one club request. Deliberately NOT `ClubStatusButton`:
 * that component is the suspend/reinstate control, and sharing it is what made
 * approving a new club indistinguishable from un-suspending an old one in the
 * audit trail (spec §1, §5.3).
 *
 * Both decisions are irreversible — a decided request cannot return to `pending` —
 * so both go behind a confirmation naming the club.
 */
export function DecisionButtons({ clubId, clubName }: { clubId: string; clubName: string }) {
  const t = useTranslations('admin');
  const [pendingDecision, setPendingDecision] = useState<'approve' | 'reject' | null>(null);
  const [state, formAction] = useActionState<DecideState | null, FormData>(decideClubRequestAction, null);
  const handled = useRef<DecideState | null>(null);

  useEffect(() => {
    if (state === null || state === handled.current) return;
    handled.current = state;
    setPendingDecision(null);
    if (state.ok) toast.success(state.decision === 'approve' ? t('approved') : t('rejected'));
    else if (state.error === 'note_required') toast.error(t('errorNoteRequired'));
    else if (state.error === 'not_pending') toast.error(t('errorNotPending'));
    else toast.error(t('actionError'));
  }, [state, t]);

  const rejecting = pendingDecision === 'reject';

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => setPendingDecision('approve')}>{t('approve')}</Button>
      <Button size="sm" variant="destructive" onClick={() => setPendingDecision('reject')}>{t('reject')}</Button>

      <Dialog open={pendingDecision !== null} onOpenChange={(open) => { if (!open) setPendingDecision(null); }}>
        <DialogContent>
          {pendingDecision && (
            <form action={formAction}>
              <input type="hidden" name="clubId" value={clubId} />
              <input type="hidden" name="decision" value={pendingDecision} />
              <DialogHeader>
                <DialogTitle>
                  {rejecting ? t('confirmRejectTitle', { club: clubName }) : t('confirmApproveTitle', { club: clubName })}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {rejecting ? t('confirmRejectBody') : t('confirmApproveBody')}
              </p>
              <label className="mt-3 flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{rejecting ? t('rejectNote') : t('approveNote')}</span>
                {/* `required` on reject is the client half; `decideClubRequest`
                    refuses an empty note server-side regardless (spec §5.1). */}
                <Textarea name="note" rows={3} required={rejecting} aria-label={rejecting ? t('rejectNote') : t('approveNote')} />
              </label>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="ghost" />}>{t('cancel')}</DialogClose>
                <PendingButton variant={rejecting ? 'destructive' : 'default'}>
                  {rejecting ? t('reject') : t('approve')}
                </PendingButton>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

If the trigger and the dialog submit collide on the accessible names `approve` / `reject` in the test, add `confirmApproveCta` / `confirmRejectCta` keys to both message files and use them on the `PendingButton`.

- [ ] **Step 11: Rewrite the requests page**

Replace `app/admin/requests/page.tsx` entirely:

```tsx
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { StatusPill } from '@/components/booking-status-badge';
import { Card } from '@/components/ui/card';
import { db } from '@/db';
import { listPendingClubRequests } from '@/lib/clubs-admin';

import { DecisionButtons } from './decision-buttons';

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminClubRequestsPage() {
  const t = await getTranslations('admin');
  const rows = await listPendingClubRequests(db);
  if (rows.length === 0) return <p className="text-muted-foreground">{t('noRequests')}</p>;
  return (
    <Card className="gap-0 divide-y divide-border py-0">
      {rows.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-col gap-0.5">
            <Link href={`/admin/clubs/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
            <span className="text-sm text-muted-foreground">{c.slug}</span>
            <span className="text-xs text-muted-foreground">
              {/* `created_by` is `on delete set null` — a request whose requester
                  deleted their account must still be decidable. */}
              {c.requesterEmail
                ? t('requestBy', { name: `${c.requesterName ?? ''} <${c.requesterEmail}>`.trim() })
                : t('requestByUnknown')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill tone="warn">{t('statusPending')}</StatusPill>
            <DecisionButtons clubId={c.id} clubName={c.name} />
          </div>
        </div>
      ))}
    </Card>
  );
}
```

`ClubStatusButton` is now imported by `app/admin/page.tsx` and `app/admin/clubs/[id]/page.tsx` only. Confirm:

```bash
grep -rn "ClubStatusButton" app
```

Expected: the component's own file plus exactly those two pages — **not** `app/admin/requests/`.

- [ ] **Step 12: Rewrite the clubs index around the paged query**

Replace `app/admin/page.tsx`:

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AdminPagination } from '@/components/admin-pagination';
import { type BadgeTone, StatusPill } from '@/components/booking-status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { CLUBS_PAGE_SIZE, listClubsForAdmin } from '@/lib/clubs-admin';

import { ClubStatusButton } from './club-status-button';
import { CreatedToast } from './created-toast';

const toneByStatus: Record<string, BadgeTone> = {
  active: 'ok', pending: 'warn', suspended: 'bad', rejected: 'neutral',
};

export default async function AdminClubsPage({ searchParams }: {
  searchParams: Promise<{ created?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('admin');
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const { rows, total } = await listClubsForAdmin(db, { q, page, pageSize: CLUBS_PAGE_SIZE });
  const from = total === 0 ? 0 : (page - 1) * CLUBS_PAGE_SIZE + 1;
  const to = Math.min(page * CLUBS_PAGE_SIZE, total);

  const statusLabel: Record<string, string> = {
    active: t('statusActive'), pending: t('statusPending'),
    suspended: t('statusSuspended'), rejected: t('statusRejected'),
  };

  return (
    <>
      <CreatedToast created={sp.created === '1'} />
      <form method="get" action="/admin" className="mb-6 flex gap-2">
        <Input name="q" defaultValue={q ?? ''} placeholder={t('clubsSearch')} aria-label={t('clubsSearch')} />
        <Button type="submit" size="sm">{t('clubsSearchCta')}</Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('noClubs')}</p>
      ) : (
        <Card className="gap-0 divide-y divide-border py-0">
          {rows.map((c) => {
            // Only a decided club gets the suspend/reinstate control. A pending
            // club is decided on /admin/requests; a rejection is final (spec §5.3).
            const decided = c.status === 'active' || c.status === 'suspended';
            return (
              <div key={c.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex flex-col gap-0.5">
                  <Link href={`/admin/clubs/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                  <span className="text-sm text-muted-foreground">{c.slug}</span>
                  <span className="text-xs text-muted-foreground">{t('clubsMemberCount', { count: c.memberCount })}</span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill tone={toneByStatus[c.status] ?? 'neutral'}>{statusLabel[c.status]}</StatusPill>
                  {decided && (
                    <ClubStatusButton
                      clubId={c.id}
                      targetStatus={c.status === 'active' ? 'suspended' : 'active'}
                      label={c.status === 'active' ? t('suspend') : t('activate')}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <AdminPagination
        basePath="/admin"
        query={{ q }}
        page={page}
        pageSize={CLUBS_PAGE_SIZE}
        total={total}
        prevLabel={t('paginationPrev')}
        nextLabel={t('paginationNext')}
        rangeLabel={t('paginationRange', { from, to, total })}
      />
    </>
  );
}
```

- [ ] **Step 13: Confirm no unbounded select remains in the console**

```bash
grep -rn "db.select()" app/admin
```

Expected: no output — every read goes through a `src/lib` function that applies a limit.

- [ ] **Step 14: Run the component test to verify it passes**

```bash
pnpm vitest run "app/admin/requests/decision-buttons.test.tsx"
```

Expected: PASS, both.

- [ ] **Step 15: Prove the tests fail when the implementation is reverted**

Mutation 1 — **the `limit` dropped from `listClubsForAdmin`.** Delete `.limit(pageSize).offset(...)` and re-run the library suite. Expected: FAIL on `never returns more rows than the page size` and on the pagination test. Restore.

Mutation 2 — **the requester join changed to `innerJoin`.** Re-run the library suite. Expected: FAIL on `keeps a request whose requester account is gone`. Restore.

Mutation 3 — **the approve confirmation removed.** Make the approve `Button` submit the form directly and re-run the component test. Expected: FAIL on `names the club in the approve confirmation and does not submit before it`. Restore.

Mutation 4 — **`required` removed from the reject note.** Re-run the component test. Expected: FAIL on `requires a note`. Restore.

- [ ] **Step 16: Verify and commit**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm vitest run && pnpm test:integration
```

```bash
git add src/lib/clubs-admin.ts src/lib/clubs-admin.integration.test.ts src/components/ui/textarea.tsx app/admin/ messages/en.json messages/tr.json
git commit -m "feat(admin): paginate and search the clubs list, rebuild requests around approve/reject"
```

---

### Task 10: i18n sweep and the message-key parity test

**Files:**
- Create: `src/i18n/messages-parity.test.ts`
- Modify: `messages/en.json`, `messages/tr.json` (fill any gap the test finds)

**Interfaces:**
- Consumes: every key added in Tasks 2, 3, 6, 7, 8 and 9.
- Produces: nothing other code imports — this is a guard.

**Why this test exists (spec §8).** This cycle adds roughly seventy keys across six commits and two files, and Turkish is the app default. next-intl throws at render time on a missing key, so a Turkish key that was forgotten during an English-first edit becomes a 500 on a page nobody on the team reads in English. A structural equality check catches it in CI in milliseconds.

**Location matters.** It must be `src/i18n/messages-parity.test.ts`, not `messages/parity.test.ts` — vitest's `include` is `['src/**/*.test.ts', 'src/**/*.test.tsx', 'app/**/*.test.tsx']`, so a test at the repo root or under `messages/` would silently never run, which is the same class of failure the test is meant to prevent.

- [ ] **Step 1: Write the failing parity test**

Create `src/i18n/messages-parity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

type Messages = { [key: string]: string | Messages };

/** Every leaf key path, dot-joined and sorted — the shape, independent of the copy. */
function keyPaths(node: Messages, prefix = ''): string[] {
  return Object.entries(node)
    .flatMap(([k, v]) => {
      const path = prefix ? `${prefix}.${k}` : k;
      return typeof v === 'string' ? [path] : keyPaths(v, path);
    })
    .sort();
}

/** Every `{placeholder}` name inside a leaf, so an interpolation cannot be dropped in one locale. */
function placeholders(node: Messages, prefix = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      const names = [...v.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
      if (names.length) out[path] = names;
    } else {
      Object.assign(out, placeholders(v, path));
    }
  }
  return out;
}

describe('message files', () => {
  it('en and tr define exactly the same key paths', () => {
    const enKeys = keyPaths(en as Messages);
    const trKeys = keyPaths(tr as Messages);
    // Reported as two explicit diffs so a failure names the missing keys rather
    // than dumping two 700-line arrays.
    expect(enKeys.filter((k) => !trKeys.includes(k))).toEqual([]);
    expect(trKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it('matching keys use the same interpolation placeholders', () => {
    const enPh = placeholders(en as Messages);
    const trPh = placeholders(tr as Messages);
    const mismatches = Object.keys(enPh)
      .filter((k) => k in trPh)
      .filter((k) => enPh[k].join(',') !== trPh[k].join(','));
    expect(mismatches).toEqual([]);
  });

  it('has no empty message values', () => {
    const empties = (function walk(node: Messages, prefix = ''): string[] {
      return Object.entries(node).flatMap(([k, v]) => {
        const path = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'string') return v.trim() === '' ? [path] : [];
        return walk(v, path);
      });
    })(en as Messages).concat((function walk(node: Messages, prefix = ''): string[] {
      return Object.entries(node).flatMap(([k, v]) => {
        const path = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'string') return v.trim() === '' ? [path] : [];
        return walk(v, path);
      });
    })(tr as Messages));
    expect(empties).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and read the diff**

```bash
pnpm vitest run src/i18n/messages-parity.test.ts
```

Expected: it either passes (if Tasks 2–9 kept both files in step, which is what the Global Constraints require) or FAILS with a list of key paths present in one file and missing from the other.

- [ ] **Step 3: Fill every gap the test reports**

For each path listed in the failure, add the missing key to the file that lacks it. Do not delete the key from the file that has it — every key added in this cycle is used by a rendered component, so deleting one turns a test failure into a runtime 500.

Turkish is the app default. If a Turkish string is what is missing, write real Turkish; do not paste the English string as a placeholder — that ships English copy to every default-locale user and the test would still pass.

- [ ] **Step 4: Verify the whole set of new keys is actually reachable**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm vitest run
```

Then walk the console in the browser with the locale cookie set to `tr` and again to `en`, and confirm no next-intl missing-key error appears on any of: `/admin`, `/admin/requests`, `/admin/users`, `/admin/audit`, `/admin/clubs/new`, and `/admin/clubs/<some id>`.

```bash
pnpm dev
```

- [ ] **Step 5: Commit**

```bash
git add src/i18n/messages-parity.test.ts messages/en.json messages/tr.json
git commit -m "test(i18n): assert en and tr message files stay structurally identical"
```

- [ ] **Step 6: Final full verification across the whole cycle**

```bash
docker compose up -d postgres
pnpm exec tsc --noEmit
pnpm lint
pnpm vitest run
pnpm test:integration
```

All four must be clean. `pnpm vitest run` alone is not sufficient evidence — the integration suites skip themselves without `TEST_DATABASE_URL`, and every atomicity guarantee in Tasks 4, 5, 7 and 8 lives in those suites.

---

## Self-Review

Run this after the plan is executed, before the branch is finished.

**1. Spec coverage.** Walk the spec section by section and name the task that implements it:

| Spec | Task |
|---|---|
| §4.1 `admin` on `membershipRoleEnum` | 1 |
| §4.2 audit table, all 29 action strings | 2 (club.*), 4 (group A), 5 (group B), 7 (user.*), 8 (transfer) |
| §4.3 atomicity + widened `logAudit` | 1 (signature), 4 and 5 (transaction wrapping) |
| §4.4 the viewer, null actor/club, verbatim target | 6 |
| §5.1 `rejected` status + review columns | 1 |
| §5.2 partial unique index + `getClubBySlug` | 1 (one task, deliberately) |
| §5.3 `decideClubRequest`, restricted `setClubStatus` | 2 |
| §5.4 approve/reject email, post-commit, swallowed | 3 |
| §6.1 `/admin/clubs/[id]`, keyed by id | 8 |
| §6.2 `/admin/users`, both guards | 7 |
| §6.3 `transferOwnership` | 8 |
| §6.4 search + pagination, no unbounded select | 7 (users), 9 (clubs), 6 (audit, keyset) |
| §8 testing | every task's test steps; parity check in 10 |

Spec §7 (deferred: owner invitation, impersonation, manual ban/penalty, club deletion) has **no** task, deliberately. If a task grew one, remove it.

**2. Placeholder scan.** Grep the plan for `TBD`, `TODO`, `implement later`, `similar to Task`, `add appropriate`, `handle edge cases`. There should be none. Every code step carries the actual code.

**3. Type consistency.** Confirm these names are identical everywhere they appear across tasks:
- `DbOrTx` (Task 1 → used in 5, 6, 7, 8, 9), `Tx` (Task 1)
- `logAudit(db, entry)` with `actingAsRole?: 'owner' | 'member' | 'admin'` (Task 1 → every later task)
- `findClubBySlug` (Task 1), not `getClubBySlugFor` or similar
- `decideClubRequest` returning `{ ok: true; status; requesterId; clubName; clubSlug }` (Task 2 → consumed in 3 and 9)
- `setClubStatus` returning `SetClubStatusResult`, **not** `void` (Task 2 → consumed in `app/admin/actions.ts` and Task 8's detail page)
- `listAuditRows` / `AuditRow` / `AuditCursor` (Task 6 → consumed in 8)
- `AuditTable` props `{ rows, labels, locale, timeZone }` (Task 6 → same call shape in 8)
- `AdminPagination` props (Task 7 → reused verbatim in 9)
- `transferOwnership` error strings `'club_not_found' | 'target_not_member' | 'already_owner'` (Task 8 → mapped in its action)
- `USERS_PAGE_SIZE` / `CLUBS_PAGE_SIZE` / `AUDIT_PAGE_SIZE` — three separate constants, none reused for another list

**4. The two irreversible hazards.** Confirm both are still true in the merged branch:
- `grep -rn "eq(clubs.slug" src` returns only lookups that also carry `ne(clubs.status, 'rejected')`.
- `grep -rn "as unknown as DB" src app` returns nothing.

**5. Audit completeness.** `grep -rn "action: '" src/lib | grep -o "action: '[a-z_.]*'" | sort -u` returns exactly the 29 strings listed in Global Constraints — no more (invented strings), no fewer (uncovered mutations).
