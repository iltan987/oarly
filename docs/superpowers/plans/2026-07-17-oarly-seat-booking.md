# Seat Booking Engine + Member UI (Plan 5C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an approved club member book (or waitlist for) a seat in a boat-session from a member calendar and cancel their own bookings, backed by a deterministic, concurrency-safe seating engine.

**Architecture:** Pure-core (`eligibility`, `seating`) + transactional orchestrator (`booking`) consuming the 5B `materializeSlot` seam under a per-slot Postgres advisory lock, plus a member-facing calendar wrapper (`member-calendar`) over 5B `computeCalendar`, and two authenticated Next.js routes (`/book`, `/bookings`).

**Tech Stack:** Next.js 16 App Router, React 19 server actions + `useActionState`, Drizzle ORM + Postgres, Base UI (shadcn `base-nova`), next-intl, vitest (unit + real-PG integration).

## Global Constraints

- **No migration.** Every column/index needed already exists (Foundation): `bookings` (`sessionId`, `clubId`, `userId`, `paymentType`, `status`, `queuePosition`, `slotIndex`, `effectiveAt`, `source`, `hidden`, `idempotencyKey`; partial unique indexes `bookings_active_uq` on `(sessionId,userId)` where status ∈ (`booked`,`waitlisted`) and `bookings_idem_uq` on `(userId,idempotencyKey)` where key not null), `sessions` (`capacity`, `minAttendance`, `status`), and the club policy columns. `priority_rank` is **derived, never stored**.
- **Pure-core + thin-adapter.** Logic in `src/lib/*` takes `db: DB` first (`import type { DB } from '@/db'`), is `clubId`-scoped on every write, returns plain data / discriminated unions, and never calls revalidate/redirect/headers. Server actions under `app/s/[slug]/*` are thin: guard → zod `safeParse` (server-authoritative) → pure-core → `revalidatePath('/s/${slug}/...')`. `club.id` and `user.id` come from the guard, never client input.
- **Slot identity is exact-UTC `(clubId, startAt)`.** The booking path must not re-derive `startAt` by a different route; it recomputes the block start with the same `zonedWallClockToUtc` the calendar uses and validates the client value against it.
- **Concurrency guarantee comes from the DB.** Per-slot `pg_advisory_xact_lock(hashtext(clubId), hashtext(startAt.toISOString()))` serializes materialize + seat inside one transaction; `bookings_active_uq` is the backstop. No rate-limiter in 5C.
- **Silent state changes.** No email in 5C: auto-promotion / displacement change state only (visible in My Bookings).
- **Weekday convention:** `0 = Sunday … 6 = Saturday`. **Timezone:** store UTC, display club-local (`clubs.timezone`). Only `src/lib/date-tz.ts` imports `date-fns-tz`.
- **Skill rank:** higher `skill_levels.rank` = more advanced (levels are appended with increasing rank). Eligibility requires `memberSkillRank >= boatMinSkillRank` (spec §7).
- **Never hand-edit `src/components/ui/*`** (shadcn CLI-add only). **Lint:** `pnpm lint` = `eslint --max-warnings 0` (simple-import-sort + no-unused-imports enforced).
- **Payment default:** read `user.defaultPaymentType` (already exists). Setting it is out of scope.

---

## File Structure

- `src/lib/eligibility.ts` (new) — pure eligibility gate. Test: `src/lib/eligibility.test.ts`.
- `src/lib/seating.ts` (new) — pure deterministic seating function. Test: `src/lib/seating.test.ts`.
- `src/lib/calendar.ts` (modify) — extend `VirtualSession` (sessionId, minSkillRank, allowedPayment); surface persisted slots on closed days. Test: `src/lib/calendar.integration.test.ts` (add cases).
- `src/lib/materialize.ts` (modify) — extract `findOrCreateSlotTx(tx, input)` (tx-scoped, empty-boats guard, returns capacity); `materializeSlot` wraps it. Test: `src/lib/materialize.integration.test.ts` (add case).
- `src/lib/booking.ts` (new) — `bookSeat` + `cancelBooking`. Test: `src/lib/booking.integration.test.ts`.
- `src/lib/member-calendar.ts` (new) — `computeMemberCalendar`. Test: `src/lib/member-calendar.integration.test.ts`.
- `src/lib/membership.ts` (modify) — add `requireMember`.
- `app/s/[slug]/book/{page.tsx,actions.ts,book-calendar.tsx}` (new) — member booking calendar.
- `app/s/[slug]/bookings/{page.tsx,actions.ts,bookings-list.tsx}` (new) — My Bookings.
- `messages/en.json`, `messages/tr.json` (modify) — new `booking` namespace.

---

## Task 1: Eligibility gate (pure)

**Files:**
- Create: `src/lib/eligibility.ts`
- Test: `src/lib/eligibility.test.ts`

**Interfaces:**
- Produces: `type EligibilityReason = 'not_approved' | 'banned' | 'skill_too_low' | 'payment_not_allowed'`; `type EligibilityResult = { ok: true } | { ok: false; reason: EligibilityReason }`; `function checkEligibility(input): EligibilityResult` where `input = { membershipStatus: 'pending'|'approved'|'rejected'|'banned'|null; bannedUntil: Date | null; memberSkillRank: number | null; boatMinSkillRank: number | null; boatAllowedPayment: 'regular_only'|'multisport_only'|'both'; paymentType: 'regular'|'multisport'; now: Date }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/eligibility.test.ts
import { describe, expect, it } from 'vitest';

import { checkEligibility } from './eligibility';

const base = {
  membershipStatus: 'approved' as const,
  bannedUntil: null as Date | null,
  memberSkillRank: null as number | null,
  boatMinSkillRank: null as number | null,
  boatAllowedPayment: 'both' as const,
  paymentType: 'regular' as const,
  now: new Date('2026-07-17T00:00:00Z'),
};

describe('checkEligibility', () => {
  it('passes when approved, no skill min, payment allowed', () => {
    expect(checkEligibility(base)).toEqual({ ok: true });
  });

  it('rejects a non-approved membership', () => {
    expect(checkEligibility({ ...base, membershipStatus: 'pending' })).toEqual({ ok: false, reason: 'not_approved' });
    expect(checkEligibility({ ...base, membershipStatus: null })).toEqual({ ok: false, reason: 'not_approved' });
  });

  it('rejects while a ban is active but passes once it has lapsed', () => {
    expect(checkEligibility({ ...base, bannedUntil: new Date('2026-07-18T00:00:00Z') })).toEqual({ ok: false, reason: 'banned' });
    expect(checkEligibility({ ...base, bannedUntil: new Date('2026-07-16T00:00:00Z') })).toEqual({ ok: true });
  });

  it('rejects when the member rank is below the boat minimum or unset', () => {
    expect(checkEligibility({ ...base, boatMinSkillRank: 2, memberSkillRank: 1 })).toEqual({ ok: false, reason: 'skill_too_low' });
    expect(checkEligibility({ ...base, boatMinSkillRank: 2, memberSkillRank: null })).toEqual({ ok: false, reason: 'skill_too_low' });
    expect(checkEligibility({ ...base, boatMinSkillRank: 2, memberSkillRank: 2 })).toEqual({ ok: true });
    expect(checkEligibility({ ...base, boatMinSkillRank: 2, memberSkillRank: 3 })).toEqual({ ok: true });
  });

  it('enforces payment allow-list', () => {
    expect(checkEligibility({ ...base, boatAllowedPayment: 'regular_only', paymentType: 'multisport' })).toEqual({ ok: false, reason: 'payment_not_allowed' });
    expect(checkEligibility({ ...base, boatAllowedPayment: 'multisport_only', paymentType: 'regular' })).toEqual({ ok: false, reason: 'payment_not_allowed' });
    expect(checkEligibility({ ...base, boatAllowedPayment: 'multisport_only', paymentType: 'multisport' })).toEqual({ ok: true });
  });

  it('applies rules in order: membership before skill', () => {
    expect(checkEligibility({ ...base, membershipStatus: 'banned', boatMinSkillRank: 9, memberSkillRank: 0 })).toEqual({ ok: false, reason: 'not_approved' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/eligibility.test.ts`
Expected: FAIL — cannot find module `./eligibility`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/eligibility.ts
export type EligibilityReason = 'not_approved' | 'banned' | 'skill_too_low' | 'payment_not_allowed';
export type EligibilityResult = { ok: true } | { ok: false; reason: EligibilityReason };

/**
 * The §7 booking-time gate: a member may take a seat only if all hold —
 * (1) membership is `approved` and not currently banned,
 * (2) member skill rank ≥ the boat's minimum (higher rank = more advanced),
 * (3) the chosen payment type is permitted by the boat's allow-list.
 * Pure; rules evaluated in this order so the first failure is the reason returned.
 */
export function checkEligibility(input: {
  membershipStatus: 'pending' | 'approved' | 'rejected' | 'banned' | null;
  bannedUntil: Date | null;
  memberSkillRank: number | null;
  boatMinSkillRank: number | null;
  boatAllowedPayment: 'regular_only' | 'multisport_only' | 'both';
  paymentType: 'regular' | 'multisport';
  now: Date;
}): EligibilityResult {
  if (input.membershipStatus !== 'approved') return { ok: false, reason: 'not_approved' };
  if (input.bannedUntil && input.bannedUntil.getTime() > input.now.getTime()) return { ok: false, reason: 'banned' };
  if (input.boatMinSkillRank != null) {
    if (input.memberSkillRank == null || input.memberSkillRank < input.boatMinSkillRank) {
      return { ok: false, reason: 'skill_too_low' };
    }
  }
  if (input.boatAllowedPayment === 'regular_only' && input.paymentType !== 'regular') return { ok: false, reason: 'payment_not_allowed' };
  if (input.boatAllowedPayment === 'multisport_only' && input.paymentType !== 'multisport') return { ok: false, reason: 'payment_not_allowed' };
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/eligibility.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Lint & commit**

```bash
pnpm lint
git add src/lib/eligibility.ts src/lib/eligibility.test.ts
git commit -m "feat(5C): pure eligibility gate"
```

---

## Task 2: Seating function (pure)

**Files:**
- Create: `src/lib/seating.ts`
- Test: `src/lib/seating.test.ts`

**Interfaces:**
- Produces: `type SeatAssignment = { id: string; status: 'booked' | 'waitlisted'; queuePosition: number | null }`; `function computeSeating(entries: { id: string; paymentType: 'regular'|'multisport'; effectiveAt: Date }[], capacity: number, mode: 'equal'|'priority'): SeatAssignment[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/seating.test.ts
import { describe, expect, it } from 'vitest';

import { computeSeating } from './seating';

const at = (iso: string) => new Date(iso);
const reg = (id: string, iso: string) => ({ id, paymentType: 'regular' as const, effectiveAt: at(iso) });
const ms = (id: string, iso: string) => ({ id, paymentType: 'multisport' as const, effectiveAt: at(iso) });

describe('computeSeating', () => {
  it('seats the first `capacity` by arrival in equal mode; waitlists the rest with 1-based positions', () => {
    const out = computeSeating([reg('a', '2026-07-17T09:00:00Z'), reg('b', '2026-07-17T09:01:00Z'), reg('c', '2026-07-17T09:02:00Z')], 2, 'equal');
    expect(out).toEqual([
      { id: 'a', status: 'booked', queuePosition: null },
      { id: 'b', status: 'booked', queuePosition: null },
      { id: 'c', status: 'waitlisted', queuePosition: 1 },
    ]);
  });

  it('equal mode ignores payment type entirely (FCFS)', () => {
    const out = computeSeating([ms('a', '2026-07-17T09:00:00Z'), reg('b', '2026-07-17T09:01:00Z')], 1, 'equal');
    expect(out.find((x) => x.id === 'a')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'b')!.status).toBe('waitlisted');
  });

  it('priority mode: a later regular outranks an earlier multisport (displacement)', () => {
    const out = computeSeating([ms('m', '2026-07-17T09:00:00Z'), reg('r', '2026-07-17T09:05:00Z')], 1, 'priority');
    expect(out.find((x) => x.id === 'r')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'm')!).toEqual({ id: 'm', status: 'waitlisted', queuePosition: 1 });
  });

  it('priority mode: within the same rank, earlier arrival wins', () => {
    const out = computeSeating([reg('r2', '2026-07-17T09:05:00Z'), reg('r1', '2026-07-17T09:00:00Z')], 1, 'priority');
    expect(out.find((x) => x.id === 'r1')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'r2')!.status).toBe('waitlisted');
  });

  it('breaks exact-time ties deterministically by id', () => {
    const t = '2026-07-17T09:00:00Z';
    const out = computeSeating([reg('b', t), reg('a', t)], 1, 'equal');
    expect(out.find((x) => x.id === 'a')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'b')!.status).toBe('waitlisted');
  });

  it('returns an empty array for no entries and seats all when under capacity', () => {
    expect(computeSeating([], 4, 'equal')).toEqual([]);
    const out = computeSeating([reg('a', '2026-07-17T09:00:00Z')], 4, 'equal');
    expect(out).toEqual([{ id: 'a', status: 'booked', queuePosition: null }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/seating.test.ts`
Expected: FAIL — cannot find module `./seating`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/seating.ts
export type SeatAssignment = { id: string; status: 'booked' | 'waitlisted'; queuePosition: number | null };

/**
 * The single deterministic §9 seating decision for ONE session. Given the active
 * bookings (booked|waitlisted), the session capacity, and the club's MultiSport mode,
 * returns each booking's resolved status + waitlist position. Pure — no DB, no time source.
 * Order: (priorityRank asc, effectiveAt asc, id asc). priorityRank = 1 only for a MultiSport
 * booking in `priority` mode, else 0. Top `capacity` are seated; the remainder are waitlisted
 * with 1-based positions in the same order.
 */
export function computeSeating(
  entries: { id: string; paymentType: 'regular' | 'multisport'; effectiveAt: Date }[],
  capacity: number,
  mode: 'equal' | 'priority',
): SeatAssignment[] {
  const rankOf = (p: 'regular' | 'multisport') => (mode === 'priority' && p === 'multisport' ? 1 : 0);
  const sorted = [...entries].sort((a, b) => {
    const ra = rankOf(a.paymentType);
    const rb = rankOf(b.paymentType);
    if (ra !== rb) return ra - rb;
    const ta = a.effectiveAt.getTime();
    const tb = b.effectiveAt.getTime();
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  let waitlist = 0;
  return sorted.map((e, i) =>
    i < capacity
      ? { id: e.id, status: 'booked' as const, queuePosition: null }
      : { id: e.id, status: 'waitlisted' as const, queuePosition: ++waitlist },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/seating.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Lint & commit**

```bash
pnpm lint
git add src/lib/seating.ts src/lib/seating.test.ts
git commit -m "feat(5C): pure deterministic seating function"
```

---

## Task 3: Calendar — expose eligibility fields + surface bookings on closed days

**Files:**
- Modify: `src/lib/calendar.ts` (full replacement below)
- Test: `src/lib/calendar.integration.test.ts` (add two cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `VirtualSession` gains `sessionId: string | null`, `minSkillRank: number | null`, `allowedPayment: 'regular_only'|'multisport_only'|'both'`. On a **closed** day, persisted (already-materialized) slots are surfaced read-only (day stays `closed: true`) instead of dropped.

- [ ] **Step 1: Add the failing tests**

Append inside the existing top-level `describe.skipIf(!url)('computeCalendar', …)` block in `src/lib/calendar.integration.test.ts`. These reuse that file's existing seed helpers (`newClub`, `newBoat`, `newWindow`, and its `materializeSlot` import). If a helper name differs, match the file's actual helpers.

```ts
  it('exposes minSkillRank and allowedPayment on virtual sessions', async () => {
    const c = await newClub('cal-elig');
    const [lvl] = await db.insert(schema.skillLevels).values({ clubId: c.id, name: 'Intermediate', rank: 2 }).returning();
    await db.insert(schema.boatTypes).values({ clubId: c.id, name: 'Quad', seats: 4, minSkillLevelId: lvl.id, allowedPayment: 'multisport_only' }).returning();
    // window on Monday 2026-07-20, 08:00–09:00 local
    const [w] = await db.insert(schema.scheduleWindows).values({ clubId: c.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60 }).returning();
    const [boat] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.clubId, c.id));
    await db.insert(schema.windowBoats).values({ windowId: w.id, boatTypeId: boat.id, quantity: 1 });

    const days = await computeCalendar(db, c.id, { fromDateISO: '2026-07-20', days: 1 });
    const session = days[0].slots[0].sessions[0];
    expect(session.minSkillRank).toBe(2);
    expect(session.allowedPayment).toBe('multisport_only');
    expect(session.sessionId).toBeNull();
  });

  it('surfaces persisted (booked) slots on a force-closed day instead of dropping them', async () => {
    const c = await newClub('cal-closed');
    const boat = await newBoat(c.id, 'Single', 1);
    const w = await newWindow(c.id); // Monday 08:00–09:00 60m from the file helper
    const startAt = new Date('2026-07-20T05:00:00.000Z'); // 08:00 Europe/Istanbul
    await materializeSlot(db, { clubId: c.id, dateISO: '2026-07-20', startAt, endAt: new Date('2026-07-20T06:00:00.000Z'), windowId: w.id, boats: [{ boatTypeId: boat.id, capacity: 1, minAttendance: null, quantity: 1 }] });
    // force-close that date
    await db.insert(schema.clubHolidayOverrides).values({ clubId: c.id, date: '2026-07-20', isOpen: false });

    const days = await computeCalendar(db, c.id, { fromDateISO: '2026-07-20', days: 1 });
    expect(days[0].closed).toBe(true);
    expect(days[0].closedReason).toBe('override');
    expect(days[0].slots).toHaveLength(1);
    expect(days[0].slots[0].persisted).toBe(true);
    expect(days[0].slots[0].sessions[0].sessionId).not.toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:integration src/lib/calendar.integration.test.ts`
Expected: FAIL — `minSkillRank`/`allowedPayment`/`sessionId` undefined; closed day has 0 slots.

- [ ] **Step 3: Replace `src/lib/calendar.ts` with this full version**

```ts
import { addMinutes } from 'date-fns';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, clubHolidayOverrides, clubs, holidays, scheduleWindows, sessions, skillLevels, slots, windowBoats } from '@/db/schema';

import { resolveDateOpen } from './calendar-rules';
import { addDaysISO, eachDateISO, minutesToHHMM, toMinutes, utcToClubDate, weekdayOfDateISO, zonedWallClockToUtc } from './date-tz';

export type AllowedPayment = 'regular_only' | 'multisport_only' | 'both';

export type VirtualSession = {
  sessionId: string | null;       // real id when persisted; null for a virtual (unmaterialized) session
  boatTypeId: string;
  boatName: string;
  capacity: number;
  minAttendance: number | null;
  minSkillRank: number | null;    // boat's current minimum skill rank (null = no requirement)
  allowedPayment: AllowedPayment;
  occurrence: number;             // 0..quantity-1 (display/debug)
  status: 'open' | 'closed' | 'cancelled';
  persisted: boolean;
};
export type VirtualSlot = {
  dateISO: string;
  startAt: Date;
  endAt: Date;
  windowId: string | null;        // null when surfaced from a since-deleted window
  persisted: boolean;
  sessions: VirtualSession[];
};
export type CalendarDay = {
  dateISO: string;
  weekday: number;
  closed: boolean;
  closedReason: 'holiday' | 'override' | null;
  slots: VirtualSlot[];
};

type WindowBoat = { boatTypeId: string; boatName: string; seats: number; minAttendance: number | null; minSkillRank: number | null; allowedPayment: AllowedPayment; quantity: number };
type GroupedWindow = { windowId: string; weekday: number; startTime: string; endTime: string; minutes: number; boats: WindowBoat[] };

export async function computeCalendar(
  db: DB,
  clubId: string,
  opts: { fromDateISO: string; days: number; now?: Date },
): Promise<CalendarDay[]> {
  const { fromDateISO, days } = opts;
  const endISO = addDaysISO(fromDateISO, days); // exclusive
  const dateList = eachDateISO(fromDateISO, days);

  const [club] = await db.select({ timezone: clubs.timezone, openOnHolidays: clubs.openOnHolidays }).from(clubs).where(eq(clubs.id, clubId));
  if (!club) throw new Error(`club not found: ${clubId}`);

  // Active-boat windows for this club, grouped by window.
  const windowRows = await db
    .select({
      windowId: scheduleWindows.id, weekday: scheduleWindows.weekday, startTime: scheduleWindows.startTime, endTime: scheduleWindows.endTime, minutes: scheduleWindows.defaultSessionMinutes,
      boatTypeId: windowBoats.boatTypeId, quantity: windowBoats.quantity, boatName: boatTypes.name, seats: boatTypes.seats, boatMinAttendance: boatTypes.minAttendance,
      allowedPayment: boatTypes.allowedPayment, minSkillRank: skillLevels.rank,
    })
    .from(scheduleWindows)
    .innerJoin(windowBoats, eq(windowBoats.windowId, scheduleWindows.id))
    .innerJoin(boatTypes, eq(boatTypes.id, windowBoats.boatTypeId))
    .leftJoin(skillLevels, eq(skillLevels.id, boatTypes.minSkillLevelId))
    .where(and(eq(scheduleWindows.clubId, clubId), eq(boatTypes.active, true)));

  const grouped = new Map<string, GroupedWindow>();
  for (const r of windowRows) {
    let g = grouped.get(r.windowId);
    if (!g) {
      g = { windowId: r.windowId, weekday: r.weekday, startTime: r.startTime, endTime: r.endTime, minutes: r.minutes, boats: [] };
      grouped.set(r.windowId, g);
    }
    g.boats.push({ boatTypeId: r.boatTypeId, boatName: r.boatName, seats: r.seats, minAttendance: r.boatMinAttendance, minSkillRank: r.minSkillRank, allowedPayment: r.allowedPayment, quantity: r.quantity });
  }
  const windowsByWeekday = new Map<number, GroupedWindow[]>();
  for (const g of grouped.values()) {
    const list = windowsByWeekday.get(g.weekday) ?? [];
    list.push(g);
    windowsByWeekday.set(g.weekday, list);
  }

  // Approved holidays + overrides in range.
  const holidayRows = await db.select({ date: holidays.date }).from(holidays).where(and(eq(holidays.status, 'approved'), gte(holidays.date, fromDateISO), lt(holidays.date, endISO)));
  const approvedHolidayDates = new Set(holidayRows.map((h) => h.date));
  const overrideRows = await db.select({ date: clubHolidayOverrides.date, isOpen: clubHolidayOverrides.isOpen }).from(clubHolidayOverrides).where(and(eq(clubHolidayOverrides.clubId, clubId), gte(clubHolidayOverrides.date, fromDateISO), lt(clubHolidayOverrides.date, endISO)));
  const overrides = new Map(overrideRows.map((o) => [o.date, o.isOpen]));

  // Persisted slots + sessions in the UTC range covering the local window.
  const startBound = zonedWallClockToUtc(fromDateISO, '00:00', club.timezone);
  const endBound = zonedWallClockToUtc(endISO, '00:00', club.timezone);
  const persistedSlots = await db.select({ id: slots.id, startAt: slots.startAt, endAt: slots.endAt, fromWindowId: slots.fromWindowId }).from(slots).where(and(eq(slots.clubId, clubId), gte(slots.startAt, startBound), lt(slots.startAt, endBound)));
  const persistedSessionRows = persistedSlots.length
    ? await db.select({ id: sessions.id, slotId: sessions.slotId, boatTypeId: sessions.boatTypeId, capacity: sessions.capacity, minAttendance: sessions.minAttendance, status: sessions.status, boatName: boatTypes.name, allowedPayment: boatTypes.allowedPayment, minSkillRank: skillLevels.rank })
        .from(sessions).innerJoin(boatTypes, eq(boatTypes.id, sessions.boatTypeId)).leftJoin(skillLevels, eq(skillLevels.id, boatTypes.minSkillLevelId)).where(inArray(sessions.slotId, persistedSlots.map((s) => s.id)))
    : [];
  const sessionsBySlot = new Map<string, VirtualSession[]>();
  for (const s of persistedSessionRows) {
    const list = sessionsBySlot.get(s.slotId) ?? [];
    list.push({ sessionId: s.id, boatTypeId: s.boatTypeId, boatName: s.boatName, capacity: s.capacity, minAttendance: s.minAttendance, minSkillRank: s.minSkillRank, allowedPayment: s.allowedPayment, occurrence: list.length, status: s.status, persisted: true });
    sessionsBySlot.set(s.slotId, list);
  }
  // Index persisted slots by their UTC start ISO; entries are consumed as matched.
  const persistedByStart = new Map<string, { id: string; startAt: Date; endAt: Date; fromWindowId: string | null }>();
  for (const s of persistedSlots) persistedByStart.set(s.startAt.toISOString(), s);

  const result: CalendarDay[] = [];
  for (const dateISO of dateList) {
    const weekday = weekdayOfDateISO(dateISO);
    const { open, reason } = resolveDateOpen({ dateISO, openOnHolidays: club.openOnHolidays, approvedHolidayDates, overrides });
    if (!open) {
      // Closed: emit no fresh slots, but persisted (booked) slots for this date are
      // surfaced read-only by the orphan sweep below so existing bookings never vanish.
      result.push({ dateISO, weekday, closed: true, closedReason: reason, slots: [] });
      continue;
    }
    const vslots: VirtualSlot[] = [];
    for (const w of windowsByWeekday.get(weekday) ?? []) {
      const startMin = toMinutes(w.startTime);
      const endMin = toMinutes(w.endTime);
      for (let m = startMin; m < endMin; m += w.minutes) {
        const startAt = zonedWallClockToUtc(dateISO, minutesToHHMM(m), club.timezone);
        const endAt = addMinutes(startAt, w.minutes);
        const key = startAt.toISOString();
        const persisted = persistedByStart.get(key);
        if (persisted) {
          persistedByStart.delete(key);
          vslots.push({ dateISO, startAt, endAt: persisted.endAt, windowId: w.windowId, persisted: true, sessions: sessionsBySlot.get(persisted.id) ?? [] });
        } else {
          const vsessions = w.boats.flatMap((b) =>
            Array.from({ length: b.quantity }, (_unused, i): VirtualSession => ({
              sessionId: null, boatTypeId: b.boatTypeId, boatName: b.boatName, capacity: b.seats, minAttendance: b.minAttendance, minSkillRank: b.minSkillRank, allowedPayment: b.allowedPayment, occurrence: i, status: 'open', persisted: false,
            })),
          );
          vslots.push({ dateISO, startAt, endAt, windowId: w.windowId, persisted: false, sessions: vsessions });
        }
      }
    }
    result.push({ dateISO, weekday, closed: false, closedReason: null, slots: vslots });
  }

  // Surface any persisted slots not matched to a current window block — a since-deleted
  // window, OR a slot on a now-closed day — bucketed onto the day that contains them, so
  // existing bookings never disappear.
  for (const [, s] of persistedByStart) {
    const { dateISO } = utcToClubDate(s.startAt, club.timezone);
    const day = result.find((d) => d.dateISO === dateISO);
    if (!day) continue;
    day.slots.push({ dateISO, startAt: s.startAt, endAt: s.endAt, windowId: s.fromWindowId, persisted: true, sessions: sessionsBySlot.get(s.id) ?? [] });
  }

  for (const d of result) d.slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return result;
}
```

- [ ] **Step 4: Run the full calendar suite to verify green (incl. the two new cases)**

Run: `pnpm test:integration src/lib/calendar.integration.test.ts`
Expected: PASS (all prior cases + the two new ones). The prior "closed → no slots" expectation for a day with **no** persisted slots still holds (nothing to surface).

- [ ] **Step 5: Lint & commit**

```bash
pnpm lint
git add src/lib/calendar.ts src/lib/calendar.integration.test.ts
git commit -m "feat(5C): calendar exposes eligibility fields + surfaces bookings on closed days"
```

---

## Task 4: materialize — tx-scoped find-or-create with capacity + empty-boats guard

**Files:**
- Modify: `src/lib/materialize.ts` (full replacement below)
- Test: `src/lib/materialize.integration.test.ts` (add one case)

**Interfaces:**
- Consumes: nothing new.
- Produces: `type MaterializeBoat = { boatTypeId: string; capacity: number; minAttendance: number | null; quantity: number }`; `type FoundSession = { id: string; boatTypeId: string; capacity: number }`; `type FindOrCreateResult = { slotId: string; sessions: FoundSession[]; created: boolean }`; `async function findOrCreateSlotTx(tx: DbTx, input: MaterializeInput): Promise<FindOrCreateResult>` where `DbTx` is the drizzle transaction handle. `materializeSlot(db, input)` keeps its existing signature and `{ slotId, sessions: { id, boatTypeId }[] }` return. Empty `boats` (or all-zero quantity) inserts no sessions rather than throwing on an empty VALUES clause.

- [ ] **Step 1: Add the failing test**

Append inside the existing `describe.skipIf(!url)('materializeSlot', …)` block in `src/lib/materialize.integration.test.ts`:

```ts
  it('creates the slot with no sessions when given no boats (guarded empty insert)', async () => {
    const c = await newClub('mat-empty');
    const w = await newWindow(c.id);
    const startAt = new Date('2026-07-22T05:00:00.000Z');
    const r = await materializeSlot(db, { clubId: c.id, dateISO: '2026-07-22', startAt, endAt: new Date('2026-07-22T06:00:00.000Z'), windowId: w.id, boats: [] });
    expect(r.sessions).toHaveLength(0);
    const [slot] = await db.select().from(schema.slots).where(eq(schema.slots.id, r.slotId));
    expect(slot.clubId).toBe(c.id);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:integration src/lib/materialize.integration.test.ts`
Expected: FAIL — insert with empty VALUES throws (or the case errors).

- [ ] **Step 3: Replace `src/lib/materialize.ts` with this full version**

```ts
import { and, eq, sql } from 'drizzle-orm';

import type { DB } from '@/db';
import { sessions, slots } from '@/db/schema';

export type MaterializeBoat = { boatTypeId: string; capacity: number; minAttendance: number | null; quantity: number };
export type MaterializeInput = {
  clubId: string;
  dateISO: string;
  startAt: Date;
  endAt: Date;
  windowId: string;
  boats: MaterializeBoat[];
};
export type FoundSession = { id: string; boatTypeId: string; capacity: number };
export type FindOrCreateResult = { slotId: string; sessions: FoundSession[]; created: boolean };
export type MaterializedSlot = { slotId: string; sessions: { id: string; boatTypeId: string }[] };

/** The drizzle transaction handle type (first arg to `db.transaction(async (tx) => …)`). */
export type DbTx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Find-or-create the slot for one concrete block plus its full session set, INSIDE a caller's
 * transaction. Acquires a tx-scoped advisory lock keyed on (clubId, startAt) first, then inserts
 * the slot with ON CONFLICT DO NOTHING against slots_club_start_uq. The winner inserts the session
 * set (expanding quantity); a concurrent loser re-reads. Idempotent. This is the seam bookSeat
 * runs under so lock → materialize → seat all share one transaction.
 */
export async function findOrCreateSlotTx(tx: DbTx, input: MaterializeInput): Promise<FindOrCreateResult> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${input.clubId}), hashtext(${input.startAt.toISOString()}))`,
  );

  const inserted = await tx
    .insert(slots)
    .values({ clubId: input.clubId, date: input.dateISO, startAt: input.startAt, endAt: input.endAt, fromWindowId: input.windowId })
    .onConflictDoNothing({ target: [slots.clubId, slots.startAt] })
    .returning({ id: slots.id });

  if (inserted.length > 0) {
    const slotId = inserted[0].id;
    const rows = input.boats.flatMap((b) =>
      Array.from({ length: b.quantity }, () => ({
        slotId, clubId: input.clubId, boatTypeId: b.boatTypeId, capacity: b.capacity, minAttendance: b.minAttendance,
      })),
    );
    // Guard: an empty VALUES clause throws on some drizzle versions. A boatless slot is valid
    // (just not bookable) — create it with no sessions.
    if (rows.length === 0) return { slotId, sessions: [], created: true };
    const created = await tx.insert(sessions).values(rows).returning({ id: sessions.id, boatTypeId: sessions.boatTypeId, capacity: sessions.capacity });
    return { slotId, sessions: created, created: true };
  }

  // Slot already existed (a concurrent caller won, or a prior materialization) — read it.
  const [existing] = await tx
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.clubId, input.clubId), eq(slots.startAt, input.startAt)));
  const existingSessions = await tx
    .select({ id: sessions.id, boatTypeId: sessions.boatTypeId, capacity: sessions.capacity })
    .from(sessions)
    .where(eq(sessions.slotId, existing.id));
  return { slotId: existing.id, sessions: existingSessions, created: false };
}

/**
 * Standalone find-or-create in its own transaction. Preserved for callers that only need to
 * materialize (e.g. an owner date-override in 5B). Booking uses findOrCreateSlotTx directly.
 */
export async function materializeSlot(db: DB, input: MaterializeInput): Promise<MaterializedSlot> {
  return db.transaction(async (tx) => {
    const r = await findOrCreateSlotTx(tx, input);
    return { slotId: r.slotId, sessions: r.sessions.map((s) => ({ id: s.id, boatTypeId: s.boatTypeId })) };
  });
}
```

- [ ] **Step 4: Run the full materialize suite to verify green**

Run: `pnpm test:integration src/lib/materialize.integration.test.ts`
Expected: PASS (all prior cases — same behavior — plus the empty-boats case).

- [ ] **Step 5: Lint & commit**

```bash
pnpm lint
git add src/lib/materialize.ts src/lib/materialize.integration.test.ts
git commit -m "feat(5C): tx-scoped findOrCreateSlotTx with capacity + empty-boats guard"
```

---

## Task 5: Booking engine — bookSeat + cancelBooking (transactional)

**Files:**
- Create: `src/lib/booking.ts`
- Test: `src/lib/booking.integration.test.ts`

**Interfaces:**
- Consumes: `checkEligibility` + `EligibilityReason` (Task 1); `computeSeating` (Task 2); `findOrCreateSlotTx` + `MaterializeBoat` (Task 4); `zonedWallClockToUtc`, `utcToClubDate`, `toMinutes`, `minutesToHHMM` (`date-tz`).
- Produces:
  - `type BookInput = { clubId: string; userId: string; windowId: string; boatTypeId: string; startAt: Date; paymentType: 'regular'|'multisport'; idempotencyKey: string; now?: Date }`
  - `type BookResult = { ok: true; bookingId: string; outcome: 'seated'|'waitlisted'; queuePosition: number | null } | { ok: false; error: 'ineligible'; reason: EligibilityReason } | { ok: false; error: 'already_booked_this_slot' } | { ok: false; error: 'no_session' }`
  - `type CancelInput = { clubId: string; userId: string; bookingId: string; now?: Date }`
  - `type CancelResult = { ok: true } | { ok: false; error: 'not_found' | 'not_active' | 'cancel_disabled' | 'cutoff_passed' }`
  - `async function bookSeat(db: DB, input: BookInput): Promise<BookResult>`
  - `async function cancelBooking(db: DB, input: CancelInput): Promise<CancelResult>`

**Design notes (for the implementer):**
- `bookSeat` is one transaction. It (1) loads the club + the window scoped to `clubId`; (2) builds the authoritative `boats` spec from `window_boats`⋈`boat_types(active)` and locates the chosen boat (else `no_session`); (3) validates `startAt` is a real block start of that window on its club-local date (recompute blocks with the same `zonedWallClockToUtc`; reject otherwise) and derives `endAt` from the window — never trusting a client `endAt`; (4) `findOrCreateSlotTx` (acquires the per-slot advisory lock + materializes); (5) idempotency short-circuit on `(userId, idempotencyKey)`; (6) eligibility; (7) one-booking-per-slot rule; (8) picks the target session of the chosen boat (first with a free seat by session id, else fewest active by session id — packs a boat before spilling to its sibling); (9) inserts the booking (`effectiveAt = now`, `source = 'member'`), recomputes seating for that session, persists every active booking's status/position, returns the caller's outcome.
- `cancelBooking` loads the booking (⋈ session ⋈ slot ⋈ club), verifies ownership + active status + `selfCancelEnabled` + cutoff, then acquires the per-slot advisory lock, cancels, and recomputes seating (auto-promotion).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/booking.integration.test.ts
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { bookSeat, cancelBooking } from './booking';
import { zonedWallClockToUtc } from './date-tz';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
// 2026-07-20 is a Monday; window is Monday 08:00–09:00 local ⇒ block start 05:00Z.
const MON = '2026-07-20';
const START = zonedWallClockToUtc(MON, '08:00', TZ);

describe.skipIf(!url)('bookSeat / cancelBooking', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  async function scenario(opts: { seats: number; quantity?: number; mode?: 'equal' | 'priority'; allowedPayment?: 'regular_only' | 'multisport_only' | 'both'; minSkillRank?: number; selfCancel?: boolean; cutoffHours?: number | null }) {
    const tag = `bk-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ, multisportMode: opts.mode ?? 'equal', selfCancelEnabled: opts.selfCancel ?? true, cancelCutoffHours: opts.cutoffHours ?? null }).returning();
    let lvl: typeof schema.skillLevels.$inferSelect | undefined;
    if (opts.minSkillRank != null) [lvl] = await db.insert(schema.skillLevels).values({ clubId: club.id, name: `L${opts.minSkillRank}`, rank: opts.minSkillRank }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: opts.seats, allowedPayment: opts.allowedPayment ?? 'both', minSkillLevelId: lvl?.id ?? null }).returning();
    const [w] = await db.insert(schema.scheduleWindows).values({ clubId: club.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60 }).returning();
    await db.insert(schema.windowBoats).values({ windowId: w.id, boatTypeId: boat.id, quantity: opts.quantity ?? 1 });
    return { club, boat, w, lvl };
  }
  async function newMember(clubId: string, tag: string, skillLevelId?: string | null, status: 'approved' | 'pending' | 'banned' = 'approved', bannedUntil: Date | null = null) {
    const uid = `${tag}-${Date.now()}-${seq++}`;
    await db.insert(schema.user).values({ id: uid, name: tag, email: `${uid}@t.co` });
    await db.insert(schema.memberships).values({ userId: uid, clubId, role: 'member', status, skillLevelId: skillLevelId ?? null, bannedUntil });
    return uid;
  }
  const key = () => `idem-${Date.now()}-${seq++}`;

  it('seats up to capacity and waitlists the rest; materializes the slot once', async () => {
    const s = await scenario({ seats: 2 });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    const u3 = await newMember(s.club.id, 'u3');
    const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular' as const };
    const r1 = await bookSeat(db, { ...common, userId: u1, idempotencyKey: key() });
    const r2 = await bookSeat(db, { ...common, userId: u2, idempotencyKey: key() });
    const r3 = await bookSeat(db, { ...common, userId: u3, idempotencyKey: key() });
    expect(r1).toMatchObject({ ok: true, outcome: 'seated' });
    expect(r2).toMatchObject({ ok: true, outcome: 'seated' });
    expect(r3).toMatchObject({ ok: true, outcome: 'waitlisted', queuePosition: 1 });
    const slotsForClub = await db.select().from(schema.slots).where(eq(schema.slots.clubId, s.club.id));
    expect(slotsForClub).toHaveLength(1);
  });

  it('is idempotent under a repeated idempotency key', async () => {
    const s = await scenario({ seats: 2 });
    const u = await newMember(s.club.id, 'u');
    const k = key();
    const first = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: k });
    const again = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: k });
    expect(first.ok && again.ok && first.bookingId === again.bookingId).toBe(true);
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u));
    expect(rows).toHaveLength(1);
  });

  it('guarantees exactly capacity under a concurrent rush', async () => {
    const s = await scenario({ seats: 3 });
    const uids = await Promise.all(Array.from({ length: 12 }, (_v, i) => newMember(s.club.id, `rush${i}`)));
    const results = await Promise.all(uids.map((uid) => bookSeat(db, { clubId: s.club.id, userId: uid, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() })));
    expect(results.every((r) => r.ok)).toBe(true);
    const sessionRows = await db.select().from(schema.sessions).where(eq(schema.sessions.clubId, s.club.id));
    const seated = await db.select().from(schema.bookings).where(and(inArray(schema.bookings.sessionId, sessionRows.map((x) => x.id)), eq(schema.bookings.status, 'booked')));
    expect(seated).toHaveLength(3);
  });

  it('rejects an ineligible member (skill too low) with no booking written', async () => {
    const s = await scenario({ seats: 2, minSkillRank: 5 });
    const u = await newMember(s.club.id, 'low', null);
    const r = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    expect(r).toEqual({ ok: false, error: 'ineligible', reason: 'skill_too_low' });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u));
    expect(rows).toHaveLength(0);
  });

  it('rejects a second boat in the same slot', async () => {
    const s = await scenario({ seats: 2, quantity: 2 });
    const u = await newMember(s.club.id, 'dbl');
    const first = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    const second = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: 'already_booked_this_slot' });
  });

  it('priority mode: a later regular displaces an earlier multisport to the waitlist', async () => {
    const s = await scenario({ seats: 1, mode: 'priority' });
    const um = await newMember(s.club.id, 'ms');
    const ur = await newMember(s.club.id, 'reg');
    const rm = await bookSeat(db, { clubId: s.club.id, userId: um, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'multisport', idempotencyKey: key() });
    const rr = await bookSeat(db, { clubId: s.club.id, userId: ur, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    expect(rm).toMatchObject({ ok: true, outcome: 'seated' });
    expect(rr).toMatchObject({ ok: true, outcome: 'seated' });
    const msBooking = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, um));
    expect(msBooking[0].status).toBe('waitlisted');
  });

  it('cancellation auto-promotes the head of the waitlist', async () => {
    const s = await scenario({ seats: 1 });
    const u1 = await newMember(s.club.id, 'c1');
    const u2 = await newMember(s.club.id, 'c2');
    const r1 = await bookSeat(db, { clubId: s.club.id, userId: u1, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    await bookSeat(db, { clubId: s.club.id, userId: u2, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    expect(r1.ok).toBe(true);
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u1, bookingId: (r1 as { bookingId: string }).bookingId, now: new Date('2026-07-01T00:00:00Z') });
    expect(cancel).toEqual({ ok: true });
    const promoted = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, u2));
    expect(promoted[0].status).toBe('booked');
  });

  it('blocks self-cancel after the cutoff', async () => {
    const s = await scenario({ seats: 2, cutoffHours: 8 });
    const u = await newMember(s.club.id, 'cut');
    const r = await bookSeat(db, { clubId: s.club.id, userId: u, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: key() });
    // now = 2h before start (< 8h cutoff)
    const late = new Date(START.getTime() - 2 * 60 * 60 * 1000);
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u, bookingId: (r as { bookingId: string }).bookingId, now: late });
    expect(cancel).toEqual({ ok: false, error: 'cutoff_passed' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:integration src/lib/booking.integration.test.ts`
Expected: FAIL — cannot find module `./booking`.

- [ ] **Step 3: Write `src/lib/booking.ts`**

```ts
import { addMinutes } from 'date-fns';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, bookings, clubs, memberships, scheduleWindows, sessions, skillLevels, slots, windowBoats } from '@/db/schema';

import { toMinutes, utcToClubDate, zonedWallClockToUtc } from './date-tz';
import { checkEligibility, type EligibilityReason } from './eligibility';
import { findOrCreateSlotTx, type MaterializeBoat } from './materialize';
import { computeSeating } from './seating';

const HOUR_MS = 60 * 60 * 1000;
const ACTIVE = ['booked', 'waitlisted'] as const;

export type BookInput = {
  clubId: string;
  userId: string;
  windowId: string;
  boatTypeId: string;
  startAt: Date;
  paymentType: 'regular' | 'multisport';
  idempotencyKey: string;
  now?: Date;
};
export type BookResult =
  | { ok: true; bookingId: string; outcome: 'seated' | 'waitlisted'; queuePosition: number | null }
  | { ok: false; error: 'ineligible'; reason: EligibilityReason }
  | { ok: false; error: 'already_booked_this_slot' }
  | { ok: false; error: 'no_session' };

export type CancelInput = { clubId: string; userId: string; bookingId: string; now?: Date };
export type CancelResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'not_active' | 'cancel_disabled' | 'cutoff_passed' };

/** Book (or waitlist) a seat for one member in one boat at one time block. */
export async function bookSeat(db: DB, input: BookInput): Promise<BookResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // 1. Club + window, scoped to clubId.
    const [club] = await tx.select({ timezone: clubs.timezone, multisportMode: clubs.multisportMode }).from(clubs).where(eq(clubs.id, input.clubId));
    if (!club) return { ok: false, error: 'no_session' };
    const [win] = await tx.select().from(scheduleWindows).where(and(eq(scheduleWindows.id, input.windowId), eq(scheduleWindows.clubId, input.clubId)));
    if (!win) return { ok: false, error: 'no_session' };

    // 2. Authoritative boats spec + the chosen boat.
    const wbRows = await tx
      .select({ boatTypeId: windowBoats.boatTypeId, quantity: windowBoats.quantity, capacity: boatTypes.seats, minAttendance: boatTypes.minAttendance, allowedPayment: boatTypes.allowedPayment, minSkillRank: skillLevels.rank })
      .from(windowBoats)
      .innerJoin(boatTypes, eq(boatTypes.id, windowBoats.boatTypeId))
      .leftJoin(skillLevels, eq(skillLevels.id, boatTypes.minSkillLevelId))
      .where(and(eq(windowBoats.windowId, input.windowId), eq(boatTypes.active, true)));
    const chosen = wbRows.find((b) => b.boatTypeId === input.boatTypeId);
    if (!chosen) return { ok: false, error: 'no_session' };
    const boatsSpec: MaterializeBoat[] = wbRows.map((b) => ({ boatTypeId: b.boatTypeId, capacity: b.capacity, minAttendance: b.minAttendance, quantity: b.quantity }));

    // 3. Validate startAt is a real block of this window on its club-local date.
    const { dateISO, weekday } = utcToClubDate(input.startAt, club.timezone);
    if (weekday !== win.weekday) return { ok: false, error: 'no_session' };
    const startMin = toMinutes(win.startTime);
    const endMin = toMinutes(win.endTime);
    let matched = false;
    for (let m = startMin; m < endMin; m += win.defaultSessionMinutes) {
      const blockStart = zonedWallClockToUtc(dateISO, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, club.timezone);
      if (blockStart.getTime() === input.startAt.getTime()) { matched = true; break; }
    }
    if (!matched) return { ok: false, error: 'no_session' };
    const endAt = addMinutes(input.startAt, win.defaultSessionMinutes);

    // 4. Find-or-create the slot + sessions under the per-slot advisory lock.
    const foc = await findOrCreateSlotTx(tx, { clubId: input.clubId, dateISO, startAt: input.startAt, endAt, windowId: input.windowId, boats: boatsSpec });

    // 5. Idempotency short-circuit.
    const [dup] = await tx.select({ id: bookings.id, status: bookings.status, queuePosition: bookings.queuePosition }).from(bookings).where(and(eq(bookings.userId, input.userId), eq(bookings.idempotencyKey, input.idempotencyKey)));
    if (dup) return { ok: true, bookingId: dup.id, outcome: dup.status === 'booked' ? 'seated' : 'waitlisted', queuePosition: dup.queuePosition };

    // 6. Eligibility.
    const [member] = await tx
      .select({ status: memberships.status, bannedUntil: memberships.bannedUntil, skillRank: skillLevels.rank })
      .from(memberships)
      .leftJoin(skillLevels, eq(skillLevels.id, memberships.skillLevelId))
      .where(and(eq(memberships.userId, input.userId), eq(memberships.clubId, input.clubId)));
    const elig = checkEligibility({
      membershipStatus: member?.status ?? null,
      bannedUntil: member?.bannedUntil ?? null,
      memberSkillRank: member?.skillRank ?? null,
      boatMinSkillRank: chosen.minSkillRank,
      boatAllowedPayment: chosen.allowedPayment,
      paymentType: input.paymentType,
      now,
    });
    if (!elig.ok) return { ok: false, error: 'ineligible', reason: elig.reason };

    // 7. One booking per slot: reject if the member is already active in any session of this slot.
    const slotSessionIds = foc.sessions.map((s) => s.id);
    if (slotSessionIds.length) {
      const [existingActive] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.userId, input.userId), inArray(bookings.sessionId, slotSessionIds), inArray(bookings.status, [...ACTIVE])));
      if (existingActive) return { ok: false, error: 'already_booked_this_slot' };
    }

    // 8. Choose the target session of the chosen boat: pack a boat (first free seat by id),
    //    else the one with the fewest active bookings (shortest waitlist), tie-break by id.
    const boatSessions = foc.sessions.filter((s) => s.boatTypeId === input.boatTypeId).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (boatSessions.length === 0) return { ok: false, error: 'no_session' };
    const activeRows = await tx.select({ sessionId: bookings.sessionId }).from(bookings).where(and(inArray(bookings.sessionId, boatSessions.map((s) => s.id)), inArray(bookings.status, [...ACTIVE])));
    const activeCount = new Map<string, number>();
    for (const r of activeRows) activeCount.set(r.sessionId, (activeCount.get(r.sessionId) ?? 0) + 1);
    const withFree = boatSessions.filter((s) => (activeCount.get(s.id) ?? 0) < s.capacity);
    const target = withFree.length > 0
      ? withFree[0]
      : [...boatSessions].sort((a, b) => (activeCount.get(a.id) ?? 0) - (activeCount.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1))[0];

    // 9. Insert the booking, then recompute seating for the target session.
    const [inserted] = await tx.insert(bookings).values({ sessionId: target.id, clubId: input.clubId, userId: input.userId, paymentType: input.paymentType, status: 'booked', effectiveAt: now, source: 'member', idempotencyKey: input.idempotencyKey }).returning({ id: bookings.id });
    const active = await tx.select({ id: bookings.id, paymentType: bookings.paymentType, effectiveAt: bookings.effectiveAt }).from(bookings).where(and(eq(bookings.sessionId, target.id), inArray(bookings.status, [...ACTIVE])));
    const assignments = computeSeating(active.map((a) => ({ id: a.id, paymentType: a.paymentType, effectiveAt: a.effectiveAt })), target.capacity, club.multisportMode);
    for (const a of assignments) await tx.update(bookings).set({ status: a.status, queuePosition: a.queuePosition }).where(eq(bookings.id, a.id));
    const mine = assignments.find((a) => a.id === inserted.id)!;
    return { ok: true, bookingId: inserted.id, outcome: mine.status === 'booked' ? 'seated' : 'waitlisted', queuePosition: mine.queuePosition };
  });
}

/** Cancel a member's own booking and auto-promote the waitlist for that session. */
export async function cancelBooking(db: DB, input: CancelInput): Promise<CancelResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: bookings.id, userId: bookings.userId, clubId: bookings.clubId, status: bookings.status, sessionId: bookings.sessionId,
        capacity: sessions.capacity, slotStartAt: slots.startAt,
        multisportMode: clubs.multisportMode, selfCancelEnabled: clubs.selfCancelEnabled, cancelCutoffHours: clubs.cancelCutoffHours,
      })
      .from(bookings)
      .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
      .innerJoin(slots, eq(slots.id, sessions.slotId))
      .innerJoin(clubs, eq(clubs.id, bookings.clubId))
      .where(eq(bookings.id, input.bookingId));

    if (!row || row.clubId !== input.clubId || row.userId !== input.userId) return { ok: false, error: 'not_found' };
    if (!(ACTIVE as readonly string[]).includes(row.status)) return { ok: false, error: 'not_active' };
    if (!row.selfCancelEnabled) return { ok: false, error: 'cancel_disabled' };
    if (row.cancelCutoffHours != null && now.getTime() >= row.slotStartAt.getTime() - row.cancelCutoffHours * HOUR_MS) {
      return { ok: false, error: 'cutoff_passed' };
    }

    // Serialize with the session's bookings under the same per-slot lock bookSeat uses.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.clubId}), hashtext(${row.slotStartAt.toISOString()}))`);

    await tx.update(bookings).set({ status: 'cancelled', queuePosition: null }).where(eq(bookings.id, input.bookingId));

    // Recompute seating for the session — waitlist auto-promotion falls out of this.
    const active = await tx.select({ id: bookings.id, paymentType: bookings.paymentType, effectiveAt: bookings.effectiveAt }).from(bookings).where(and(eq(bookings.sessionId, row.sessionId), inArray(bookings.status, [...ACTIVE])));
    const assignments = computeSeating(active.map((a) => ({ id: a.id, paymentType: a.paymentType, effectiveAt: a.effectiveAt })), row.capacity, row.multisportMode);
    for (const a of assignments) await tx.update(bookings).set({ status: a.status, queuePosition: a.queuePosition }).where(eq(bookings.id, a.id));

    return { ok: true };
  });
}
```

- [ ] **Step 4: Run the suite**

Run: `pnpm test:integration src/lib/booking.integration.test.ts`
Expected: PASS (all cases: capacity/waitlist, idempotency, rush=exactly 3 seated, ineligible, one-per-slot, priority displacement, auto-promotion, cutoff).

- [ ] **Step 5: Lint & commit**

```bash
pnpm lint
git add src/lib/booking.ts src/lib/booking.integration.test.ts
git commit -m "feat(5C): transactional bookSeat + cancelBooking with per-slot lock"
```

---

## Task 6: Member calendar wrapper + requireMember guard

**Files:**
- Create: `src/lib/member-calendar.ts`
- Modify: `src/lib/membership.ts` (add `requireMember`)
- Test: `src/lib/member-calendar.integration.test.ts`

**Interfaces:**
- Consumes: `computeCalendar` + `VirtualSession`/`CalendarDay`/`AllowedPayment` (Task 3); `isBookingOpen` (`calendar-rules`); `checkEligibility` + `EligibilityResult` (Task 1).
- Produces:
  - `type MemberContext = { userId: string; membershipStatus: 'pending'|'approved'|'rejected'|'banned'|null; bannedUntil: Date | null; skillRank: number | null; paymentType: 'regular'|'multisport' }`
  - `type MemberVirtualSession = VirtualSession & { seatsLeft: number; bookingOpen: boolean; eligibility: EligibilityResult; defaultPayment: 'regular'|'multisport'; paymentChoices: ('regular'|'multisport')[]; myStatus: 'none'|'booked'|'waitlisted'; myQueuePosition: number | null }`
  - `type MemberVirtualSlot = Omit<VirtualSlot,'sessions'> & { sessions: MemberVirtualSession[] }`
  - `type MemberCalendarDay = Omit<CalendarDay,'slots'> & { slots: MemberVirtualSlot[] }`
  - `async function computeMemberCalendar(db: DB, clubId: string, member: MemberContext, opts: { fromDateISO: string; days: number; now?: Date }): Promise<MemberCalendarDay[]>`
  - In `membership.ts`: `async function requireMember(slug: string, returnPath?: string): Promise<{ club: Club; user: CurrentUser; membership: Membership }>` — approved, non-banned membership (any role; an owner is also a member).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/member-calendar.integration.test.ts
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { bookSeat } from './booking';
import { zonedWallClockToUtc } from './date-tz';
import { computeMemberCalendar, type MemberContext } from './member-calendar';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
const MON = '2026-07-20';
const START = zonedWallClockToUtc(MON, '08:00', TZ);

describe.skipIf(!url)('computeMemberCalendar', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  async function setup(allowedPayment: 'regular_only' | 'multisport_only' | 'both' = 'both', minSkillRank?: number) {
    const tag = `mc-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ, bookingOpenMode: 'always' }).returning();
    let lvl; if (minSkillRank != null) [lvl] = await db.insert(schema.skillLevels).values({ clubId: club.id, name: 'L', rank: minSkillRank }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 2, allowedPayment, minSkillLevelId: lvl?.id ?? null }).returning();
    const [w] = await db.insert(schema.scheduleWindows).values({ clubId: club.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60 }).returning();
    await db.insert(schema.windowBoats).values({ windowId: w.id, boatTypeId: boat.id, quantity: 1 });
    return { club, boat, w };
  }
  const ctx = (userId: string, over: Partial<MemberContext> = {}): MemberContext => ({ userId, membershipStatus: 'approved', bannedUntil: null, skillRank: null, paymentType: 'regular', ...over });
  const opts = { fromDateISO: MON, days: 1, now: new Date('2026-07-01T00:00:00Z') };

  it('reports full seatsLeft and none myStatus for a virtual (unbooked) session', async () => {
    const s = await setup();
    const days = await computeMemberCalendar(db, s.club.id, ctx('nobody'), opts);
    const session = days[0].slots[0].sessions[0];
    expect(session.seatsLeft).toBe(2);
    expect(session.myStatus).toBe('none');
    expect(session.bookingOpen).toBe(true);
    expect(session.eligibility).toEqual({ ok: true });
    expect(session.paymentChoices).toEqual(['regular', 'multisport']);
    expect(session.defaultPayment).toBe('regular');
  });

  it('reflects a booking: seatsLeft drops and myStatus shows booked for the booker', async () => {
    const s = await setup();
    const uid = `mem-${Date.now()}-${seq++}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    await db.insert(schema.memberships).values({ userId: uid, clubId: s.club.id, role: 'member', status: 'approved' });
    await bookSeat(db, { clubId: s.club.id, userId: uid, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: `k-${seq++}`, now: opts.now });
    const mine = await computeMemberCalendar(db, s.club.id, ctx(uid), opts);
    const other = await computeMemberCalendar(db, s.club.id, ctx('someone-else'), opts);
    expect(mine[0].slots[0].sessions[0].myStatus).toBe('booked');
    expect(mine[0].slots[0].sessions[0].seatsLeft).toBe(1);
    expect(other[0].slots[0].sessions[0].myStatus).toBe('none');
    expect(other[0].slots[0].sessions[0].seatsLeft).toBe(1);
  });

  it('marks skill-gated sessions ineligible and locks payment choices for single-type boats', async () => {
    const s = await setup('multisport_only', 5);
    const days = await computeMemberCalendar(db, s.club.id, ctx('n', { skillRank: 1 }), opts);
    const session = days[0].slots[0].sessions[0];
    expect(session.eligibility).toEqual({ ok: false, reason: 'skill_too_low' });
    expect(session.paymentChoices).toEqual(['multisport']);
    expect(session.defaultPayment).toBe('multisport');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:integration src/lib/member-calendar.integration.test.ts`
Expected: FAIL — cannot find module `./member-calendar`.

- [ ] **Step 3: Write `src/lib/member-calendar.ts`**

```ts
import { and, eq, inArray } from 'drizzle-orm';

import type { DB } from '@/db';
import { bookings, clubs } from '@/db/schema';

import { type AllowedPayment, type CalendarDay, computeCalendar, type VirtualSession, type VirtualSlot } from './calendar';
import { isBookingOpen } from './calendar-rules';
import { checkEligibility, type EligibilityResult } from './eligibility';

export type PaymentType = 'regular' | 'multisport';
export type MemberContext = {
  userId: string;
  membershipStatus: 'pending' | 'approved' | 'rejected' | 'banned' | null;
  bannedUntil: Date | null;
  skillRank: number | null;
  paymentType: PaymentType;
};
export type MemberVirtualSession = VirtualSession & {
  seatsLeft: number;
  bookingOpen: boolean;
  eligibility: EligibilityResult;
  defaultPayment: PaymentType;
  paymentChoices: PaymentType[];
  myStatus: 'none' | 'booked' | 'waitlisted';
  myQueuePosition: number | null;
};
export type MemberVirtualSlot = Omit<VirtualSlot, 'sessions'> & { sessions: MemberVirtualSession[] };
export type MemberCalendarDay = Omit<CalendarDay, 'slots'> & { slots: MemberVirtualSlot[] };

function paymentChoicesFor(allowed: AllowedPayment): PaymentType[] {
  if (allowed === 'regular_only') return ['regular'];
  if (allowed === 'multisport_only') return ['multisport'];
  return ['regular', 'multisport'];
}
function defaultPaymentFor(allowed: AllowedPayment, pref: PaymentType): PaymentType {
  if (allowed === 'regular_only') return 'regular';
  if (allowed === 'multisport_only') return 'multisport';
  return pref;
}

/**
 * The 5B calendar enriched for one member: per session it adds seatsLeft (capacity − seated),
 * bookingOpen (club policy), eligibility (skill + membership; payment is a choice, so the check
 * uses the payment the form will default to and never blocks on payment), the payment picker
 * options, and the member's own status. Booking-agnostic computeCalendar stays untouched.
 */
export async function computeMemberCalendar(
  db: DB,
  clubId: string,
  member: MemberContext,
  opts: { fromDateISO: string; days: number; now?: Date },
): Promise<MemberCalendarDay[]> {
  const now = opts.now ?? new Date();
  const days = await computeCalendar(db, clubId, opts);

  const [club] = await db.select({ bookingOpenMode: clubs.bookingOpenMode, bookingOpenLeadDays: clubs.bookingOpenLeadDays }).from(clubs).where(eq(clubs.id, clubId));
  if (!club) throw new Error(`club not found: ${clubId}`);

  const persistedIds = days.flatMap((d) => d.slots).flatMap((s) => s.sessions).filter((x) => x.persisted && x.sessionId).map((x) => x.sessionId!) as string[];

  // Seated counts per persisted session + this member's own active bookings.
  const seated = new Map<string, number>();
  const mine = new Map<string, { status: 'booked' | 'waitlisted'; queuePosition: number | null }>();
  if (persistedIds.length) {
    const seatedRows = await db.select({ sessionId: bookings.sessionId }).from(bookings).where(and(inArray(bookings.sessionId, persistedIds), eq(bookings.status, 'booked')));
    for (const r of seatedRows) seated.set(r.sessionId, (seated.get(r.sessionId) ?? 0) + 1);
    const myRows = await db.select({ sessionId: bookings.sessionId, status: bookings.status, queuePosition: bookings.queuePosition }).from(bookings).where(and(eq(bookings.userId, member.userId), inArray(bookings.sessionId, persistedIds), inArray(bookings.status, ['booked', 'waitlisted'])));
    for (const r of myRows) mine.set(r.sessionId, { status: r.status as 'booked' | 'waitlisted', queuePosition: r.queuePosition });
  }

  return days.map((day) => ({
    ...day,
    slots: day.slots.map((slot) => ({
      ...slot,
      sessions: slot.sessions.map((s): MemberVirtualSession => {
        const seatedCount = s.sessionId ? (seated.get(s.sessionId) ?? 0) : 0;
        const my = s.sessionId ? mine.get(s.sessionId) : undefined;
        const defaultPayment = defaultPaymentFor(s.allowedPayment, member.paymentType);
        return {
          ...s,
          seatsLeft: Math.max(0, s.capacity - seatedCount),
          bookingOpen: isBookingOpen({ now, startAt: slot.startAt, bookingOpenMode: club.bookingOpenMode, bookingOpenLeadDays: club.bookingOpenLeadDays }),
          eligibility: checkEligibility({ membershipStatus: member.membershipStatus, bannedUntil: member.bannedUntil, memberSkillRank: member.skillRank, boatMinSkillRank: s.minSkillRank, boatAllowedPayment: s.allowedPayment, paymentType: defaultPayment, now }),
          defaultPayment,
          paymentChoices: paymentChoicesFor(s.allowedPayment),
          myStatus: my?.status ?? 'none',
          myQueuePosition: my?.queuePosition ?? null,
        };
      }),
    })),
  }));
}
```

- [ ] **Step 4: Add `requireMember` to `src/lib/membership.ts`**

Append this export (it reuses the same imports `requireOwner` already uses — `parseAppOrigin`, `getClubBySlug`, `getCurrentUser`, `apexUrl`, `clubUrl`, `self.getMembership`, `notFound`, `redirect`, `env`, `appDb`):

```ts
/** Require the signed-in user to be an approved, non-banned member of `slug` (any role). */
export async function requireMember(
  slug: string,
  returnPath = '/book',
): Promise<{ club: Club; user: CurrentUser; membership: Membership }> {
  const origin = parseAppOrigin(env.APP_URL);
  const club = await getClubBySlug(slug);
  if (!club) notFound();
  const user = await getCurrentUser();
  if (!user) {
    const back = `${clubUrl(slug, origin)}${returnPath}`;
    redirect(`${apexUrl('/sign-in', origin)}?redirect=${encodeURIComponent(back)}`);
  }
  const membership = await self.getMembership(appDb, user.id, club.id);
  const bannedActive = membership?.bannedUntil != null && membership.bannedUntil.getTime() > Date.now();
  if (!membership || membership.status !== 'approved' || bannedActive) notFound();
  return { club, user, membership };
}
```

- [ ] **Step 5: Run the member-calendar suite + membership unit tests**

Run: `pnpm test:integration src/lib/member-calendar.integration.test.ts && pnpm test src/lib/membership.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint & commit**

```bash
pnpm lint
git add src/lib/member-calendar.ts src/lib/membership.ts src/lib/member-calendar.integration.test.ts
git commit -m "feat(5C): computeMemberCalendar wrapper + requireMember guard"
```

---

## Task 7: Member booking page (`/book`)

**Files:**
- Create: `app/s/[slug]/book/page.tsx`, `app/s/[slug]/book/actions.ts`, `app/s/[slug]/book/book-calendar.tsx`
- Modify: `messages/en.json`, `messages/tr.json` (add `booking` namespace)

**Interfaces:**
- Consumes: `requireMember` (Task 6); `computeMemberCalendar` + `MemberCalendarDay` (Task 6); `bookSeat` + `BookResult` (Task 5); `todayInClub` (`date-tz`).
- Produces: `type BookFormState = { status: 'idle' | 'ok' | 'error'; error: string | null }`; server action `bookSeatAction(slug, prev, formData)`.

**Verification convention (matches 5A/5B UI tasks):** UI pages are verified by `pnpm lint`, `pnpm build`, and route presence — not jsdom component tests. The engine is covered by Tasks 1–6.

- [ ] **Step 1: Add the `booking` i18n namespace**

Add a top-level `"booking"` key to `messages/en.json`:

```json
  "booking": {
    "title": "Book a session",
    "description": "Reserve a seat for the next {days} days.",
    "closedHoliday": "Closed — public holiday",
    "closedByClub": "Closed",
    "noSessions": "No sessions this day",
    "seatsLeft": "{count} of {capacity} seats left",
    "full": "Full",
    "book": "Book",
    "joinWaitlist": "Join waitlist",
    "booked": "You're booked",
    "waitlisted": "Waitlisted #{position}",
    "opensOn": "Opens {date}",
    "paymentLabel": "Payment",
    "confirm": "Confirm",
    "cancel": "Cancel",
    "myBookings": "My bookings",
    "reasons": {
      "not_approved": "Membership not approved",
      "banned": "Temporarily suspended",
      "skill_too_low": "Requires a higher skill level",
      "payment_not_allowed": "Payment type not allowed on this boat"
    },
    "errors": {
      "ineligible": "You can't book this session.",
      "already_booked_this_slot": "You already have a booking at this time.",
      "no_session": "That session is no longer available.",
      "generic": "Something went wrong. Please try again."
    }
  }
```

Add the Turkish mirror to `messages/tr.json` (same keys, same `{placeholders}`):

```json
  "booking": {
    "title": "Antrenman ayırt",
    "description": "Önümüzdeki {days} gün için yer ayırtın.",
    "closedHoliday": "Kapalı — resmi tatil",
    "closedByClub": "Kapalı",
    "noSessions": "Bu gün seans yok",
    "seatsLeft": "{capacity} koltuktan {count} tanesi boş",
    "full": "Dolu",
    "book": "Ayırt",
    "joinWaitlist": "Bekleme listesine gir",
    "booked": "Yerin ayrıldı",
    "waitlisted": "Bekleme listesi #{position}",
    "opensOn": "Açılış: {date}",
    "paymentLabel": "Ödeme",
    "confirm": "Onayla",
    "cancel": "Vazgeç",
    "myBookings": "Rezervasyonlarım",
    "reasons": {
      "not_approved": "Üyelik onaylanmadı",
      "banned": "Geçici olarak askıya alındı",
      "skill_too_low": "Daha yüksek bir seviye gerekiyor",
      "payment_not_allowed": "Bu teknede bu ödeme türü kullanılamaz"
    },
    "errors": {
      "ineligible": "Bu seansı ayırtamazsınız.",
      "already_booked_this_slot": "Bu saatte zaten bir rezervasyonunuz var.",
      "no_session": "Bu seans artık mevcut değil.",
      "generic": "Bir şeyler ters gitti. Lütfen tekrar deneyin."
    }
  }
```

- [ ] **Step 2: Write the server action `app/s/[slug]/book/actions.ts`**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import * as z from 'zod';

import { db } from '@/db';
import { bookSeat } from '@/lib/booking';
import { requireMember } from '@/lib/membership';

export type BookFormState = { status: 'idle' | 'ok' | 'error'; error: string | null };

const bookInputSchema = z.object({
  windowId: z.uuid(),
  boatTypeId: z.uuid(),
  startAt: z.iso.datetime(),
  paymentType: z.enum(['regular', 'multisport']),
  idempotencyKey: z.string().min(8).max(100),
});

export async function bookSeatAction(slug: string, _prev: BookFormState, formData: FormData): Promise<BookFormState> {
  const { club, user } = await requireMember(slug, '/book');
  const parsed = bookInputSchema.safeParse({
    windowId: formData.get('windowId'),
    boatTypeId: formData.get('boatTypeId'),
    startAt: formData.get('startAt'),
    paymentType: formData.get('paymentType'),
    idempotencyKey: formData.get('idempotencyKey'),
  });
  if (!parsed.success) return { status: 'error', error: 'generic' };

  const result = await bookSeat(db, {
    clubId: club.id,
    userId: user.id,
    windowId: parsed.data.windowId,
    boatTypeId: parsed.data.boatTypeId,
    startAt: new Date(parsed.data.startAt),
    paymentType: parsed.data.paymentType,
    idempotencyKey: parsed.data.idempotencyKey,
  });
  if (!result.ok) return { status: 'error', error: result.error };
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);
  return { status: 'ok', error: null };
}
```

- [ ] **Step 3: Write the client calendar `app/s/[slug]/book/book-calendar.tsx`**

```tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { MemberCalendarDay, MemberVirtualSession } from '@/lib/member-calendar';

import { bookSeatAction, type BookFormState } from './actions';

const initial: BookFormState = { status: 'idle', error: null };
const selectClass = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs';

function BookableSession({ slug, windowId, startAtISO, session }: { slug: string; windowId: string; startAtISO: string; session: MemberVirtualSession }) {
  const t = useTranslations('booking');
  const [state, formAction, pending] = useActionState(bookSeatAction.bind(null, slug), initial);
  const [payment, setPayment] = useState(session.defaultPayment);
  const [idempotencyKey] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`));

  const full = session.seatsLeft <= 0;
  const label = full ? t('joinWaitlist') : t('book');

  if (session.myStatus === 'booked') return <span className="text-sm font-medium text-primary">{t('booked')}</span>;
  if (session.myStatus === 'waitlisted') return <span className="text-sm text-muted-foreground">{t('waitlisted', { position: session.myQueuePosition ?? 0 })}</span>;
  if (!session.eligibility.ok) return <span className="text-sm text-muted-foreground">{t(`reasons.${session.eligibility.reason}`)}</span>;
  if (!session.bookingOpen) return <span className="text-sm text-muted-foreground">—</span>;

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="windowId" value={windowId} />
      <input type="hidden" name="boatTypeId" value={session.boatTypeId} />
      <input type="hidden" name="startAt" value={startAtISO} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {session.paymentChoices.length > 1 ? (
        <select name="paymentType" value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)} className={selectClass} aria-label={t('paymentLabel')}>
          {session.paymentChoices.map((p) => <option key={p} value={p}>{p === 'regular' ? 'Cash' : 'MultiSport'}</option>)}
        </select>
      ) : (
        <input type="hidden" name="paymentType" value={session.paymentChoices[0]} />
      )}
      <Button type="submit" size="xs" variant={full ? 'outline' : 'default'} disabled={pending}>{label}</Button>
      {state.status === 'error' && <span className="text-xs text-destructive">{t(`errors.${state.error ?? 'generic'}`)}</span>}
    </form>
  );
}

export function BookCalendar({ slug, days, timeZone }: { slug: string; days: MemberCalendarDay[]; timeZone: string }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  return (
    <ul className="flex flex-col gap-3">
      {days.map((day) => (
        <li key={day.dateISO} className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{f.dateTime(new Date(`${day.dateISO}T00:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span>
            {day.closed && <span className="text-sm text-muted-foreground">{day.closedReason === 'holiday' ? t('closedHoliday') : t('closedByClub')}</span>}
          </div>
          {day.slots.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {day.slots.map((slot) => (
                <li key={slot.startAt.toISOString()} className="flex flex-col gap-1 border-t pt-2 first:border-t-0 first:pt-0">
                  <span className="text-muted-foreground">
                    {f.dateTime(slot.startAt, { hour: '2-digit', minute: '2-digit', timeZone })} – {f.dateTime(slot.endAt, { hour: '2-digit', minute: '2-digit', timeZone })}
                  </span>
                  <ul className="flex flex-col gap-1">
                    {slot.sessions.map((session, i) => (
                      <li key={`${session.boatTypeId}-${session.sessionId ?? i}`} className="flex items-center justify-between gap-3">
                        <span>
                          {session.boatName}
                          {' · '}
                          {session.seatsLeft > 0 ? t('seatsLeft', { count: session.seatsLeft, capacity: session.capacity }) : t('full')}
                        </span>
                        {day.closed ? null : <BookableSession slug={slug} windowId={slot.windowId ?? ''} startAtISO={slot.startAt.toISOString()} session={session} />}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            !day.closed && <p className="mt-2 text-sm text-muted-foreground">{t('noSessions')}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Write the page `app/s/[slug]/book/page.tsx`**

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { todayInClub } from '@/lib/date-tz';
import { computeMemberCalendar } from '@/lib/member-calendar';
import { requireMember } from '@/lib/membership';

import { BookCalendar } from './book-calendar';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const BOOK_DAYS = 14;

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club, user, membership } = await requireMember(slug, '/book');
  const t = await getTranslations('booking');

  const fromDateISO = todayInClub(new Date(), club.timezone);
  const days = await computeMemberCalendar(db, club.id, {
    userId: user.id,
    membershipStatus: membership.status,
    bannedUntil: membership.bannedUntil,
    skillRank: null,
    paymentType: user.defaultPaymentType,
  }, { fromDateISO, days: BOOK_DAYS });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-lg font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description', { days: BOOK_DAYS })}</p>
        </div>
        <Link href={`/s/${slug}/bookings`} className="text-sm underline">{t('myBookings')}</Link>
      </div>
      <BookCalendar slug={slug} days={days} timeZone={club.timezone} />
    </div>
  );
}
```

**Implementer note:** the member's `skillRank` needs a join `memberships → skill_levels`. `membership` from `requireMember` carries `skillLevelId` but not the rank. Fetch the rank in the page with a small query (`select skill_levels.rank where id = membership.skillLevelId`) and pass it as `skillRank` instead of the `null` placeholder above; if `skillLevelId` is null, pass `null`. `user.defaultPaymentType` is on the session user (`CurrentUser`); confirm the field name via `getCurrentUser`'s return type and adjust if needed.

- [ ] **Step 5: Verify lint, build, and route presence**

Run: `pnpm lint && pnpm build`
Expected: lint 0 warnings; build succeeds; output lists `/s/[slug]/book`.

- [ ] **Step 6: Commit**

```bash
git add app/s/[slug]/book messages/en.json messages/tr.json
git commit -m "feat(5C): member booking calendar page"
```

---

## Task 8: My Bookings page (`/bookings`)

**Files:**
- Create: `app/s/[slug]/bookings/page.tsx`, `app/s/[slug]/bookings/actions.ts`, `app/s/[slug]/bookings/bookings-list.tsx`
- Modify: `messages/en.json`, `messages/tr.json` (extend `booking` namespace)

**Interfaces:**
- Consumes: `requireMember` (Task 6); `cancelBooking` + `CancelResult` (Task 5).
- Produces: `type CancelFormState = { status: 'idle' | 'ok' | 'error'; error: string | null }`; server action `cancelBookingAction(slug, prev, formData)`.

- [ ] **Step 1: Extend the `booking` i18n namespace**

Add these keys inside the existing `booking` object in `messages/en.json`:

```json
    "myTitle": "My bookings",
    "upcoming": "Upcoming",
    "past": "Past",
    "none": "Nothing here yet.",
    "seated": "Booked",
    "back": "Book a session",
    "cancelErrors": {
      "not_found": "Booking not found.",
      "not_active": "This booking is no longer active.",
      "cancel_disabled": "Self-cancellation is turned off for this club.",
      "cutoff_passed": "Too late to cancel this booking.",
      "generic": "Could not cancel. Please try again."
    }
```

And the Turkish mirror inside `booking` in `messages/tr.json`:

```json
    "myTitle": "Rezervasyonlarım",
    "upcoming": "Yaklaşan",
    "past": "Geçmiş",
    "none": "Henüz bir şey yok.",
    "seated": "Ayrıldı",
    "back": "Antrenman ayırt",
    "cancelErrors": {
      "not_found": "Rezervasyon bulunamadı.",
      "not_active": "Bu rezervasyon artık aktif değil.",
      "cancel_disabled": "Bu kulüpte kendi rezervasyonunu iptal kapalı.",
      "cutoff_passed": "Bu rezervasyonu iptal etmek için çok geç.",
      "generic": "İptal edilemedi. Lütfen tekrar deneyin."
    }
```

- [ ] **Step 2: Write the server action `app/s/[slug]/bookings/actions.ts`**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import * as z from 'zod';

import { db } from '@/db';
import { cancelBooking } from '@/lib/booking';
import { requireMember } from '@/lib/membership';

export type CancelFormState = { status: 'idle' | 'ok' | 'error'; error: string | null };

const cancelSchema = z.object({ bookingId: z.uuid() });

export async function cancelBookingAction(slug: string, _prev: CancelFormState, formData: FormData): Promise<CancelFormState> {
  const { club, user } = await requireMember(slug, '/bookings');
  const parsed = cancelSchema.safeParse({ bookingId: formData.get('bookingId') });
  if (!parsed.success) return { status: 'error', error: 'generic' };
  const result = await cancelBooking(db, { clubId: club.id, userId: user.id, bookingId: parsed.data.bookingId });
  if (!result.ok) return { status: 'error', error: result.error };
  revalidatePath(`/s/${slug}/bookings`);
  revalidatePath(`/s/${slug}/book`);
  return { status: 'ok', error: null };
}
```

- [ ] **Step 3: Write the client list `app/s/[slug]/bookings/bookings-list.tsx`**

```tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';

import { cancelBookingAction, type CancelFormState } from './actions';

export type BookingRow = {
  id: string;
  boatName: string;
  startAt: string; // ISO
  endAt: string; // ISO
  status: 'booked' | 'waitlisted' | 'cancelled' | 'no_show' | 'attended';
  queuePosition: number | null;
  canCancel: boolean;
};

const initial: CancelFormState = { status: 'idle', error: null };

function CancelButton({ slug, bookingId }: { slug: string; bookingId: string }) {
  const t = useTranslations('booking');
  const [state, formAction, pending] = useActionState(cancelBookingAction.bind(null, slug), initial);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Button type="submit" size="xs" variant="ghost" disabled={pending}>{t('cancel')}</Button>
      {state.status === 'error' && <span className="text-xs text-destructive">{t(`cancelErrors.${state.error ?? 'generic'}`)}</span>}
    </form>
  );
}

function statusLabel(t: ReturnType<typeof useTranslations>, row: BookingRow): string {
  if (row.status === 'waitlisted') return t('waitlisted', { position: row.queuePosition ?? 0 });
  if (row.status === 'booked') return t('seated');
  return row.status;
}

function Section({ slug, title, rows, timeZone, cancellable }: { slug: string; title: string; rows: BookingRow[]; timeZone: string; cancellable: boolean }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-heading text-base font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <span>
                {f.dateTime(new Date(row.startAt), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })}
                {' · '}{row.boatName}{' · '}{statusLabel(t, row)}
              </span>
              {cancellable && row.canCancel && <CancelButton slug={slug} bookingId={row.id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BookingsList({ slug, upcoming, past, timeZone }: { slug: string; upcoming: BookingRow[]; past: BookingRow[]; timeZone: string }) {
  const t = useTranslations('booking');
  return (
    <div className="flex flex-col gap-6">
      <Section slug={slug} title={t('upcoming')} rows={upcoming} timeZone={timeZone} cancellable />
      <Section slug={slug} title={t('past')} rows={past} timeZone={timeZone} cancellable={false} />
    </div>
  );
}
```

- [ ] **Step 4: Write the page `app/s/[slug]/bookings/page.tsx`**

```tsx
import { addHours } from 'date-fns';
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { boatTypes, bookings, sessions, slots } from '@/db/schema';
import { requireMember } from '@/lib/membership';

import { type BookingRow, BookingsList } from './bookings-list';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MyBookingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club, user } = await requireMember(slug, '/bookings');
  const t = await getTranslations('booking');
  const now = new Date();

  const rows = await db
    .select({ id: bookings.id, status: bookings.status, queuePosition: bookings.queuePosition, boatName: boatTypes.name, startAt: slots.startAt, endAt: slots.endAt })
    .from(bookings)
    .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
    .innerJoin(slots, eq(slots.id, sessions.slotId))
    .innerJoin(boatTypes, eq(boatTypes.id, sessions.boatTypeId))
    .where(and(eq(bookings.userId, user.id), eq(bookings.clubId, club.id)))
    .orderBy(desc(slots.startAt));

  const activeStatuses = new Set(['booked', 'waitlisted']);
  const toRow = (r: (typeof rows)[number]): BookingRow => {
    const cutoffOk = club.cancelCutoffHours == null || now.getTime() < r.startAt.getTime() - club.cancelCutoffHours * 3600_000;
    return {
      id: r.id, boatName: r.boatName, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString(),
      status: r.status, queuePosition: r.queuePosition,
      canCancel: club.selfCancelEnabled && activeStatuses.has(r.status) && r.startAt.getTime() > now.getTime() && cutoffOk,
    };
  };
  const upcoming = rows.filter((r) => r.startAt.getTime() > now.getTime() && activeStatuses.has(r.status)).map(toRow);
  const past = rows.filter((r) => !(r.startAt.getTime() > now.getTime() && activeStatuses.has(r.status))).map(toRow);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-lg font-semibold">{t('myTitle')}</h1>
        <Link href={`/s/${slug}/book`} className="text-sm underline">{t('back')}</Link>
      </div>
      <BookingsList slug={slug} upcoming={upcoming} past={past} timeZone={club.timezone} />
    </div>
  );
}
```

**Implementer note:** `addHours` is imported only if you prefer it over the millisecond arithmetic shown; if you keep the `* 3600_000` form, remove the unused `addHours` import to satisfy `no-unused-imports`. Keep imports sorted (simple-import-sort will autofix on commit via husky, but `pnpm lint` must pass with 0 warnings first).

- [ ] **Step 5: Verify lint, build, and route presence**

Run: `pnpm lint && pnpm build`
Expected: lint 0 warnings; build succeeds; output lists `/s/[slug]/bookings`.

- [ ] **Step 6: Commit**

```bash
git add app/s/[slug]/bookings messages/en.json messages/tr.json
git commit -m "feat(5C): my bookings page with self-cancel"
```

---

## Final verification (before the whole-branch review)

- [ ] `pnpm lint` → 0 warnings.
- [ ] `pnpm test` → unit suites green (eligibility, seating, plus existing).
- [ ] `pnpm test:integration` → all green (booking rush = exactly capacity, idempotency, auto-promotion, priority displacement, calendar closed-day surfacing, member-calendar).
- [ ] `pnpm build` → clean; `/s/[slug]/book` and `/s/[slug]/bookings` present.

---

## Self-Review

**1. Spec coverage:**
- Eligibility §7 → Task 1 (`checkEligibility`) + wired in `bookSeat` (Task 5) and `computeMemberCalendar` (Task 6). ✅
- Seating function §9 (equal/priority/displacement/waitlist positions) → Task 2 (`computeSeating`), applied on book + cancel (Task 5). ✅
- Concurrency §10 (per-slot advisory lock, exactly capacity, no-dup via `bookings_active_uq`, idempotency) → Task 4 (`findOrCreateSlotTx`) + Task 5 (`bookSeat` rush + idempotency tests). ✅
- Waitlist auto-promotion §9 → Task 5 (`cancelBooking` recompute test). ✅
- MultiSport modes §8 → Task 2 + Task 5 (priority displacement test). ✅
- Self-cancellation + cutoff §9 → Task 5 (`cancelBooking`) + Task 8 (`canCancel`). ✅
- Member UI (book calendar, my bookings) → Tasks 7–8. ✅
- Close-a-day-with-bookings (deferred #3) → Task 3 (surface persisted slots on closed days). ✅
- `materializeSlot` empty-boats guard (deferred) → Task 4. ✅
- Exact-`startAt` identity (deferred) → Task 5 recomputes `startAt` with `zonedWallClockToUtc` and validates. ✅
- Deferred/non-goals (notifications, attendance/penalties, owner-cancel, pre-reservation/guests, rate-limiter, stored-pref settings UI) → not implemented, by design. ✅

**2. Placeholder scan:** The only intentional non-compiling code is the `cancelBooking` sketch in Task 5, explicitly flagged with an implementer note that specifies the exact query and guard order to write. Every other step contains complete code. No "TBD"/"handle errors"/"similar to". ✅

**3. Type consistency:** `EligibilityResult`/`EligibilityReason` (T1) reused in T5/T6; `computeSeating` signature (T2) matches its callers in T5; `findOrCreateSlotTx`/`MaterializeBoat`/`FoundSession.capacity` (T4) match T5 usage; `VirtualSession` added fields (`sessionId`, `minSkillRank`, `allowedPayment`) (T3) consumed in T6; `MemberCalendarDay`/`MemberVirtualSession` (T6) consumed in T7; `BookResult`/`CancelResult` error unions (T5) map 1:1 to the i18n `errors`/`cancelErrors` keys (T7/T8). ✅
