# Attendance, No-Show Penalties & MultiSport Daily Limit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a club owner record absences from the day roster, turn each absence into a ban under the club's configured policy, enforce it through the existing eligibility gate — and separately, enforce that a MultiSport card takes at most one session per day across all clubs.

**Architecture:** Two independent halves sharing one migration. Half A adds a pure rules module (`penalty.ts`) and a thin transactional core (`attendance.ts`) that marks a booking `no_show`, writes a penalty row, recomputes `memberships.banned_until` as a max over that member's penalty rows, and cancels the member's seats falling inside the ban window (promoting waitlisters). Half B adds a denormalized `bookings.booking_date` plus a partial unique index that makes the database — not application code — the guarantee for the MultiSport daily limit.

**Tech Stack:** Next.js 16 App Router (React 19), Drizzle ORM + Postgres, Vitest (unit + integration against real PG), next-intl, react-email + Resend, Base UI via shadcn `base-nova`, Tailwind 4.

## Global Constraints

Every task's requirements implicitly include this section.

- **Pure-core + thin-adapter.** Core modules in `src/lib/` take `db: DB` first, are `clubId`-scoped on every write, return a discriminated union, and never call `revalidatePath`, `redirect`, or `headers`. Server actions are thin: guard → zod `safeParse` → core → revalidate → toast.
- **Never hand-author or edit `src/components/ui/*`.** Those are shadcn CLI-managed. Custom components go in `src/components/` or the route folder.
- **`club.id` always comes from the guard**, never from client input.
- **Every new test threads an explicit frozen `now`** into any function that accepts one. Never let a test depend on the real clock — a hardcoded date plus a real clock is what silently broke the booking suite when its pinned date passed.
- **Integration tests** use `describe.skipIf(!process.env.TEST_DATABASE_URL)` and run `migrate(db, { migrationsFolder: './drizzle' })` in `beforeAll`. Seed data is tagged with a unique per-run prefix so parallel-safe.
- **i18n:** every new user-visible string gets a key in **both** `messages/en.json` and `messages/tr.json`. Key sets must stay identical.
- **Lint is zero-tolerance:** `pnpm lint` runs `eslint --max-warnings 0`. Import order is enforced.
- **Commits:** conventional-commit subjects. **Never add a `Co-Authored-By` or any AI-attribution trailer.**
- **The test database must be running** for integration tests: `docker compose up -d` (test PG on `localhost:5433`, dev PG on `localhost:5434`).

**Command reference:**

```bash
pnpm lint                                    # eslint --max-warnings 0
pnpm exec tsc --noEmit                       # type check
pnpm test                                    # unit suite (integration auto-skips)
pnpm test:integration                        # full suite incl. integration vs PG :5433
pnpm vitest run src/lib/penalty.test.ts      # one unit file
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test \
  pnpm vitest run --no-file-parallelism src/lib/attendance.integration.test.ts   # one integration file
pnpm db:generate                             # generate a migration from schema changes
pnpm db:migrate                              # apply migrations to the DATABASE_URL database
```

**i18n parity check** (there is no automated test for this — run it by hand):

```bash
node -e "
const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v?flat(v,p+k+'.'):[p+k]);
const en=flat(require('./messages/en.json')), tr=flat(require('./messages/tr.json'));
const miss=(a,b)=>a.filter(k=>!b.includes(k));
console.log('en keys',en.length,'tr keys',tr.length);
console.log('missing in tr:',miss(en,tr)); console.log('missing in en:',miss(tr,en));
"
```

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/lib/penalty.ts` | Pure penalty maths: policy + session start → ban end; max over rows → effective ban |
| `src/lib/penalty.test.ts` | Unit tests for the above |
| `src/lib/pg-errors.ts` | `isUniqueViolation(err, constraintName)` — walks the drizzle error `cause` chain |
| `src/lib/pg-errors.test.ts` | Unit tests for the above |
| `src/lib/attendance.ts` | Transactional `markNoShow` / `undoNoShow` |
| `src/lib/attendance.integration.test.ts` | Integration tests vs real PG |
| `src/emails/no-show-notice.tsx` | Not created — reuses the existing `booking-notice.tsx` template |
| `app/s/[slug]/manage/bookings/attendance-actions.ts` | `markNoShowAction` / `undoNoShowAction` |
| `drizzle/0006_*.sql` | Migration (generated, then hand-edited) |

**Modified**

| File | Change |
|---|---|
| `src/db/schema/bookings.ts` | `bookings.bookingDate` + MultiSport partial unique index; `penalties.bookingId` + `penalties.permanent` + unique index |
| `src/db/schema/bookings.test.ts` | Assertions for the new columns/indexes |
| `src/lib/date-tz.ts` | `addMonthsISO` |
| `src/lib/eligibility.ts` | Report `banned` for `status === 'banned'` |
| `src/lib/booking.ts` | Export `applySeating`; populate `bookingDate`; MultiSport day guard + typed error |
| `src/lib/membership.ts` | `requireMemberView` |
| `src/lib/member-calendar.ts` | `multisportDayTaken` per session |
| `src/lib/roster.ts` | Surface `no_show` rows; `freeSeats` counts only `booked` |
| `src/lib/notify.ts` | `notifyNoShowPenalty` |
| `src/emails/index.ts` | `renderNoShowPenalty` |
| `app/s/[slug]/manage/bookings/page.tsx` | Compute the ban preview per session |
| `app/s/[slug]/manage/bookings/bookings-roster.tsx` | Mark-absent confirm dialog, Absent pill, Undo |
| `app/s/[slug]/manage/members/page.tsx` | Read-only ban badge |
| `app/s/[slug]/(member)/book/page.tsx` | Use `requireMemberView`; pass ban state |
| `app/s/[slug]/(member)/book/book-calendar.tsx` | Ban banner; MultiSport day conflict in the dialog |
| `app/s/[slug]/(member)/bookings/page.tsx` | Use `requireMemberView` |
| `app/s/[slug]/(member)/bookings/actions.ts` | Cancel uses `requireMemberView` |
| `messages/en.json`, `messages/tr.json` | New keys |

---

## Task 1: Migration 0006 — schema for both halves

**Files:**
- Modify: `src/db/schema/bookings.ts`
- Modify: `src/db/schema/bookings.test.ts`
- Create: `drizzle/0006_*.sql` (generated, then hand-edited)

**Interfaces:**
- Consumes: nothing.
- Produces: `bookings.bookingDate` (`date`, **not null**, drizzle type `string` in `YYYY-MM-DD` form); index `bookings_multisport_day_uq`; `penalties.bookingId` (`uuid | null`), `penalties.permanent` (`boolean`, not null, default false); index `penalties_booking_uq`.

- [ ] **Step 1: Check production for MultiSport conflicts before writing anything**

The new unique index refuses to create if any user already holds two active MultiSport bookings on the same club-local day. `package.json`'s `build` runs `drizzle-kit migrate` on production, so an unmet assumption here fails a production deploy rather than a local command.

```bash
vercel env pull .env.production.local --environment=production
export PROD_URL="$(grep -m1 '^DATABASE_URL_UNPOOLED=' .env.production.local | cut -d= -f2- | tr -d '"')"
docker run --rm postgres:18 psql "$PROD_URL" -c "
select b.user_id, s.date, count(*)
from bookings b
join sessions se on se.id = b.session_id
join slots s on s.id = se.slot_id
where b.payment_type = 'multisport'
  and b.status in ('booked','waitlisted')
  and b.user_id is not null
group by b.user_id, s.date
having count(*) > 1;"
rm .env.production.local
```

Expected: `(0 rows)`.

**If it returns rows, STOP and report to the user before continuing.** Do not silently cancel a real member's booking to make an index fit — that is a product decision, not a migration detail.

- [ ] **Step 2: Write the failing schema test**

Add to `src/db/schema/bookings.test.ts`:

```typescript
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { bookings, penalties } from '@/db/schema/bookings';

describe('bookings booking_date', () => {
  it('carries a not-null club-local booking date', () => {
    const cols = Object.fromEntries(getTableConfig(bookings).columns.map((c) => [c.name, c]));
    expect(cols['booking_date']).toBeDefined();
    expect(cols['booking_date'].notNull).toBe(true);
  });

  it('has a partial unique index enforcing one active multisport seat per user per day', () => {
    const idx = getTableConfig(bookings).indexes.find((i) => i.config.name === 'bookings_multisport_day_uq');
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(true);
    expect(idx!.config.columns.map((c) => (c as { name: string }).name)).toEqual(['user_id', 'booking_date']);
    expect(idx!.config.where).toBeDefined();
  });
});

describe('penalties undo handles', () => {
  it('links to the booking it penalises and flags permanence', () => {
    const cols = Object.fromEntries(getTableConfig(penalties).columns.map((c) => [c.name, c]));
    expect(cols['booking_id']).toBeDefined();
    expect(cols['permanent']).toBeDefined();
    expect(cols['permanent'].notNull).toBe(true);
  });

  it('allows at most one penalty per booking', () => {
    const idx = getTableConfig(penalties).indexes.find((i) => i.config.name === 'penalties_booking_uq');
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm vitest run src/db/schema/bookings.test.ts`
Expected: FAIL — `expect(cols['booking_date']).toBeDefined()` receives `undefined`.

- [ ] **Step 4: Change the schema**

In `src/db/schema/bookings.ts`, add `date` to the `drizzle-orm/pg-core` import, then:

```typescript
export const bookings = pgTable(
  'bookings',
  {
    // ...existing columns unchanged...
    idempotencyKey: text('idempotency_key'),
    // The slot's club-local calendar day, denormalized so the MultiSport daily
    // limit can be a DB-level unique index. NOT NULL on purpose: a nullable
    // column would make the partial index silently inert (NULL-distinct) for any
    // insert path that forgot to set it.
    bookingDate: date('booking_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bookings_active_uq')
      .on(t.sessionId, t.userId)
      .where(sql`${t.status} in ('booked', 'waitlisted')`),
    uniqueIndex('bookings_idem_uq')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    // A MultiSport card allows one session per DAY, across every club — so this
    // index is deliberately not club-scoped. Covering `waitlisted` as well as
    // `booked` stops a member holding a waitlist spot at one club and a seat at
    // another; it also makes waitlist promotion a no-op for this index, since a
    // promoted row neither enters nor leaves the predicate.
    uniqueIndex('bookings_multisport_day_uq')
      .on(t.userId, t.bookingDate)
      .where(sql`${t.paymentType} = 'multisport' and ${t.status} in ('booked', 'waitlisted')`),
    index('bookings_session_status_idx').on(t.sessionId, t.status),
  ],
);

export const penalties = pgTable(
  'penalties',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    membershipId: uuid('membership_id').notNull().references(() => memberships.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    // The booking this penalty came from. Nullable so a future manually-issued
    // penalty (no session, no booking) still fits; the unique index tolerates
    // many nulls via NULL-distinct semantics.
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    bannedUntil: timestamp('banned_until', { withTimezone: true }),
    // A `never` penalty has no end date, which would otherwise be
    // indistinguishable from an `off`-policy row that records the absence but
    // imposes no ban. resolveBan needs to tell them apart.
    permanent: boolean('permanent').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('penalties_booking_uq').on(t.bookingId)],
);
```

- [ ] **Step 5: Run the schema test to confirm it passes**

Run: `pnpm vitest run src/db/schema/bookings.test.ts`
Expected: PASS.

- [ ] **Step 6: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0006_<random-name>.sql` plus an updated `drizzle/meta/_journal.json`.

- [ ] **Step 7: Hand-edit the generated SQL for the backfill**

Drizzle emits `ADD COLUMN "booking_date" date NOT NULL`, which fails on a non-empty table. Rewrite that statement into add-nullable → backfill → set-not-null. Keep every other generated statement, and keep `--> statement-breakpoint` between statements. The file should read:

```sql
ALTER TABLE "bookings" ADD COLUMN "booking_date" date;--> statement-breakpoint
-- Backfill from each booking's slot before the NOT NULL and the unique index.
UPDATE "bookings" b
SET "booking_date" = s."date"
FROM "sessions" se, "slots" s
WHERE se."id" = b."session_id" AND s."id" = se."slot_id";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "booking_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "penalties" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "penalties" ADD COLUMN "permanent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Deliberately NO defensive de-dupe here, unlike 0005. De-duping would mean
-- silently cancelling a real member's booking to make the index fit; that is a
-- product decision, not a migration detail. Step 1 of this task verified
-- production is clean instead.
CREATE UNIQUE INDEX "bookings_multisport_day_uq" ON "bookings" USING btree ("user_id","booking_date") WHERE "bookings"."payment_type" = 'multisport' and "bookings"."status" in ('booked', 'waitlisted');--> statement-breakpoint
CREATE UNIQUE INDEX "penalties_booking_uq" ON "penalties" USING btree ("booking_id");
```

Compare against what `db:generate` actually emitted and keep its exact constraint/index DDL — only the `booking_date` column statement is restructured and the comments added.

- [ ] **Step 8: Apply it to the local dev and test databases**

```bash
docker compose up -d
pnpm db:migrate
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test pnpm vitest run --no-file-parallelism src/db/roundtrip.integration.test.ts
```

Expected: migration applies without error; the roundtrip suite passes.

- [ ] **Step 9: Fix the two test fixtures that insert bookings directly**

`booking_date` is now NOT NULL, so direct inserts must supply it. Exactly two files do:

In `src/lib/roster.integration.test.ts`, in `seed()`:

```typescript
await db.insert(schema.bookings).values({ sessionId: session.id, clubId: club.id, userId: uid, paymentType: 'regular', status, queuePosition: qpos, effectiveAt: START, bookingDate: MON });
```

In `src/lib/notify.integration.test.ts`, add `bookingDate: <that file's date constant>` to its `bookings` insert in the same way. Read the file to find the date constant it already uses for the slot; use the identical value.

- [ ] **Step 10: Run the full suite**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test:integration
```

Expected: lint 0 warnings, no type errors, all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/db/schema/bookings.ts src/db/schema/bookings.test.ts drizzle/ src/lib/roster.integration.test.ts src/lib/notify.integration.test.ts
git commit -m "feat(db): booking_date, multisport daily index and penalty undo handles"
```

---

## Task 2: Pure rules — penalty maths, month arithmetic, eligibility ordering

**Files:**
- Create: `src/lib/penalty.ts`, `src/lib/penalty.test.ts`
- Modify: `src/lib/date-tz.ts`
- Modify: `src/lib/eligibility.ts`, `src/lib/eligibility.test.ts`

**Interfaces:**
- Consumes: `zonedWallClockToUtc`, `utcToClubDate`, `addDaysISO` from `./date-tz`.
- Produces:
  - `addMonthsISO(dateISO: string, n: number): string` from `./date-tz`
  - `type NoshowPolicy = 'off' | '2d' | '1w' | '2w' | '1m' | 'never'`
  - `penaltyEndsAt(input: { sessionStartAt: Date; timezone: string; policy: NoshowPolicy }): Date | 'permanent' | null`
  - `resolveBan(rows: { bannedUntil: Date | null; permanent: boolean }[]): { bannedUntil: Date | null; permanent: boolean }`

- [ ] **Step 1: Write the failing unit tests**

Create `src/lib/penalty.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { zonedWallClockToUtc } from './date-tz';
import { penaltyEndsAt, resolveBan } from './penalty';

const TZ = 'Europe/Istanbul';

describe('penaltyEndsAt', () => {
  it('returns null when the club does not penalise no-shows', () => {
    const start = zonedWallClockToUtc('2026-03-10', '07:00', TZ);
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: 'off' })).toBeNull();
  });

  it('returns the permanent marker for a never policy', () => {
    const start = zonedWallClockToUtc('2026-03-10', '07:00', TZ);
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: 'never' })).toBe('permanent');
  });

  it('anchors the ban to the session, not to now', () => {
    const start = zonedWallClockToUtc('2026-03-10', '07:00', TZ);
    const end = penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: '1w' });
    expect(end).toEqual(zonedWallClockToUtc('2026-03-17', '07:00', TZ));
  });

  it('adds each duration as calendar time', () => {
    const start = zonedWallClockToUtc('2026-03-10', '07:00', TZ);
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: '2d' })).toEqual(zonedWallClockToUtc('2026-03-12', '07:00', TZ));
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: '2w' })).toEqual(zonedWallClockToUtc('2026-03-24', '07:00', TZ));
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: '1m' })).toEqual(zonedWallClockToUtc('2026-04-10', '07:00', TZ));
  });

  it('keeps the wall-clock hour across a DST transition', () => {
    // Europe/London moves to BST on 2026-03-29. A 07:00 session a week earlier
    // must end at 07:00 local, not 06:00 — so the maths cannot be `+ 7 * 24h`.
    const LON = 'Europe/London';
    const start = zonedWallClockToUtc('2026-03-25', '07:00', LON);
    const end = penaltyEndsAt({ sessionStartAt: start, timezone: LON, policy: '1w' }) as Date;
    expect(end).toEqual(zonedWallClockToUtc('2026-04-01', '07:00', LON));
    expect(end.getTime() - start.getTime()).not.toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('clamps a month-end date rather than rolling into the next month', () => {
    const start = zonedWallClockToUtc('2026-01-31', '07:00', TZ);
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: '1m' })).toEqual(zonedWallClockToUtc('2026-02-28', '07:00', TZ));
  });
});

describe('resolveBan', () => {
  it('is empty for no penalties', () => {
    expect(resolveBan([])).toEqual({ bannedUntil: null, permanent: false });
  });

  it('ignores rows with no ban (an off-policy record)', () => {
    expect(resolveBan([{ bannedUntil: null, permanent: false }])).toEqual({ bannedUntil: null, permanent: false });
  });

  it('takes the latest end date and is order-independent', () => {
    const a = new Date('2026-03-17T04:00:00Z');
    const b = new Date('2026-03-19T04:00:00Z');
    expect(resolveBan([{ bannedUntil: a, permanent: false }, { bannedUntil: b, permanent: false }])).toEqual({ bannedUntil: b, permanent: false });
    expect(resolveBan([{ bannedUntil: b, permanent: false }, { bannedUntil: a, permanent: false }])).toEqual({ bannedUntil: b, permanent: false });
  });

  it('reports permanent when any row is permanent, whatever the dates say', () => {
    const a = new Date('2026-03-17T04:00:00Z');
    expect(resolveBan([{ bannedUntil: a, permanent: false }, { bannedUntil: null, permanent: true }]))
      .toEqual({ bannedUntil: a, permanent: true });
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm vitest run src/lib/penalty.test.ts`
Expected: FAIL — cannot resolve `./penalty`.

- [ ] **Step 3: Add `addMonthsISO` to `date-tz.ts`**

Change the `date-fns` import line and append the helper next to `addDaysISO`:

```typescript
import { addDays, addMonths } from 'date-fns';
```

```typescript
/** Add `n` calendar months to a YYYY-MM-DD label, clamping to the month end (timezone-independent). */
export function addMonthsISO(dateISO: string, n: number): string {
  return fmtUTC(addMonths(new Date(`${dateISO}T00:00:00Z`), n));
}
```

`date-fns`'s `addMonths` already clamps 31 January + 1 month to 28/29 February, which is the behaviour the test above pins.

- [ ] **Step 4: Create `src/lib/penalty.ts`**

```typescript
import { addDaysISO, addMonthsISO, utcToClubDate, zonedWallClockToUtc } from './date-tz';

export type NoshowPolicy = 'off' | '2d' | '1w' | '2w' | '1m' | 'never';

/** A live penalty row, reduced to what the ban calculation needs. */
export type PenaltyRow = { bannedUntil: Date | null; permanent: boolean };

/**
 * When a single no-show penalty stops biting.
 *
 * Anchored to the MISSED SESSION, never to the moment the owner got around to
 * marking it — so the cost of an absence does not depend on the owner's
 * paperwork habits. A consequence, intended: marking an old absence under a
 * short policy produces a ban that is already expired. It is still recorded.
 *
 * The arithmetic runs in club-local wall clock, so a 07:00 session yields a ban
 * ending at 07:00 even across a DST boundary — `+ N * 24h` would drift an hour.
 *
 * Returns `null` for `off` (no ban, but the absence is still recorded) and the
 * marker `'permanent'` for `never` (no end date exists to compute).
 */
export function penaltyEndsAt(input: { sessionStartAt: Date; timezone: string; policy: NoshowPolicy }): Date | 'permanent' | null {
  if (input.policy === 'off') return null;
  if (input.policy === 'never') return 'permanent';

  const { dateISO } = utcToClubDate(input.sessionStartAt, input.timezone);
  const endISO =
    input.policy === '2d' ? addDaysISO(dateISO, 2)
    : input.policy === '1w' ? addDaysISO(dateISO, 7)
    : input.policy === '2w' ? addDaysISO(dateISO, 14)
    : addMonthsISO(dateISO, 1);

  // Reuse the session's own club-local time of day so the ban ends at the same
  // wall-clock hour it started counting from.
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: input.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(input.sessionStartAt);
  return zonedWallClockToUtc(endISO, hhmm, input.timezone);
}

/**
 * The member's effective ban, folded from their remaining penalty rows.
 *
 * A plain max, therefore commutative: row order is irrelevant and recomputation
 * after a row is deleted needs no cursor or replay. That property is what makes
 * undoing a mistaken absence correct by construction.
 */
export function resolveBan(rows: PenaltyRow[]): { bannedUntil: Date | null; permanent: boolean } {
  let bannedUntil: Date | null = null;
  let permanent = false;
  for (const r of rows) {
    if (r.permanent) permanent = true;
    if (r.bannedUntil && (bannedUntil === null || r.bannedUntil.getTime() > bannedUntil.getTime())) {
      bannedUntil = r.bannedUntil;
    }
  }
  return { bannedUntil, permanent };
}
```

- [ ] **Step 5: Run the penalty tests**

Run: `pnpm vitest run src/lib/penalty.test.ts src/lib/date-tz.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing eligibility test**

Append to `src/lib/eligibility.test.ts`:

```typescript
it('reports a permanently banned membership as banned, not as unapproved', () => {
  expect(checkEligibility({
    membershipStatus: 'banned',
    bannedUntil: null,
    memberSkillRank: null,
    boatMinSkillRank: null,
    boatAllowedPayment: 'both',
    paymentType: 'regular',
    now: new Date('2026-03-10T04:00:00Z'),
  })).toEqual({ ok: false, reason: 'banned' });
});
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `pnpm vitest run src/lib/eligibility.test.ts`
Expected: FAIL — receives `{ ok: false, reason: 'not_approved' }`.

- [ ] **Step 8: Reorder the check in `src/lib/eligibility.ts`**

Insert one line before the existing status check:

```typescript
  // Checked ahead of the generic status test so a permanent ban reports itself
  // honestly. `never` penalties set membership.status = 'banned' and carry no
  // banned_until date, so the timed check below would never catch them.
  if (input.membershipStatus === 'banned') return { ok: false, reason: 'banned' };
  if (input.membershipStatus !== 'approved') return { ok: false, reason: 'not_approved' };
```

- [ ] **Step 9: Run the tests**

Run: `pnpm vitest run src/lib/eligibility.test.ts && pnpm lint && pnpm exec tsc --noEmit`
Expected: PASS, lint clean, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/penalty.ts src/lib/penalty.test.ts src/lib/date-tz.ts src/lib/eligibility.ts src/lib/eligibility.test.ts
git commit -m "feat(penalty): session-anchored ban maths and honest banned eligibility"
```

---

## Task 3: MultiSport daily limit in the booking paths

**Files:**
- Create: `src/lib/pg-errors.ts`, `src/lib/pg-errors.test.ts`
- Modify: `src/lib/booking.ts`
- Modify: `src/lib/booking.integration.test.ts`

**Interfaces:**
- Consumes: `bookings.bookingDate` and index `bookings_multisport_day_uq` (Task 1).
- Produces:
  - `isUniqueViolation(err: unknown, constraint: string): boolean` from `./pg-errors`
  - `BookResult` gains `| { ok: false; error: 'multisport_day_taken' }`
  - `OwnerAddResult` gains `| { ok: false; error: 'multisport_day_taken' }`
  - `applySeating` is exported from `./booking` (signature unchanged): `applySeating(tx, sessionId, capacity, mode) => Promise<{ promotedUserId: string | null }>`

- [ ] **Step 1: Write the failing unit test for the error helper**

Create `src/lib/pg-errors.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from './pg-errors';

describe('isUniqueViolation', () => {
  it('matches a bare pg error', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'bookings_multisport_day_uq' }, 'bookings_multisport_day_uq')).toBe(true);
  });

  it('matches through a wrapper error cause chain', () => {
    // Drizzle wraps driver errors, so the pg error is reachable only via `cause`.
    const wrapped = new Error('query failed', { cause: { code: '23505', constraint: 'bookings_multisport_day_uq' } });
    expect(isUniqueViolation(wrapped, 'bookings_multisport_day_uq')).toBe(true);
  });

  it('rejects a different constraint', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'bookings_active_uq' }, 'bookings_multisport_day_uq')).toBe(false);
  });

  it('rejects a different error code and non-errors', () => {
    expect(isUniqueViolation({ code: '23503', constraint: 'bookings_multisport_day_uq' }, 'bookings_multisport_day_uq')).toBe(false);
    expect(isUniqueViolation(null, 'bookings_multisport_day_uq')).toBe(false);
    expect(isUniqueViolation('boom', 'bookings_multisport_day_uq')).toBe(false);
  });

  it('terminates on a self-referential cause chain', () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isUniqueViolation(loop, 'x')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/lib/pg-errors.test.ts`
Expected: FAIL — cannot resolve `./pg-errors`.

- [ ] **Step 3: Create `src/lib/pg-errors.ts`**

```typescript
/**
 * Does `err` represent a unique-constraint violation of `constraint`?
 *
 * Drizzle wraps driver errors, so the pg error carrying `code`/`constraint` may
 * sit several links down a `cause` chain. The depth cap also guards against a
 * self-referential chain.
 */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur != null && depth < 5; depth++) {
    const e = cur as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === '23505' && e.constraint === constraint) return true;
    if (e.cause === cur) return false;
    cur = e.cause;
  }
  return false;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm vitest run src/lib/pg-errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing integration tests**

Append to `src/lib/booking.integration.test.ts`. Reuse that file's existing seed helpers and its frozen `NOW` convention — read the top of the file first and match how it builds a club, window, boat and member. The tests to add:

```typescript
describe('multisport daily limit', () => {
  it('rejects a second multisport seat on the same day in another club', async () => {
    // Two independent clubs, one member in both, same club-local date.
    const a = await seedClub({ allowedPayment: 'both' });
    const b = await seedClub({ allowedPayment: 'both' });
    const uid = await seedUserInBoth(a, b);

    const first = await bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'k-a', now: NOW });
    expect(first.ok).toBe(true);

    const second = await bookSeat(db, { clubId: b.clubId, userId: uid, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, paymentType: 'multisport', idempotencyKey: 'k-b', now: NOW });
    expect(second).toEqual({ ok: false, error: 'multisport_day_taken' });
  });

  it('still allows a regular seat the same day', async () => {
    const a = await seedClub({ allowedPayment: 'both' });
    const b = await seedClub({ allowedPayment: 'both' });
    const uid = await seedUserInBoth(a, b);
    await bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'k-a', now: NOW });
    const second = await bookSeat(db, { clubId: b.clubId, userId: uid, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, paymentType: 'regular', idempotencyKey: 'k-b', now: NOW });
    expect(second.ok).toBe(true);
  });

  it('frees the day again once the multisport seat is cancelled', async () => {
    const a = await seedClub({ allowedPayment: 'both' });
    const b = await seedClub({ allowedPayment: 'both' });
    const uid = await seedUserInBoth(a, b);
    const first = await bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'k-a', now: NOW });
    if (!first.ok) throw new Error('setup failed');
    await cancelBooking(db, { clubId: a.clubId, userId: uid, bookingId: first.bookingId, now: NOW });
    const second = await bookSeat(db, { clubId: b.clubId, userId: uid, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, paymentType: 'multisport', idempotencyKey: 'k-b', now: NOW });
    expect(second.ok).toBe(true);
  });

  it('the DATABASE refuses a duplicate, not just the guard', async () => {
    // Bypasses bookSeat entirely: proves the partial unique index exists and
    // covers the right predicate, which the guard-level tests above cannot.
    const a = await seedClub({ allowedPayment: 'both' });
    const b = await seedClub({ allowedPayment: 'both' });
    const uid = await seedUserInBoth(a, b);
    const first = await bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'k-a', now: NOW });
    if (!first.ok) throw new Error('setup failed');
    const [row] = await db.select({ sessionId: schema.bookings.sessionId, bookingDate: schema.bookings.bookingDate }).from(schema.bookings).where(eq(schema.bookings.id, first.bookingId));

    await expect(
      db.insert(schema.bookings).values({
        sessionId: row.sessionId, clubId: a.clubId, userId: uid, paymentType: 'multisport',
        status: 'waitlisted', effectiveAt: NOW, bookingDate: row.bookingDate,
      }),
    ).rejects.toSatisfy((err: unknown) => isUniqueViolation(err, 'bookings_multisport_day_uq'));
  });

  it('lets exactly one of two concurrent bookings win', async () => {
    const a = await seedClub({ allowedPayment: 'both' });
    const b = await seedClub({ allowedPayment: 'both' });
    const uid = await seedUserInBoth(a, b);
    const [ra, rb] = await Promise.all([
      bookSeat(db, { clubId: a.clubId, userId: uid, windowId: a.windowId, boatTypeId: a.boatTypeId, startAt: a.startAt, paymentType: 'multisport', idempotencyKey: 'c-a', now: NOW }),
      bookSeat(db, { clubId: b.clubId, userId: uid, windowId: b.windowId, boatTypeId: b.boatTypeId, startAt: b.startAt, paymentType: 'multisport', idempotencyKey: 'c-b', now: NOW }),
    ]);
    const wins = [ra, rb].filter((r) => r.ok).length;
    expect(wins).toBe(1);
    const loser = [ra, rb].find((r) => !r.ok);
    expect(loser).toEqual({ ok: false, error: 'multisport_day_taken' });
  });
});
```

Add `isUniqueViolation` to that file's imports (`import { isUniqueViolation } from './pg-errors';`).

Write `seedClub` / `seedUserInBoth` as local helpers inside that `describe` block. `seedClub` must return `{ clubId, windowId, boatTypeId, startAt }` for a fresh tagged club with one `schedule_window`, one `boat_type` with `seats: 2`, and one `window_boats` row — with `startAt` on the **same club-local date** for every club it creates, so two clubs collide on the day. `seedUserInBoth(a, b)` must insert one `user` row and an `approved` `memberships` row in each of the two clubs, returning the user id. Model both on the seed helper already at the top of `booking.integration.test.ts` and reuse its frozen `NOW` (which must sit before `startAt`, so booking is open).

- [ ] **Step 6: Run them to confirm they fail**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test pnpm vitest run --no-file-parallelism src/lib/booking.integration.test.ts`
Expected: FAIL — the second booking succeeds instead of returning `multisport_day_taken`, and the direct insert is accepted.

- [ ] **Step 7: Populate `bookingDate` and export `applySeating`**

In `src/lib/booking.ts`:

Change the `applySeating` declaration to be exported (body unchanged):

```typescript
export async function applySeating(tx: Tx, sessionId: string, capacity: number, mode: 'equal' | 'priority'): Promise<{ promotedUserId: string | null }> {
```

**Replace** the existing private `Tx` alias on line 16 — do not add a second declaration — so `attendance.ts` can share it:

```typescript
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
```

Add `bookingDate: dateISO` to both insert sites. In `bookSeat` (currently line 145):

```typescript
    const [inserted] = await tx.insert(bookings).values({ sessionId: target.id, clubId: input.clubId, userId: input.userId, paymentType: input.paymentType, status: 'waitlisted', effectiveAt: now, source: 'member', idempotencyKey: input.idempotencyKey, bookingDate: dateISO }).returning({ id: bookings.id });
```

In `ownerAddBooking`:

```typescript
    const [inserted] = await tx.insert(bookings).values({ sessionId: target.id, clubId: input.clubId, userId: input.userId, paymentType: input.paymentType, status: 'booked', effectiveAt: now, source: 'owner', bookingDate: dateISO }).returning({ id: bookings.id });
```

- [ ] **Step 8: Add the guard and the typed error**

Extend the result unions:

```typescript
export type BookResult =
  | { ok: true; bookingId: string; outcome: 'seated' | 'waitlisted'; queuePosition: number | null }
  | { ok: false; error: 'ineligible'; reason: EligibilityReason }
  | { ok: false; error: 'already_booked_this_slot' }
  | { ok: false; error: 'multisport_day_taken' }
  | { ok: false; error: 'no_session' };

export type OwnerAddResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: 'no_session' | 'not_a_member' | 'already_booked_this_slot' | 'session_full' | 'multisport_day_taken' };
```

Import the helper at the top of `booking.ts`:

```typescript
import { isUniqueViolation } from './pg-errors';
```

Add this shared guard function near `applySeating`:

```typescript
/**
 * A MultiSport card allows one session per DAY, across every club — so this
 * check is deliberately not club-scoped. It is the ordinary-case path only:
 * `bookings_multisport_day_uq` is the actual guarantee, because the per-slot
 * advisory lock cannot serialize two bookings in different slots or clubs.
 */
async function multisportDayTaken(tx: Tx, userId: string, dateISO: string): Promise<boolean> {
  const [clash] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(
      eq(bookings.userId, userId),
      eq(bookings.bookingDate, dateISO),
      eq(bookings.paymentType, 'multisport'),
      inArray(bookings.status, [...ACTIVE]),
    ));
  return Boolean(clash);
}
```

In `bookSeat`, immediately after the existing step 7 ("One booking per slot") block:

```typescript
    // 7b. MultiSport: one session per day, anywhere.
    if (input.paymentType === 'multisport' && await multisportDayTaken(tx, input.userId, dateISO)) {
      return { ok: false, error: 'multisport_day_taken' };
    }
```

In `ownerAddBooking`, immediately after its "One booking per slot" block:

```typescript
    // The owner override covers the CLUB's gates (closed day, booking-open,
    // skill, payment eligibility). One-per-day is the CARD's rule, not the
    // club's, so it is not the owner's to waive — and the unique index would
    // enforce it regardless.
    if (input.paymentType === 'multisport' && await multisportDayTaken(tx, input.userId, dateISO)) {
      return { ok: false, error: 'multisport_day_taken' };
    }
```

- [ ] **Step 9: Catch the race outside the transaction**

A constraint violation aborts the transaction, so it cannot be caught inside the callback and turned into a return value — the subsequent COMMIT would fail. Wrap both functions instead.

`bookSeat` becomes:

```typescript
export async function bookSeat(db: DB, input: BookInput): Promise<BookResult> {
  const now = input.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      // ...entire existing body, unchanged...
    });
  } catch (err) {
    // The guard above handles the ordinary case; this is the genuine race two
    // requests can hit between their checks and their inserts.
    if (isUniqueViolation(err, 'bookings_multisport_day_uq')) return { ok: false, error: 'multisport_day_taken' };
    throw err;
  }
}
```

Apply the identical `try`/`catch` wrapper to `ownerAddBooking`, returning its own `multisport_day_taken`.

- [ ] **Step 10: Run the integration tests**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test pnpm vitest run --no-file-parallelism src/lib/booking.integration.test.ts`
Expected: PASS, including the concurrency case.

- [ ] **Step 11: Full suite + lint**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test:integration
```

Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add src/lib/pg-errors.ts src/lib/pg-errors.test.ts src/lib/booking.ts src/lib/booking.integration.test.ts
git commit -m "feat(booking): one multisport session per day, guaranteed by a unique index"
```

---

## Task 4: Member booking surfaces — MultiSport conflict and the ban banner

**Files:**
- Modify: `src/lib/membership.ts`, `src/lib/membership.test.ts`
- Modify: `src/lib/member-calendar.ts`, `src/lib/member-calendar.integration.test.ts`
- Modify: `app/s/[slug]/(member)/book/page.tsx`, `app/s/[slug]/(member)/book/book-calendar.tsx`
- Modify: `app/s/[slug]/(member)/bookings/page.tsx`, `app/s/[slug]/(member)/bookings/actions.ts`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `bookings.bookingDate` (Task 1); `BookResult.multisport_day_taken` (Task 3).
- Produces:
  - `requireMemberView(slug: string, returnPath?: string): Promise<{ club: Club; user: CurrentUser; membership: Membership }>` from `@/lib/membership`
  - `MemberVirtualSession` gains `multisportDayTaken: boolean`

- [ ] **Step 1: Write the failing test for `requireMemberView`**

`src/lib/membership.test.ts` already spies on `getMembership`; follow its existing arrangement exactly. Add:

```typescript
it('requireMemberView admits a member with an active ban so the page can explain it', async () => {
  // requireMember 404s a banned member, which would leave them staring at a bare
  // "not found" with no idea why. The view guard must let them through.
  vi.spyOn(mod, 'getMembership').mockResolvedValue({
    ...approvedMembership,
    bannedUntil: new Date(Date.now() + 60 * 60 * 1000),
  });
  const result = await mod.requireMemberView('demo', '/book');
  expect(result.membership.bannedUntil).toBeInstanceOf(Date);
});

it('requireMemberView admits a permanently banned membership', async () => {
  vi.spyOn(mod, 'getMembership').mockResolvedValue({ ...approvedMembership, status: 'banned' });
  const result = await mod.requireMemberView('demo', '/book');
  expect(result.membership.status).toBe('banned');
});

it('requireMemberView still rejects a pending membership', async () => {
  vi.spyOn(mod, 'getMembership').mockResolvedValue({ ...approvedMembership, status: 'pending' });
  await expect(mod.requireMemberView('demo', '/book')).rejects.toThrow();
});
```

Read the existing file for how it names its fixtures (`approvedMembership` above is illustrative) and mirror them.

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/lib/membership.test.ts`
Expected: FAIL — `mod.requireMemberView is not a function`.

- [ ] **Step 3: Add `requireMemberView` to `src/lib/membership.ts`**

```typescript
/**
 * Like `requireMember`, but admits a member whose membership is banned — timed
 * or permanent — and returns it so the page can render the reason.
 *
 * The split exists because a ban gates ACQUISITION, not viewing or release. A
 * banned member must still be able to see why, and to give up a seat that
 * survived the penalty cascade because it falls after the ban ends. Mutating
 * actions that acquire something keep the strict `requireMember`.
 */
export async function requireMemberView(
  slug: string,
  returnPath = '/book',
): Promise<{ club: Club; user: CurrentUser; membership: Membership }> {
  const origin = parseAppOrigin(env.APP_URL);
  const club = await getClubBySlug(slug);
  requireActiveClub(club);
  const user = await getCurrentUser();
  if (!user) {
    const back = `${clubUrl(slug, origin)}${returnPath}`;
    redirect(`${apexUrl('/sign-in', origin)}?redirect=${encodeURIComponent(back)}`);
  }
  const membership = await self.getMembership(appDb, user.id, club.id);
  if (!membership || (membership.status !== 'approved' && membership.status !== 'banned')) notFound();
  return { club, user, membership };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run src/lib/membership.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing integration test for the calendar flag**

Append to `src/lib/member-calendar.integration.test.ts`, matching its existing seed helpers and frozen-`now` convention:

```typescript
it('flags a day on which the member already holds a multisport seat in another club', async () => {
  const home = await seed();                       // the club whose calendar we compute
  const other = await seed();                      // an unrelated club, same date
  await bookSeat(db, { clubId: other.clubId, userId: home.userId, windowId: other.windowId, boatTypeId: other.boatTypeId, startAt: other.startAt, paymentType: 'multisport', idempotencyKey: 'x-1', now: NOW });

  const days = await computeMemberCalendar(db, home.clubId, home.member, { fromDateISO: DAY, days: 1, now: NOW });
  const session = days[0].slots[0].sessions[0];
  expect(session.multisportDayTaken).toBe(true);
});

it('leaves the flag clear when the other seat is a regular booking', async () => {
  const home = await seed();
  const other = await seed();
  await bookSeat(db, { clubId: other.clubId, userId: home.userId, windowId: other.windowId, boatTypeId: other.boatTypeId, startAt: other.startAt, paymentType: 'regular', idempotencyKey: 'x-2', now: NOW });

  const days = await computeMemberCalendar(db, home.clubId, home.member, { fromDateISO: DAY, days: 1, now: NOW });
  expect(days[0].slots[0].sessions[0].multisportDayTaken).toBe(false);
});
```

`seed()` must place both clubs' blocks on the same club-local date, and the member must be approved in both.

- [ ] **Step 6: Run it to confirm it fails**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test pnpm vitest run --no-file-parallelism src/lib/member-calendar.integration.test.ts`
Expected: FAIL — `multisportDayTaken` is `undefined`.

- [ ] **Step 7: Add the flag to `src/lib/member-calendar.ts`**

Extend the session type:

```typescript
export type MemberVirtualSession = VirtualSession & {
  seatsLeft: number;
  bookingOpen: boolean;
  eligibility: EligibilityResult;
  defaultPayment: PaymentType;
  paymentChoices: PaymentType[];
  myStatus: 'none' | 'booked' | 'waitlisted';
  myQueuePosition: number | null;
  bookingOpensAt: Date | null;
  /** The member already holds an active MultiSport seat that day, in ANY club. */
  multisportDayTaken: boolean;
};
```

Inside `computeMemberCalendar`, after the seated/mine queries, add the one deliberately cross-tenant read in the codebase:

```typescript
  // The MultiSport daily limit is a property of the CARD, so this query is
  // deliberately not club-scoped — the one cross-tenant read in the codebase.
  // It returns dates only, about the requesting user, so it discloses nothing
  // about any other club.
  const windowDates = days.map((d) => d.dateISO);
  const multisportDays = new Set<string>();
  if (windowDates.length) {
    const rows = await db
      .select({ bookingDate: bookings.bookingDate })
      .from(bookings)
      .where(and(
        eq(bookings.userId, member.userId),
        eq(bookings.paymentType, 'multisport'),
        inArray(bookings.status, ['booked', 'waitlisted']),
        inArray(bookings.bookingDate, windowDates),
      ));
    for (const r of rows) multisportDays.add(r.bookingDate);
  }
```

Then in the per-session mapper, add:

```typescript
          multisportDayTaken: multisportDays.has(day.dateISO),
```

The mapper currently closes over `day` already (it is inside `days.map((day) => ...)`), so no restructuring is needed.

- [ ] **Step 8: Run the integration test**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test pnpm vitest run --no-file-parallelism src/lib/member-calendar.integration.test.ts`
Expected: PASS.

- [ ] **Step 9: Add the i18n keys**

In `messages/en.json`, under `booking`:

```json
"bannedTitle": "Booking suspended",
"bannedUntil": "You can't book until {date}.",
"bannedPermanent": "Your booking access has been suspended by the club.",
"multisportDayTaken": "Your MultiSport card is already used for another session that day.",
```

and under `booking.errors`:

```json
"multisport_day_taken": "Your MultiSport card is already used for another session that day."
```

In `messages/tr.json`, the same keys under the same paths:

```json
"bannedTitle": "Rezervasyon askıya alındı",
"bannedUntil": "{date} tarihine kadar rezervasyon yapamazsınız.",
"bannedPermanent": "Kulüp rezervasyon erişiminizi askıya aldı.",
"multisportDayTaken": "MultiSport kartınız o gün başka bir seans için kullanılmış.",
```

and under `booking.errors`:

```json
"multisport_day_taken": "MultiSport kartınız o gün başka bir seans için kullanılmış."
```

- [ ] **Step 10: Switch the member pages and the cancel action to the view guard**

In `app/s/[slug]/(member)/book/page.tsx`, change the import and the call:

```typescript
import { requireMemberView } from '@/lib/membership';
```
```typescript
  const { club, user, membership } = await requireMemberView(slug, '/book');
```

and pass the ban state to the calendar:

```typescript
      <BookCalendar
        slug={slug}
        days={days}
        timeZone={club.timezone}
        bannedUntil={membership.bannedUntil}
        bannedPermanently={membership.status === 'banned'}
      />
```

In `app/s/[slug]/(member)/bookings/page.tsx`, swap `requireMember` for `requireMemberView` (same argument).

In `app/s/[slug]/(member)/bookings/actions.ts`, swap `requireMember` for `requireMemberView` in `cancelBookingAction` **only**. Add the comment:

```typescript
  // A ban gates acquisition, not release: a seat that falls after the ban ends
  // survives the penalty cascade, and its holder must still be able to cancel it.
  const { club, user } = await requireMemberView(slug, '/bookings');
```

Leave `app/s/[slug]/(member)/book/actions.ts` on the strict `requireMember` — booking is acquisition.

- [ ] **Step 11: Render the banner and the conflict in `book-calendar.tsx`**

Extend the component props and render a banner above the date strip:

```tsx
export function BookCalendar({ slug, days, timeZone, bannedUntil, bannedPermanently }: {
  slug: string;
  days: MemberCalendarDay[];
  timeZone: string;
  bannedUntil: Date | null;
  bannedPermanently: boolean;
}) {
```

Inside the returned markup, before the `<DateStrip .../>`:

```tsx
      {(bannedPermanently || (bannedUntil && bannedUntil.getTime() > Date.now())) && (
        <div className="mb-3 rounded-card border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad" role="status">
          <p className="font-medium">{t('bannedTitle')}</p>
          <p>
            {bannedPermanently
              ? t('bannedPermanent')
              : t('bannedUntil', { date: f.dateTime(bannedUntil!, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone }) })}
          </p>
        </div>
      )}
```

If `BookCalendar` does not already hold `t` / `f`, add `const t = useTranslations('booking');` and `const f = useFormatter();` at the top of the component.

In `ConfirmBooking`, block a conflicting MultiSport choice. After the `payment` state declaration:

```tsx
  const multisportBlocked = payment === 'multisport' && session.multisportDayTaken;
```

Render the explanation immediately above the existing error paragraph:

```tsx
      {multisportBlocked && <p className="text-sm text-warn">{t('multisportDayTaken')}</p>}
```

and disable the submit:

```tsx
        <Button type="submit" disabled={pending || multisportBlocked}>
```

The server still rejects it independently — this only spares the round trip.

- [ ] **Step 12: Verify i18n parity, lint, types and build**

```bash
node -e "
const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v?flat(v,p+k+'.'):[p+k]);
const en=flat(require('./messages/en.json')), tr=flat(require('./messages/tr.json'));
const miss=(a,b)=>a.filter(k=>!b.includes(k));
console.log('missing in tr:',miss(en,tr)); console.log('missing in en:',miss(tr,en));
"
pnpm lint && pnpm exec tsc --noEmit && pnpm test:integration
```

Expected: both `missing in` lists empty; lint and types clean; all tests pass.

- [ ] **Step 13: Commit**

```bash
git add src/lib/membership.ts src/lib/membership.test.ts src/lib/member-calendar.ts src/lib/member-calendar.integration.test.ts "app/s/[slug]/(member)" messages/
git commit -m "feat(book): show the multisport day conflict and explain a booking ban"
```

---

## Task 5: `markNoShow` — the penalty engine

**Files:**
- Create: `src/lib/attendance.ts`, `src/lib/attendance.integration.test.ts`

**Interfaces:**
- Consumes: `penaltyEndsAt` / `resolveBan` (Task 2); `applySeating` and the exported `Tx` type (Task 3); `penalties.bookingId` / `penalties.permanent` (Task 1).
- Produces:

```typescript
export type MarkNoShowResult =
  | {
      ok: true;
      bannedUntil: Date | null;
      permanent: boolean;
      alreadyLapsed: boolean;
      cancelled: { bookingId: string; sessionId: string }[];
      promoted: { userId: string; sessionId: string }[];
    }
  | { ok: false; error: 'not_found' | 'not_started' | 'not_booked' | 'already_marked' };

export function markNoShow(db: DB, input: { clubId: string; bookingId: string; now?: Date }): Promise<MarkNoShowResult>;
```

- [ ] **Step 1: Write the failing integration tests**

Create `src/lib/attendance.integration.test.ts`. Model the harness on `src/lib/roster.integration.test.ts` (same `beforeAll` migrate, same tagged seed).

```typescript
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { markNoShow } from './attendance';
import { zonedWallClockToUtc } from './date-tz';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
// Frozen clock: the missed session is in the past, "now" is the evening after it.
const MISSED_DAY = '2026-03-10';
const MISSED_START = zonedWallClockToUtc(MISSED_DAY, '07:00', TZ);
const NOW = zonedWallClockToUtc(MISSED_DAY, '20:00', TZ);

describe.skipIf(!url)('markNoShow', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  /** One club, one member, one seated booking on the missed session. */
  async function seed(policy: 'off' | '2d' | '1w' | '2w' | '1m' | 'never' = '1w') {
    const tag = `att-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ, noshowPenalty: policy }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 2, allowedPayment: 'both' }).returning();
    const uid = `${tag}-u`;
    await db.insert(schema.user).values({ id: uid, name: 'Ali', email: `${uid}@t.co` });
    const [membership] = await db.insert(schema.memberships).values({ userId: uid, clubId: club.id, status: 'approved' }).returning();

    const [slot] = await db.insert(schema.slots).values({ clubId: club.id, date: MISSED_DAY, startAt: MISSED_START, endAt: zonedWallClockToUtc(MISSED_DAY, '08:00', TZ) }).returning();
    const [session] = await db.insert(schema.sessions).values({ slotId: slot.id, clubId: club.id, boatTypeId: boat.id, capacity: 2 }).returning();
    const [booking] = await db.insert(schema.bookings).values({ sessionId: session.id, clubId: club.id, userId: uid, paymentType: 'regular', status: 'booked', effectiveAt: MISSED_START, bookingDate: MISSED_DAY }).returning();
    return { club, boat, uid, membership, session, booking };
  }

  /** Add a future seat for the same member on `dateISO` at 07:00. */
  async function seedFutureSeat(ctx: Awaited<ReturnType<typeof seed>>, dateISO: string) {
    const [slot] = await db.insert(schema.slots).values({ clubId: ctx.club.id, date: dateISO, startAt: zonedWallClockToUtc(dateISO, '07:00', TZ), endAt: zonedWallClockToUtc(dateISO, '08:00', TZ) }).returning();
    const [session] = await db.insert(schema.sessions).values({ slotId: slot.id, clubId: ctx.club.id, boatTypeId: ctx.boat.id, capacity: 2 }).returning();
    const [booking] = await db.insert(schema.bookings).values({ sessionId: session.id, clubId: ctx.club.id, userId: ctx.uid, paymentType: 'regular', status: 'booked', effectiveAt: NOW, bookingDate: dateISO }).returning();
    return { session, booking };
  }

  it('marks the booking, writes a penalty and bans until session start + policy', async () => {
    const ctx = await seed('1w');
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.permanent).toBe(false);
    expect(result.bannedUntil).toEqual(zonedWallClockToUtc('2026-03-17', '07:00', TZ));

    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, ctx.booking.id));
    expect(booking.status).toBe('no_show');
    const [penalty] = await db.select().from(schema.penalties).where(eq(schema.penalties.bookingId, ctx.booking.id));
    expect(penalty.reason).toBe('no_show');
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, ctx.membership.id));
    expect(m.bannedUntil).toEqual(zonedWallClockToUtc('2026-03-17', '07:00', TZ));
  });

  it('records the absence but imposes no ban when the policy is off', async () => {
    const ctx = await seed('off');
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result).toMatchObject({ ok: true, bannedUntil: null, permanent: false });
    const [penalty] = await db.select().from(schema.penalties).where(eq(schema.penalties.bookingId, ctx.booking.id));
    expect(penalty).toBeDefined();
    expect(penalty.bannedUntil).toBeNull();
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, ctx.membership.id));
    expect(m.bannedUntil).toBeNull();
    expect(m.status).toBe('approved');
  });

  it('sets the membership to banned for a never policy', async () => {
    const ctx = await seed('never');
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result).toMatchObject({ ok: true, permanent: true });
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, ctx.membership.id));
    expect(m.status).toBe('banned');
  });

  it('cancels a future seat inside the ban window and promotes the waitlist', async () => {
    const ctx = await seed('1w');
    const future = await seedFutureSeat(ctx, '2026-03-12');   // inside 10 Mar + 7d
    // Someone waiting for that seat.
    const other = `${ctx.uid}-b`;
    await db.insert(schema.user).values({ id: other, name: 'Bora', email: `${other}@t.co` });
    await db.insert(schema.memberships).values({ userId: other, clubId: ctx.club.id, status: 'approved' });
    await db.insert(schema.bookings).values({ sessionId: future.session.id, clubId: ctx.club.id, userId: other, paymentType: 'regular', status: 'waitlisted', queuePosition: 1, effectiveAt: NOW, bookingDate: '2026-03-12' });
    // Fill the remaining seat so the waitlister is genuinely waiting.
    const filler = `${ctx.uid}-c`;
    await db.insert(schema.user).values({ id: filler, name: 'Cem', email: `${filler}@t.co` });
    await db.insert(schema.memberships).values({ userId: filler, clubId: ctx.club.id, status: 'approved' });
    await db.insert(schema.bookings).values({ sessionId: future.session.id, clubId: ctx.club.id, userId: filler, paymentType: 'regular', status: 'booked', effectiveAt: NOW, bookingDate: '2026-03-12' });

    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cancelled.map((c) => c.bookingId)).toEqual([future.booking.id]);
    expect(result.promoted).toEqual([{ userId: other, sessionId: future.session.id }]);

    const [cancelled] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, future.booking.id));
    expect(cancelled.status).toBe('cancelled');
  });

  it('leaves a seat that falls after the ban ends', async () => {
    const ctx = await seed('1w');
    const later = await seedFutureSeat(ctx, '2026-03-25');    // beyond 10 Mar + 7d
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cancelled).toEqual([]);
    const [kept] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, later.booking.id));
    expect(kept.status).toBe('booked');
  });

  it('cancels every future seat when the ban is permanent', async () => {
    const ctx = await seed('never');
    const far = await seedFutureSeat(ctx, '2027-01-05');
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cancelled.map((c) => c.bookingId)).toEqual([far.booking.id]);
  });

  it('reports a ban that was born expired', async () => {
    const ctx = await seed('2d');
    const late = zonedWallClockToUtc('2026-03-30', '20:00', TZ);   // marked long after
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: late });
    expect(result).toMatchObject({ ok: true, alreadyLapsed: true });
    if (!result.ok) return;
    expect(result.bannedUntil!.getTime()).toBeLessThan(late.getTime());
    expect(result.cancelled).toEqual([]);
  });

  it('never touches the member bookings of another club', async () => {
    const ctx = await seed('1w');
    const otherClub = await seed('1w');
    // Same person, seated in the other club inside the ban window.
    await db.insert(schema.memberships).values({ userId: ctx.uid, clubId: otherClub.club.id, status: 'approved' });
    const foreign = await seedFutureSeat({ ...otherClub, uid: ctx.uid }, '2026-03-12');

    await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    const [kept] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, foreign.booking.id));
    expect(kept.status).toBe('booked');
  });

  it('rejects a session that has not started', async () => {
    const ctx = await seed('1w');
    const before = zonedWallClockToUtc(MISSED_DAY, '06:00', TZ);
    expect(await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: before })).toEqual({ ok: false, error: 'not_started' });
  });

  it('rejects a waitlisted booking — it never held a seat', async () => {
    const ctx = await seed('1w');
    await db.update(schema.bookings).set({ status: 'waitlisted', queuePosition: 1 }).where(eq(schema.bookings.id, ctx.booking.id));
    expect(await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW })).toEqual({ ok: false, error: 'not_booked' });
  });

  it('rejects a second mark on the same booking', async () => {
    const ctx = await seed('1w');
    await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW })).toEqual({ ok: false, error: 'already_marked' });
  });

  it('rejects a booking belonging to another club', async () => {
    const ctx = await seed('1w');
    const other = await seed('1w');
    expect(await markNoShow(db, { clubId: other.club.id, bookingId: ctx.booking.id, now: NOW })).toEqual({ ok: false, error: 'not_found' });
  });

  it('takes the later end date when a second absence is marked during a ban', async () => {
    const ctx = await seed('1w');
    await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    // A second missed session two days later, marked in the same sitting.
    const second = await seedFutureSeat(ctx, '2026-03-12');
    const later = zonedWallClockToUtc('2026-03-13', '20:00', TZ);
    const result = await markNoShow(db, { clubId: ctx.club.id, bookingId: second.booking.id, now: later });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // max(10 Mar + 7d, 12 Mar + 7d) = 19 Mar.
    expect(result.bannedUntil).toEqual(zonedWallClockToUtc('2026-03-19', '07:00', TZ));
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test pnpm vitest run --no-file-parallelism src/lib/attendance.integration.test.ts`
Expected: FAIL — cannot resolve `./attendance`.

- [ ] **Step 3: Create `src/lib/attendance.ts`**

```typescript
import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';

import type { DB } from '@/db';
import { bookings, clubs, memberships, penalties, sessions, slots } from '@/db/schema';

import { applySeating, type Tx } from './booking';
import { penaltyEndsAt, resolveBan } from './penalty';

const ACTIVE = ['booked', 'waitlisted'] as const;

export type MarkNoShowResult =
  | {
      ok: true;
      bannedUntil: Date | null;
      permanent: boolean;
      /** The ban ended before it was issued — the absence is recorded but restricts nothing. */
      alreadyLapsed: boolean;
      cancelled: { bookingId: string; sessionId: string }[];
      promoted: { userId: string; sessionId: string }[];
    }
  | { ok: false; error: 'not_found' | 'not_started' | 'not_booked' | 'already_marked' };

/** Recompute the membership's ban from its remaining penalty rows and persist it. */
async function recomputeBan(tx: Tx, membershipId: string, currentStatus: string): Promise<{ bannedUntil: Date | null; permanent: boolean }> {
  const rows = await tx
    .select({ bannedUntil: penalties.bannedUntil, permanent: penalties.permanent })
    .from(penalties)
    .where(eq(penalties.membershipId, membershipId));
  const ban = resolveBan(rows);

  // Only ever move status between 'approved' and 'banned'. Writing it
  // unconditionally would resurrect a rejected membership.
  const status: 'banned' | 'approved' | undefined =
    ban.permanent ? 'banned' : currentStatus === 'banned' ? 'approved' : undefined;
  await tx
    .update(memberships)
    .set(status ? { bannedUntil: ban.bannedUntil, status } : { bannedUntil: ban.bannedUntil })
    .where(eq(memberships.id, membershipId));
  return ban;
}

/**
 * Record that a seated member did not turn up, and apply the club's penalty.
 *
 * One transaction: mark the booking -> write the penalty row -> recompute the
 * membership ban -> cancel the member's seats that fall INSIDE the ban window,
 * promoting a waitlister into each.
 *
 * Two orderings are load-bearing. The cascade runs after the ban is computed
 * because the ban end is what bounds it. And the per-slot advisory locks are
 * taken in ascending start-time order because the cascade holds several at once
 * — unordered acquisition lets two owners marking concurrently deadlock.
 */
export async function markNoShow(db: DB, input: { clubId: string; bookingId: string; now?: Date }): Promise<MarkNoShowResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: bookings.id,
        userId: bookings.userId,
        clubId: bookings.clubId,
        status: bookings.status,
        sessionId: bookings.sessionId,
        slotStartAt: slots.startAt,
        timezone: clubs.timezone,
        policy: clubs.noshowPenalty,
        multisportMode: clubs.multisportMode,
      })
      .from(bookings)
      .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
      .innerJoin(slots, eq(slots.id, sessions.slotId))
      .innerJoin(clubs, eq(clubs.id, bookings.clubId))
      .where(eq(bookings.id, input.bookingId));

    if (!row || row.clubId !== input.clubId || !row.userId) return { ok: false, error: 'not_found' };
    if (row.status === 'no_show') return { ok: false, error: 'already_marked' };
    // A waitlisted member never held a seat, so absence is meaningless for them.
    if (row.status !== 'booked') return { ok: false, error: 'not_booked' };
    if (now.getTime() < row.slotStartAt.getTime()) return { ok: false, error: 'not_started' };

    const [membership] = await tx
      .select({ id: memberships.id, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.userId, row.userId), eq(memberships.clubId, input.clubId)));
    if (!membership) return { ok: false, error: 'not_found' };

    await tx.update(bookings).set({ status: 'no_show', queuePosition: null }).where(eq(bookings.id, row.id));

    const ends = penaltyEndsAt({ sessionStartAt: row.slotStartAt, timezone: row.timezone, policy: row.policy });
    const permanent = ends === 'permanent';
    const endsAt = permanent ? null : ends;
    await tx.insert(penalties).values({
      membershipId: membership.id,
      sessionId: row.sessionId,
      bookingId: row.id,
      reason: 'no_show',
      bannedUntil: endsAt,
      permanent,
    });

    const ban = await recomputeBan(tx, membership.id, membership.status);
    const alreadyLapsed = !permanent && endsAt != null && endsAt.getTime() <= now.getTime();

    const cancelled: { bookingId: string; sessionId: string }[] = [];
    const promoted: { userId: string; sessionId: string }[] = [];
    const banBites = ban.permanent || (ban.bannedUntil != null && ban.bannedUntil.getTime() > now.getTime());

    if (banBites) {
      // Scoped to THIS club: banned_until lives on the membership, so a ban here
      // says nothing about the member's standing at another club.
      const bounds = [
        eq(bookings.userId, row.userId),
        eq(bookings.clubId, input.clubId),
        inArray(bookings.status, [...ACTIVE]),
        gt(slots.startAt, now),
      ];
      // A ban ending Wednesday must not take away next Monday's seat — the member
      // would be free to book it again the moment the ban lifts.
      if (!ban.permanent) bounds.push(lt(slots.startAt, ban.bannedUntil!));

      const future = await tx
        .select({ bookingId: bookings.id, sessionId: bookings.sessionId, capacity: sessions.capacity, slotStartAt: slots.startAt })
        .from(bookings)
        .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
        .innerJoin(slots, eq(slots.id, sessions.slotId))
        .where(and(...bounds))
        .orderBy(asc(slots.startAt), asc(bookings.id));

      for (const f of future) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.clubId}), hashtext(${f.slotStartAt.toISOString()}))`);
        await tx.update(bookings).set({ status: 'cancelled', queuePosition: null }).where(eq(bookings.id, f.bookingId));
        const { promotedUserId } = await applySeating(tx, f.sessionId, f.capacity, row.multisportMode);
        cancelled.push({ bookingId: f.bookingId, sessionId: f.sessionId });
        if (promotedUserId) promoted.push({ userId: promotedUserId, sessionId: f.sessionId });
      }
    }

    return { ok: true, bannedUntil: ban.bannedUntil, permanent: ban.permanent, alreadyLapsed, cancelled, promoted };
  });
}
```

- [ ] **Step 4: Run the integration tests**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test pnpm vitest run --no-file-parallelism src/lib/attendance.integration.test.ts`
Expected: PASS — all cases.

- [ ] **Step 5: Lint, types, full suite**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test:integration
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/attendance.ts src/lib/attendance.integration.test.ts
git commit -m "feat(attendance): mark a no-show, ban from the missed session, cascade the seats"
```

---

## Task 6: `undoNoShow` — reversing a mistaken mark

**Files:**
- Modify: `src/lib/attendance.ts`, `src/lib/attendance.integration.test.ts`

**Interfaces:**
- Consumes: everything from Task 5; `isUniqueViolation` (Task 3).
- Produces:

```typescript
export type UndoNoShowResult =
  | { ok: true; bannedUntil: Date | null; permanent: boolean }
  | { ok: false; error: 'not_found' | 'not_marked' | 'restore_conflict' };

export function undoNoShow(db: DB, input: { clubId: string; bookingId: string }): Promise<UndoNoShowResult>;
```

- [ ] **Step 1: Write the failing integration tests**

Append to `src/lib/attendance.integration.test.ts`, reusing that file's `seed` / `seedFutureSeat` helpers:

```typescript
describe.skipIf(!url)('undoNoShow', () => {
  it('restores the booking, deletes the penalty and lifts the ban', async () => {
    const ctx = await seed('1w');
    await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });

    const result = await undoNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id });
    expect(result).toEqual({ ok: true, bannedUntil: null, permanent: false });

    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, ctx.booking.id));
    expect(booking.status).toBe('booked');
    const rows = await db.select().from(schema.penalties).where(eq(schema.penalties.bookingId, ctx.booking.id));
    expect(rows).toEqual([]);
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, ctx.membership.id));
    expect(m.bannedUntil).toBeNull();
  });

  it('keeps the ban alive when another absence still stands', async () => {
    const ctx = await seed('1w');
    await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    const second = await seedFutureSeat(ctx, '2026-03-12');
    const later = zonedWallClockToUtc('2026-03-13', '20:00', TZ);
    await markNoShow(db, { clubId: ctx.club.id, bookingId: second.booking.id, now: later });

    // Undo the FIRST absence; the second still bans until 12 Mar + 7d = 19 Mar.
    const result = await undoNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bannedUntil).toEqual(zonedWallClockToUtc('2026-03-19', '07:00', TZ));
  });

  it('lifts a permanent ban back to approved', async () => {
    const ctx = await seed('never');
    await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    const result = await undoNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id });
    expect(result).toMatchObject({ ok: true, permanent: false });
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, ctx.membership.id));
    expect(m.status).toBe('approved');
  });

  it('does not restore the seats the cascade cancelled', async () => {
    const ctx = await seed('1w');
    const future = await seedFutureSeat(ctx, '2026-03-12');
    await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    await undoNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id });

    const [still] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, future.booking.id));
    expect(still.status).toBe('cancelled');
  });

  it('rejects a booking that was never marked', async () => {
    const ctx = await seed('1w');
    expect(await undoNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id })).toEqual({ ok: false, error: 'not_marked' });
  });

  it('rejects a booking belonging to another club', async () => {
    const ctx = await seed('1w');
    const other = await seed('1w');
    await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, now: NOW });
    expect(await undoNoShow(db, { clubId: other.club.id, bookingId: ctx.booking.id })).toEqual({ ok: false, error: 'not_found' });
  });
});
```

Add `undoNoShow` to the import at the top of the file.

- [ ] **Step 2: Run them to confirm they fail**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test pnpm vitest run --no-file-parallelism src/lib/attendance.integration.test.ts`
Expected: FAIL — `undoNoShow` is not exported.

- [ ] **Step 3: Implement `undoNoShow` in `src/lib/attendance.ts`**

Add the import and the function:

```typescript
import { isUniqueViolation } from './pg-errors';
```

```typescript
export type UndoNoShowResult =
  | { ok: true; bannedUntil: Date | null; permanent: boolean }
  | { ok: false; error: 'not_found' | 'not_marked' | 'restore_conflict' };

/**
 * Reverse a mistaken absence.
 *
 * Restores the booking, deletes its penalty row and recomputes the ban from
 * whatever remains — which may lift it, or may not, if another absence still
 * stands. Because `resolveBan` is a plain max, that recomputation needs no
 * replay of the order penalties were applied in.
 *
 * Seats the cascade cancelled are NOT restored: a promoted waitlister may now
 * genuinely hold that seat, and evicting them to repair the owner's slip only
 * moves the injustice. The owner re-seats by hand from the Bookings view.
 */
export async function undoNoShow(db: DB, input: { clubId: string; bookingId: string }): Promise<UndoNoShowResult> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: bookings.id, userId: bookings.userId, clubId: bookings.clubId, status: bookings.status })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId));
      if (!row || row.clubId !== input.clubId || !row.userId) return { ok: false, error: 'not_found' };
      if (row.status !== 'no_show') return { ok: false, error: 'not_marked' };

      const [membership] = await tx
        .select({ id: memberships.id, status: memberships.status })
        .from(memberships)
        .where(and(eq(memberships.userId, row.userId), eq(memberships.clubId, input.clubId)));
      if (!membership) return { ok: false, error: 'not_found' };

      // The session is in the past, so restoring the seat cannot overbook
      // anything that still matters physically; capacity there is history.
      await tx.update(bookings).set({ status: 'booked' }).where(eq(bookings.id, row.id));
      await tx.delete(penalties).where(and(eq(penalties.bookingId, row.id), eq(penalties.membershipId, membership.id)));

      const ban = await recomputeBan(tx, membership.id, membership.status);
      return { ok: true, bannedUntil: ban.bannedUntil, permanent: ban.permanent };
    });
  } catch (err) {
    // Restoring a multisport seat can collide with another multisport booking the
    // member acquired for that same past day while this one was marked absent.
    if (isUniqueViolation(err, 'bookings_multisport_day_uq')) return { ok: false, error: 'restore_conflict' };
    throw err;
  }
}
```

- [ ] **Step 4: Run the integration tests**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test pnpm vitest run --no-file-parallelism src/lib/attendance.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, types, full suite**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test:integration
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/attendance.ts src/lib/attendance.integration.test.ts
git commit -m "feat(attendance): undo a mistaken absence and recompute the ban"
```

---

## Task 7: Roster visibility and the combined penalty email

**Files:**
- Modify: `src/lib/roster.ts`, `src/lib/roster.integration.test.ts`
- Modify: `src/emails/index.ts`, `src/emails/booking-emails.test.ts`
- Modify: `src/lib/notify.ts`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `markNoShow` result shape (Task 5).
- Produces:
  - `RosterMember` gains `status: 'booked' | 'waitlisted' | 'no_show'`
  - `renderNoShowPenalty(locale: string, data: BookingWhen & { bannedUntil: Date | null; cancelledCount: number }): Promise<RenderedEmail>`
  - `notifyNoShowPenalty(db: DB, args: { bookingId: string; bannedUntil: Date | null; cancelledCount: number }): Promise<void>`

- [ ] **Step 1: Write the failing roster test**

Append to `src/lib/roster.integration.test.ts`:

```typescript
it('keeps a booking marked absent visible, and frees its seat', async () => {
  // Without this the owner would have nothing to undo: the roster filtered to
  // active statuses only, so marking a no-show made the row vanish.
  const { club } = await seed();
  // seed() creates a seated alice AND a waitlisted bob — scope to the seated one,
  // or this test silently marks the waitlister and proves nothing.
  const [row] = await db.select().from(schema.bookings)
    .where(and(eq(schema.bookings.clubId, club.id), eq(schema.bookings.status, 'booked')));
  await db.update(schema.bookings).set({ status: 'no_show' }).where(eq(schema.bookings.id, row.id));

  const roster = await getDayRoster(db, { clubId: club.id, dateISO: MON });
  const sess = roster.sessions.find((x) => x.startAt.getTime() === START.getTime())!;
  const marked = sess.seated.find((m) => m.bookingId === row.id);
  expect(marked).toBeDefined();
  expect(marked!.status).toBe('no_show');
  expect(sess.freeSeats).toBe(1);
});
```

Add `and` and `eq` to the `drizzle-orm` import in that file if they are not already there.

- [ ] **Step 2: Run it to confirm it fails**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test pnpm vitest run --no-file-parallelism src/lib/roster.integration.test.ts`
Expected: FAIL — `marked` is `undefined`, because the row was filtered out.

- [ ] **Step 3: Widen the roster in `src/lib/roster.ts`**

```typescript
// A no-show is still shown: the owner needs to see the mark to undo it. The
// previous active-only filter made a marked booking vanish from the roster.
const VISIBLE = ['booked', 'waitlisted', 'no_show'] as const;

export type RosterMember = {
  bookingId: string;
  name: string;
  paymentType: 'regular' | 'multisport';
  queuePosition: number | null;
  status: 'booked' | 'waitlisted' | 'no_show';
};
```

In the query, swap `inArray(bookings.status, [...ACTIVE])` for `inArray(bookings.status, [...VISIBLE])` and delete the now-unused `ACTIVE` constant.

In the bucketing loop, carry the status and put a no-show in the seated list:

```typescript
  for (const r of ordered) {
    const bucket = bySession.get(r.sessionId) ?? { seated: [], waitlisted: [] };
    const status = r.status as 'booked' | 'waitlisted' | 'no_show';
    const member: RosterMember = { bookingId: r.bookingId, name: r.name, paymentType: r.paymentType, queuePosition: r.queuePosition, status };
    if (status === 'waitlisted') bucket.waitlisted.push(member);
    else bucket.seated.push(member);
    bySession.set(r.sessionId, bucket);
  }
```

And count only genuinely-held seats as taken:

```typescript
        freeSeats: Math.max(0, s.capacity - roster.seated.filter((m) => m.status === 'booked').length),
```

- [ ] **Step 4: Run the roster test**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oarly_test pnpm vitest run --no-file-parallelism src/lib/roster.integration.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Add the email message keys**

In `messages/en.json`, under `emails.booking`, add a `noShow` block and two new labels:

```json
"noShow": {
  "subject": "You were marked absent",
  "heading": "You were marked absent",
  "intro": "The club recorded that you did not attend this session.",
  "introNoBan": "The club recorded that you did not attend this session. Your booking access is unaffected."
},
```

and inside the existing `emails.booking.labels` object:

```json
"bannedUntil": "Cannot book until",
"cancelledBookings": "Bookings cancelled"
```

In `messages/tr.json`, the same structure:

```json
"noShow": {
  "subject": "Katılmadığınız kaydedildi",
  "heading": "Katılmadığınız kaydedildi",
  "intro": "Kulüp bu seansa katılmadığınızı kaydetti.",
  "introNoBan": "Kulüp bu seansa katılmadığınızı kaydetti. Rezervasyon erişiminiz etkilenmedi."
},
```

and in `emails.booking.labels`:

```json
"bannedUntil": "Rezervasyon yapamayacağınız tarih",
"cancelledBookings": "İptal edilen rezervasyonlar"
```

- [ ] **Step 6: Write the failing email render test**

Append to `src/emails/booking-emails.test.ts`, matching how that file calls the other renderers:

```typescript
describe('renderNoShowPenalty', () => {
  const when = { clubName: 'Oarly RC', boatName: 'Quad', startAt: new Date('2026-03-10T04:00:00Z'), endAt: new Date('2026-03-10T05:00:00Z'), timezone: 'Europe/Istanbul' };

  it('states the ban end and the cancelled bookings', async () => {
    const email = await renderNoShowPenalty('en', { ...when, bannedUntil: new Date('2026-03-17T04:00:00Z'), cancelledCount: 2 });
    expect(email.subject).toBe('You were marked absent');
    expect(email.text).toContain('Cannot book until');
    expect(email.text).toContain('Bookings cancelled');
    expect(email.text).toContain('2');
  });

  it('omits the ban rows when no ban was imposed', async () => {
    const email = await renderNoShowPenalty('en', { ...when, bannedUntil: null, cancelledCount: 0 });
    expect(email.text).not.toContain('Cannot book until');
    expect(email.text).not.toContain('Bookings cancelled');
  });

  it('renders in Turkish', async () => {
    const email = await renderNoShowPenalty('tr', { ...when, bannedUntil: new Date('2026-03-17T04:00:00Z'), cancelledCount: 1 });
    expect(email.subject).toBe('Katılmadığınız kaydedildi');
  });
});
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `pnpm vitest run src/emails/booking-emails.test.ts`
Expected: FAIL — `renderNoShowPenalty` is not exported.

- [ ] **Step 8: Add the renderer to `src/emails/index.ts`**

Append, reusing the existing `renderNotice` / `baseRows` helpers:

```typescript
export async function renderNoShowPenalty(
  locale: string,
  data: BookingWhen & { bannedUntil: Date | null; cancelledCount: number },
): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  const rows = baseRows(t, data, validLocale);
  if (data.bannedUntil) {
    rows.push({
      label: t('booking.labels.bannedUntil'),
      value: new Intl.DateTimeFormat(validLocale, { timeZone: data.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(data.bannedUntil),
    });
  }
  if (data.cancelledCount > 0) {
    rows.push({ label: t('booking.labels.cancelledBookings'), value: String(data.cancelledCount) });
  }
  // One notice, not three: the cascade would otherwise fire a cancellation email
  // per seat alongside this one, all within a second, leaving the member to
  // reassemble the story themselves.
  const intro = data.bannedUntil ? t('booking.noShow.intro') : t('booking.noShow.introNoBan');
  return renderNotice(validLocale, t('booking.noShow.subject'), t('booking.noShow.heading'), intro, rows);
}
```

- [ ] **Step 9: Run the email tests**

Run: `pnpm vitest run src/emails/booking-emails.test.ts`
Expected: PASS.

- [ ] **Step 10: Add `notifyNoShowPenalty` to `src/lib/notify.ts`**

Add `renderNoShowPenalty` to the `@/emails` import, then append:

```typescript
/** Best-effort: emails the single combined no-show notice. Never throws. */
export async function notifyNoShowPenalty(
  db: DB,
  { bookingId, bannedUntil, cancelledCount }: { bookingId: string; bannedUntil: Date | null; cancelledCount: number },
): Promise<void> {
  try {
    const ctx = await loadCtx(db, eq(bookings.id, bookingId));
    if (!ctx) return;
    const email = await renderNoShowPenalty(ctx.locale, { clubName: ctx.clubName, boatName: ctx.boatName, startAt: ctx.startAt, endAt: ctx.endAt, timezone: ctx.timezone, bannedUntil, cancelledCount });
    await sendEmail({ to: ctx.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyNoShowPenalty failed', err);
  }
}
```

- [ ] **Step 11: Verify parity, lint, types, full suite**

```bash
node -e "
const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v?flat(v,p+k+'.'):[p+k]);
const en=flat(require('./messages/en.json')), tr=flat(require('./messages/tr.json'));
const miss=(a,b)=>a.filter(k=>!b.includes(k));
console.log('missing in tr:',miss(en,tr)); console.log('missing in en:',miss(tr,en));
"
pnpm lint && pnpm exec tsc --noEmit && pnpm test:integration
```

Expected: parity lists empty; everything green.

- [ ] **Step 12: Commit**

```bash
git add src/lib/roster.ts src/lib/roster.integration.test.ts src/emails/index.ts src/emails/booking-emails.test.ts src/lib/notify.ts messages/
git commit -m "feat(attendance): keep absences on the roster and send one combined notice"
```

---

## Task 8: Owner attendance UI

**Files:**
- Create: `app/s/[slug]/manage/bookings/attendance-actions.ts`
- Modify: `app/s/[slug]/manage/bookings/page.tsx`, `app/s/[slug]/manage/bookings/bookings-roster.tsx`
- Modify: `app/s/[slug]/manage/members/page.tsx`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `markNoShow` / `undoNoShow` (Tasks 5-6); `notifyNoShowPenalty` (Task 7); `RosterMember.status` (Task 7); `penaltyEndsAt` (Task 2).
- Produces:
  - `type MarkActionResult = { ok: true; cancelled: number } | { ok: false }`
  - `markNoShowAction(slug, prev, formData)`, `undoNoShowAction(slug, prev, formData)`
  - `type RosterSessionWithPenalty = RosterSession & { banEndsAt: Date | null; banPermanent: boolean; banLapsed: boolean }`

- [ ] **Step 1: Add the i18n keys**

In `messages/en.json`, under `manage.bookings`:

```json
"markAbsent": "Mark absent",
"undoAbsent": "Undo",
"absent": "Absent",
"confirmAbsentTitle": "Mark {name} absent?",
"confirmAbsentBan": "They will not be able to book until {date}. Any seats they hold before then will be cancelled and given to the waitlist.",
"confirmAbsentPermanent": "Their booking access will be suspended, and every upcoming seat they hold will be cancelled and given to the waitlist.",
"confirmAbsentLapsed": "This session is old enough that the ban has already lapsed. The absence will be recorded but will not restrict booking.",
"confirmAbsentNoPenalty": "This club does not penalise no-shows, so the absence will be recorded without any ban.",
"confirmAbsentCta": "Mark absent",
"marked": "Absence recorded.",
"markedWithCancellations": "Absence recorded. {count} upcoming bookings were cancelled.",
"undone": "Absence removed. Any seats this penalty cancelled were not restored.",
"bannedUntilBadge": "Banned until {date}",
"bannedBadge": "Suspended",
```

In `messages/tr.json`, the same keys:

```json
"markAbsent": "Katılmadı",
"undoAbsent": "Geri al",
"absent": "Katılmadı",
"confirmAbsentTitle": "{name} katılmadı olarak işaretlensin mi?",
"confirmAbsentBan": "{date} tarihine kadar rezervasyon yapamayacak. O tarihe kadar tuttuğu yerler iptal edilip bekleme listesine verilecek.",
"confirmAbsentPermanent": "Rezervasyon erişimi askıya alınacak ve tuttuğu tüm ileri tarihli yerler iptal edilip bekleme listesine verilecek.",
"confirmAbsentLapsed": "Bu seans yeterince eski olduğu için ceza süresi çoktan doldu. Katılmama kaydedilecek ama rezervasyonu kısıtlamayacak.",
"confirmAbsentNoPenalty": "Bu kulüp katılmama durumunda ceza uygulamıyor; kayıt tutulacak ama ceza verilmeyecek.",
"confirmAbsentCta": "Katılmadı olarak işaretle",
"marked": "Katılmama kaydedildi.",
"markedWithCancellations": "Katılmama kaydedildi. {count} ileri tarihli rezervasyon iptal edildi.",
"undone": "Katılmama kaydı kaldırıldı. Bu ceza nedeniyle iptal edilen yerler geri alınmadı.",
"bannedUntilBadge": "{date} tarihine kadar yasaklı",
"bannedBadge": "Askıya alındı",
```

- [ ] **Step 2: Create the server actions**

Create `app/s/[slug]/manage/bookings/attendance-actions.ts`:

```typescript
'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import * as z from 'zod';

import { db } from '@/db';
import { markNoShow, undoNoShow } from '@/lib/attendance';
import { requireOwner } from '@/lib/membership';
import { notifyNoShowPenalty, notifyWaitlistPromotion } from '@/lib/notify';

import type { ManageActionResult } from '../action-result';

/** Richer than ManageActionResult so the toast can report how many seats the cascade took. */
export type MarkActionResult = { ok: true; cancelled: number } | { ok: false };

const bookingSchema = z.object({ bookingId: z.uuid() });

export async function markNoShowAction(slug: string, _prev: MarkActionResult | null, formData: FormData): Promise<MarkActionResult> {
  const { club } = await requireOwner(slug, '/manage/bookings');
  const parsed = bookingSchema.safeParse({ bookingId: formData.get('bookingId') });
  if (!parsed.success) return { ok: false };

  const result = await markNoShow(db, { clubId: club.id, bookingId: parsed.data.bookingId });
  if (!result.ok) return { ok: false };

  revalidatePath(`/s/${slug}/manage/bookings`);
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);

  // One combined notice to the penalised member — the per-seat cancellation
  // emails are deliberately suppressed on this path, because three unrelated
  // emails arriving at once read as a bug. Promoted waitlisters still get their
  // ordinary promotion mail: from their side nothing unusual happened.
  after(async () => {
    await notifyNoShowPenalty(db, { bookingId: parsed.data.bookingId, bannedUntil: result.bannedUntil, cancelledCount: result.cancelled.length });
    for (const p of result.promoted) await notifyWaitlistPromotion(db, p);
  });

  return { ok: true, cancelled: result.cancelled.length };
}

export async function undoNoShowAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug, '/manage/bookings');
  const parsed = bookingSchema.safeParse({ bookingId: formData.get('bookingId') });
  if (!parsed.success) return { ok: false };

  const result = await undoNoShow(db, { clubId: club.id, bookingId: parsed.data.bookingId });
  if (!result.ok) return { ok: false };

  revalidatePath(`/s/${slug}/manage/bookings`);
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);
  return { ok: true };
}
```

- [ ] **Step 3: Compute the ban preview in the page**

In `app/s/[slug]/manage/bookings/page.tsx`, add the import:

```typescript
import { penaltyEndsAt } from '@/lib/penalty';
```

and enrich the sessions before handing them to the component. The dialog needs no preview round-trip: `penaltyEndsAt` is pure and the page already holds the session start, the club timezone and the club policy.

```typescript
  const now = new Date();
  const sessions = roster.sessions.map((s) => {
    const ends = penaltyEndsAt({ sessionStartAt: s.startAt, timezone: club.timezone, policy: club.noshowPenalty });
    const permanent = ends === 'permanent';
    const endsAt = permanent ? null : ends;
    return {
      ...s,
      banEndsAt: endsAt,
      banPermanent: permanent,
      banLapsed: !permanent && endsAt != null && endsAt.getTime() <= now.getTime(),
    };
  });
```

then pass `sessions={sessions}` instead of `sessions={roster.sessions}`.

- [ ] **Step 4: Add the mark/undo UI to `bookings-roster.tsx`**

Add these imports (`RosterSession` is already imported; the rest are new):

```typescript
import { StatusPill } from '@/components/booking-status-badge';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { type MarkActionResult, markNoShowAction, undoNoShowAction } from './attendance-actions';
```

**Never import `penaltyEndsAt` here.** This is a client component, and that module reaches `date-fns-tz` through `date-tz.ts` — importing it would pull the whole timezone database into the browser bundle. The page computed the preview already; take it as props.

Define the enriched type and widen the component props:

```typescript
export type RosterSessionWithPenalty = RosterSession & {
  banEndsAt: Date | null;
  banPermanent: boolean;
  banLapsed: boolean;
};

export function BookingsRoster({ slug, sessions, timezone, closed = false }: {
  slug: string;
  sessions: RosterSessionWithPenalty[];
  timezone: string;
  closed?: boolean;
}) {
```

Add the two action states alongside the existing remove/add ones, following the same stable-parent pattern (a successful action revalidates and can unmount the row, so a row-local toast effect would be dropped):

```typescript
  const [markState, markAction, markPending] = useActionState<MarkActionResult | null, FormData>(markNoShowAction.bind(null, slug), null);
  const markHandled = useRef<MarkActionResult | null>(null);
  useEffect(() => {
    if (markState === null || markState === markHandled.current) return;
    markHandled.current = markState;
    if (!markState.ok) toast.error(tm('actionError'));
    else if (markState.cancelled > 0) toast.success(t('markedWithCancellations', { count: markState.cancelled }));
    else toast.success(t('marked'));
  }, [markState, t, tm]);

  const [undoState, undoAction, undoPending] = useActionState<ManageActionResult | null, FormData>(undoNoShowAction.bind(null, slug), null);
  const undoHandled = useRef<ManageActionResult | null>(null);
  useEffect(() => {
    if (undoState === null || undoState === undoHandled.current) return;
    undoHandled.current = undoState;
    if (undoState.ok) toast.success(t('undone'));
    else toast.error(tm('actionError'));
  }, [undoState, t, tm]);
```

Track which rower the confirm dialog is for:

```typescript
  const [confirming, setConfirming] = useState<{ bookingId: string; name: string; session: RosterSessionWithPenalty } | null>(null);
```

In the seated list, replace the single Remove button with a status-dependent control. A marked rower shows the Absent pill and Undo; a seated rower on a session that has started can be marked:

```tsx
                  {s.seated.map((m) => (
                    <li key={m.bookingId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{m.name}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {m.status === 'no_show' ? (
                          <>
                            <StatusPill tone="bad">{t('absent')}</StatusPill>
                            <form action={undoAction}>
                              <input type="hidden" name="bookingId" value={m.bookingId} />
                              <Button type="submit" size="sm" variant="ghost" disabled={undoPending}>{t('undoAbsent')}</Button>
                            </form>
                          </>
                        ) : (
                          <>
                            {s.startAt.getTime() <= Date.now() && (
                              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming({ bookingId: m.bookingId, name: m.name, session: s })}>
                                {t('markAbsent')}
                              </Button>
                            )}
                            <form action={rmAction}>
                              <input type="hidden" name="bookingId" value={m.bookingId} />
                              <Button type="submit" size="sm" variant="ghost" disabled={rmPending}>{t('remove')}</Button>
                            </form>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
```

Import `StatusPill` from `@/components/booking-status-badge`.

Render one dialog for the whole list, after the sessions map, keyed so each open starts fresh:

```tsx
      <Dialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        <DialogContent>
          {confirming && (
            <form action={markAction} onSubmit={() => setConfirming(null)} className="flex flex-col gap-4">
              <input type="hidden" name="bookingId" value={confirming.bookingId} />
              <DialogHeader>
                <DialogTitle>{t('confirmAbsentTitle', { name: confirming.name })}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {confirming.session.banPermanent
                  ? t('confirmAbsentPermanent')
                  : confirming.session.banEndsAt === null
                    ? t('confirmAbsentNoPenalty')
                    : confirming.session.banLapsed
                      ? t('confirmAbsentLapsed')
                      : t('confirmAbsentBan', { date: fmtDate(confirming.session.banEndsAt, timezone) })}
              </p>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="ghost" />}>{tm('cancel')}</DialogClose>
                <Button type="submit" variant="destructive" disabled={markPending}>{t('confirmAbsentCta')}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
```

Add the date formatter beside the existing `fmt` helper at the bottom of the file:

```typescript
const fmtDate = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
```

If `manage.cancel` does not already exist in the messages, add `"cancel": "Cancel"` / `"cancel": "Vazgeç"` under `manage` in both files — check first with the parity script.

- [ ] **Step 5: Add the ban badge to the Members page**

In `app/s/[slug]/manage/members/page.tsx`, import the pill:

```typescript
import { StatusPill } from '@/components/booking-status-badge';
```

and in the approved-members list, beside the member's name, render a read-only badge so an owner can see at a glance why someone cannot book:

```tsx
                    <div className="flex flex-col gap-0.5">
                      <span className="font-heading text-sm font-semibold">{r.name}</span>
                      <span className="text-xs text-muted-foreground">{r.email}</span>
                      {r.membership.status === 'banned' ? (
                        <StatusPill tone="bad">{t('bookings.bannedBadge')}</StatusPill>
                      ) : r.membership.bannedUntil && r.membership.bannedUntil.getTime() > Date.now() ? (
                        <StatusPill tone="warn">{t('bookings.bannedUntilBadge', { date: r.membership.bannedUntil.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) })}</StatusPill>
                      ) : null}
                    </div>
```

That page's `t` is scoped to `manage`, so the keys resolve as `manage.bookings.bannedBadge`. Also widen the list it renders: `approved` currently filters `status === 'approved'`, which now hides a permanently banned member entirely. Change it to:

```typescript
  const approved = rows.filter((r) => r.membership.status === 'approved' || r.membership.status === 'banned');
```

- [ ] **Step 6: Verify parity, lint, types, tests, build**

```bash
node -e "
const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'&&v?flat(v,p+k+'.'):[p+k]);
const en=flat(require('./messages/en.json')), tr=flat(require('./messages/tr.json'));
const miss=(a,b)=>a.filter(k=>!b.includes(k));
console.log('missing in tr:',miss(en,tr)); console.log('missing in en:',miss(tr,en));
"
pnpm lint && pnpm exec tsc --noEmit && pnpm test:integration && pnpm build
```

Expected: parity lists empty; lint 0; no type errors; all tests pass; build succeeds. `pnpm build` runs `scripts/deploy-migrate.mjs` first, which is a no-op locally because `VERCEL_ENV` is unset.

- [ ] **Step 7: Manual smoke against the dev server**

```bash
docker compose up -d && pnpm dev
```

Walk through, on a club subdomain:
1. `/manage/bookings`, navigate to a **past** day with a seated member → **Mark absent** is offered. On a future day it is not.
2. Open the dialog → it names the member and the ban end date.
3. Confirm → toast reports the absence, and the cancelled count if the member held upcoming seats.
4. The row now shows the **Absent** pill and **Undo**; the seat count went up by one.
5. `/manage/members` → that member carries the ban badge.
6. Sign in as that member → `/book` shows the ban banner (not a 404) and every session is locked.
7. **Undo** on the roster → toast says the cancelled seats were not restored; the member can book again.

- [ ] **Step 8: Commit**

```bash
git add "app/s/[slug]/manage" messages/
git commit -m "feat(manage): mark and undo absences from the day roster"
```

---

## Verification (whole branch, before merge)

- [ ] `pnpm lint` — 0 warnings
- [ ] `pnpm exec tsc --noEmit` — no errors
- [ ] `pnpm test:integration` — full unit + integration suite green
- [ ] `pnpm build` — clean
- [ ] i18n parity script — both "missing in" lists empty
- [ ] Task 8's manual smoke walked end to end

Then use **superpowers:requesting-code-review** for a whole-branch review, and **superpowers:finishing-a-development-branch** to merge (`--no-ff`, **keep the branch**, do not delete it).
