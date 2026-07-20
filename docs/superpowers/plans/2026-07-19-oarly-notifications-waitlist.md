# Notifications & Waitlist-Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make seating sticky (a seated member can never be silently bumped), send email notifications for waitlist promotion / booking confirmation / cancellation, and give owners a Bookings view to remove a booking or seat a member into a free spot.

**Architecture:** Three workstreams. (1) Replace the "re-sort the whole session" seating logic with a status-aware **sticky** resolver so `booked` rows are never demoted; `priority` mode now only orders the waitlist. (2) A best-effort `notify` service, called from the server actions **after** the DB transaction commits, that renders react-email templates and sends via the existing Resend helper; waitlist promotion is deduped through the existing `notifications` idempotency log. (3) Owner booking management — a day-roster read model, owner add/remove booking functions (reusing the sticky resolver + advisory lock), and a dedicated manage "Bookings" view — with the affected member emailed on each owner action.

**Task order:** Tasks 1–5 (member notifications + sticky seating) land first; Tasks 6–9 (owner management) build on them.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Drizzle ORM + Postgres, Resend + react-email, next-intl, Vitest, pnpm.

## Global Constraints

- No `Co-Authored-By` / AI-attribution trailer in any commit.
- Never hand-author or edit `src/components/ui/*` (not touched in this plan anyway).
- No DB schema change: the `notifications` table is used as-is. Its unique index is `notifications_idem_uq` on `(user_id, type, session_id)`.
- `notification_type` enum values that exist: `booking_confirmation`, `waitlist_promotion`, `displaced`, `cancellation`, `reminder`. This plan writes rows **only** for `waitlist_promotion`.
- Booking `status` values: `booked`, `waitlisted`, `cancelled`, `no_show`, `attended`. "Active" = `['booked','waitlisted']`.
- `club.multisportMode` is `'equal' | 'priority'`, default `'equal'`. In `priority` mode, `priorityRank(regular)=0` and `priorityRank(multisport)=1`, and lower rank is seated/promoted first (regular ahead of multisport).
- Recipient email language = that user's `user.locale` (`text`, notNull, default `'tr'`). Locales are `['tr','en']`, default `tr`; TR copy is primary and both message files must stay mirrored.
- `notify` functions are **best-effort**: each wraps its body in `try/catch`, logs with `console.error`, and NEVER throws into the calling server action.
- Email context (club name, boat name, session date/time) is formatted in the club's IANA `timezone` using `Intl.DateTimeFormat` — no new date helper.
- Unit tests: `pnpm test`. Integration tests (need Postgres): `pnpm test:integration`. Lint: `pnpm lint` (`--max-warnings 0`). Typecheck: `pnpm exec tsc --noEmit`. Build: `pnpm build`.
- Do NOT push. Commits go to the feature branch for this cycle.

---

### Task 1: Sticky seating resolver

Replace the whole-session re-sort with a status-aware resolver that never demotes a `booked` row. This is the pure core of the displacement fix.

**Files:**
- Modify: `src/lib/seating.ts` (full rewrite of the exported function)
- Test: `src/lib/seating.test.ts` (full rewrite)

**Interfaces:**
- Consumes: nothing (pure function).
- Produces:
  ```ts
  export type SeatEntry = { id: string; status: 'booked' | 'waitlisted'; paymentType: 'regular' | 'multisport'; effectiveAt: Date };
  export type SeatAssignment = { id: string; status: 'booked' | 'waitlisted'; queuePosition: number | null };
  export function resolveSeating(entries: SeatEntry[], capacity: number, mode: 'equal' | 'priority'): SeatAssignment[];
  ```

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `src/lib/seating.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

import { resolveSeating } from './seating';

const b = (id: string, iso: string, pt: 'regular' | 'multisport' = 'regular') =>
  ({ id, status: 'booked' as const, paymentType: pt, effectiveAt: new Date(iso) });
const w = (id: string, iso: string, pt: 'regular' | 'multisport' = 'regular') =>
  ({ id, status: 'waitlisted' as const, paymentType: pt, effectiveAt: new Date(iso) });

describe('resolveSeating', () => {
  it('keeps a seated member seated — a later regular does NOT displace an earlier multisport (priority mode)', () => {
    const out = resolveSeating([b('m', '2026-07-17T09:00:00Z', 'multisport'), w('r', '2026-07-17T09:05:00Z', 'regular')], 1, 'priority');
    expect(out).toContainEqual({ id: 'm', status: 'booked', queuePosition: null });
    expect(out).toContainEqual({ id: 'r', status: 'waitlisted', queuePosition: 1 });
  });

  it('never demotes a seated booking even if over capacity (defensive)', () => {
    const out = resolveSeating([b('a', '2026-07-17T09:00:00Z'), b('b', '2026-07-17T09:01:00Z')], 1, 'equal');
    expect(out.every((x) => x.status === 'booked')).toBe(true);
  });

  it('fills a free seat from the waitlist by priority order (priority mode: regular promoted before earlier multisport)', () => {
    const out = resolveSeating([b('s', '2026-07-17T09:00:00Z'), w('m', '2026-07-17T09:01:00Z', 'multisport'), w('r', '2026-07-17T09:02:00Z', 'regular')], 2, 'priority');
    expect(out.find((x) => x.id === 's')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'r')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'm')!).toEqual({ id: 'm', status: 'waitlisted', queuePosition: 1 });
  });

  it('fills a free seat FIFO in equal mode (earliest waiter promoted)', () => {
    const out = resolveSeating([b('s', '2026-07-17T09:00:00Z'), w('e', '2026-07-17T09:02:00Z'), w('d', '2026-07-17T09:01:00Z')], 2, 'equal');
    expect(out.find((x) => x.id === 'd')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'e')!).toEqual({ id: 'e', status: 'waitlisted', queuePosition: 1 });
  });

  it('leaves the waitlist untouched when the session is full', () => {
    const out = resolveSeating([b('a', '2026-07-17T09:00:00Z'), b('b', '2026-07-17T09:01:00Z'), w('c', '2026-07-17T09:02:00Z')], 2, 'equal');
    expect(out.filter((x) => x.status === 'booked').map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(out.find((x) => x.id === 'c')!).toEqual({ id: 'c', status: 'waitlisted', queuePosition: 1 });
  });

  it('numbers a longer waitlist 1-based in priority order', () => {
    const out = resolveSeating([b('s', '2026-07-17T09:00:00Z'), w('m', '2026-07-17T09:01:00Z', 'multisport'), w('r', '2026-07-17T09:03:00Z', 'regular')], 1, 'priority');
    // no free seat (1 booked, capacity 1); regular (rank 0) ranks ahead of multisport
    expect(out.find((x) => x.id === 'r')!).toEqual({ id: 'r', status: 'waitlisted', queuePosition: 1 });
    expect(out.find((x) => x.id === 'm')!).toEqual({ id: 'm', status: 'waitlisted', queuePosition: 2 });
  });

  it('breaks exact-time ties deterministically by id', () => {
    const t = '2026-07-17T09:00:00Z';
    const out = resolveSeating([w('b', t), w('a', t)], 1, 'equal');
    expect(out.find((x) => x.id === 'a')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'b')!.status).toBe('waitlisted');
  });

  it('returns an empty array for no entries and seats all when under capacity', () => {
    expect(resolveSeating([], 4, 'equal')).toEqual([]);
    expect(resolveSeating([w('a', '2026-07-17T09:00:00Z')], 4, 'equal')).toEqual([{ id: 'a', status: 'booked', queuePosition: null }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/seating.test.ts`
Expected: FAIL — `resolveSeating` is not exported (still `computeSeating`).

- [ ] **Step 3: Rewrite `src/lib/seating.ts`**

Replace the entire file with:

```ts
export type SeatEntry = { id: string; status: 'booked' | 'waitlisted'; paymentType: 'regular' | 'multisport'; effectiveAt: Date };
export type SeatAssignment = { id: string; status: 'booked' | 'waitlisted'; queuePosition: number | null };

/**
 * Sticky §9 seating for ONE session. Given the session's active bookings WITH
 * their current status, the capacity, and the club's MultiSport mode, returns
 * each booking's resolved status + waitlist position.
 *
 * Rule: a currently-`booked` booking is NEVER demoted. Any free seats
 * (capacity − #booked) are filled from the `waitlisted` pool ordered by
 * (priorityRank asc, effectiveAt asc, id asc); the remainder are waitlisted with
 * 1-based positions in that same order. priorityRank = 1 only for a MultiSport
 * booking in `priority` mode, else 0 (so regular ranks ahead of multisport).
 * Pure — no DB, no time source.
 */
export function resolveSeating(entries: SeatEntry[], capacity: number, mode: 'equal' | 'priority'): SeatAssignment[] {
  const rankOf = (p: 'regular' | 'multisport') => (mode === 'priority' && p === 'multisport' ? 1 : 0);
  const byPriority = (a: SeatEntry, b: SeatEntry) => {
    const ra = rankOf(a.paymentType);
    const rb = rankOf(b.paymentType);
    if (ra !== rb) return ra - rb;
    const ta = a.effectiveAt.getTime();
    const tb = b.effectiveAt.getTime();
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  const seated = entries.filter((e) => e.status === 'booked');
  const waitPool = entries.filter((e) => e.status === 'waitlisted').sort(byPriority);
  const freeSeats = Math.max(0, capacity - seated.length);

  const promoted = waitPool.slice(0, freeSeats);
  const stayWaiting = waitPool.slice(freeSeats);

  return [
    ...seated.map((e) => ({ id: e.id, status: 'booked' as const, queuePosition: null })),
    ...promoted.map((e) => ({ id: e.id, status: 'booked' as const, queuePosition: null })),
    ...stayWaiting.map((e, i) => ({ id: e.id, status: 'waitlisted' as const, queuePosition: i + 1 })),
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/seating.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/seating.ts src/lib/seating.test.ts
git commit -m "feat(seating): sticky resolver that never demotes a seated booking"
```

---

### Task 2: Wire the sticky resolver into bookSeat & cancelBooking

Make both booking paths use `resolveSeating` (inserting new bookings as `waitlisted` first so nobody is ever displaced), and have `cancelBooking` report who was promoted.

**Files:**
- Modify: `src/lib/booking.ts` (import; `CancelResult`; `bookSeat` step 9; `cancelBooking` body)
- Test: `src/lib/booking.integration.test.ts` (add 3 tests)

**Interfaces:**
- Consumes: `resolveSeating`, `SeatEntry` from Task 1.
- Produces (public contract change — additive):
  ```ts
  export type CancelResult =
    | { ok: true; promoted?: { userId: string; sessionId: string } }
    | { ok: false; error: 'not_found' | 'not_active' | 'cancel_disabled' | 'cutoff_passed' };
  ```
  `bookSeat`'s `BookResult` is unchanged. `cancelBooking` sets `promoted` only when cancelling a `booked` row causes a waitlisted booking to be seated and that booking has a non-null `userId`.

- [ ] **Step 1: Add the failing integration tests**

Append these three tests inside the `describe.skipIf(!url)('bookSeat / cancelBooking', ...)` block in `src/lib/booking.integration.test.ts` (they use the file's existing `scenario`, `newMember`, `key` helpers):

```ts
  it('a later booking never displaces a seated member (priority mode)', async () => {
    const s = await scenario({ seats: 1, mode: 'priority', allowedPayment: 'both' });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START };
    const r1 = await bookSeat(db, { ...common, userId: u1, paymentType: 'multisport', idempotencyKey: key() });
    const r2 = await bookSeat(db, { ...common, userId: u2, paymentType: 'regular', idempotencyKey: key() });
    expect(r1).toMatchObject({ ok: true, outcome: 'seated' });
    expect(r2).toMatchObject({ ok: true, outcome: 'waitlisted' });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
    expect(rows.find((r) => r.userId === u1)!.status).toBe('booked');
    expect(rows.find((r) => r.userId === u2)!.status).toBe('waitlisted');
  });

  it('cancelling a seated booking promotes the head of the waitlist and reports it', async () => {
    const s = await scenario({ seats: 1 });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular' as const };
    const r1 = await bookSeat(db, { ...common, userId: u1, idempotencyKey: key() });
    await bookSeat(db, { ...common, userId: u2, idempotencyKey: key() });
    if (!r1.ok) throw new Error('setup');
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u1, bookingId: r1.bookingId });
    expect(cancel).toMatchObject({ ok: true, promoted: { userId: u2, sessionId: expect.any(String) } });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
    expect(rows.find((r) => r.userId === u2)!.status).toBe('booked');
  });

  it('cancelling a waitlisted booking promotes nobody', async () => {
    const s = await scenario({ seats: 1 });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular' as const };
    await bookSeat(db, { ...common, userId: u1, idempotencyKey: key() });
    const r2 = await bookSeat(db, { ...common, userId: u2, idempotencyKey: key() });
    if (!r2.ok) throw new Error('setup');
    const cancel = await cancelBooking(db, { clubId: s.club.id, userId: u2, bookingId: r2.bookingId });
    expect(cancel).toEqual({ ok: true });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
    expect(rows.find((r) => r.userId === u1)!.status).toBe('booked');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:integration -- src/lib/booking.integration.test.ts`
Expected: the new "later booking never displaces" test FAILS (current code displaces u1) and the two `promoted` tests FAIL (`cancelBooking` returns `{ ok: true }` with no `promoted`).

- [ ] **Step 3: Update the import and `CancelResult` in `src/lib/booking.ts`**

Change the seating import (line 11):

```ts
import { resolveSeating } from './seating';
```

Replace the `CancelResult` type (lines 33-35) with:

```ts
export type CancelInput = { clubId: string; userId: string; bookingId: string; now?: Date };
export type CancelResult =
  | { ok: true; promoted?: { userId: string; sessionId: string } }
  | { ok: false; error: 'not_found' | 'not_active' | 'cancel_disabled' | 'cutoff_passed' };
```

- [ ] **Step 4: Rewrite `bookSeat` step 9 (lines 124-130)**

Replace that block with:

```ts
    // 9. Insert the booking as waitlisted, then resolve seating for the target session.
    //    Sticky rule (resolveSeating): existing seated bookings are never demoted;
    //    the new booking takes a free seat if one exists, else joins the waitlist.
    const [inserted] = await tx.insert(bookings).values({ sessionId: target.id, clubId: input.clubId, userId: input.userId, paymentType: input.paymentType, status: 'waitlisted', effectiveAt: now, source: 'member', idempotencyKey: input.idempotencyKey }).returning({ id: bookings.id });
    const active = await tx.select({ id: bookings.id, status: bookings.status, paymentType: bookings.paymentType, effectiveAt: bookings.effectiveAt }).from(bookings).where(and(eq(bookings.sessionId, target.id), inArray(bookings.status, [...ACTIVE])));
    const assignments = resolveSeating(active.map((a) => ({ id: a.id, status: a.status as 'booked' | 'waitlisted', paymentType: a.paymentType, effectiveAt: a.effectiveAt })), target.capacity, club.multisportMode);
    for (const a of assignments) await tx.update(bookings).set({ status: a.status, queuePosition: a.queuePosition }).where(eq(bookings.id, a.id));
    const mine = assignments.find((a) => a.id === inserted.id)!;
    return { ok: true, bookingId: inserted.id, outcome: mine.status === 'booked' ? 'seated' : 'waitlisted', queuePosition: mine.queuePosition };
```

- [ ] **Step 5: Rewrite the `cancelBooking` recompute + return (lines 161-168)**

Replace from the `await tx.update(bookings).set({ status: 'cancelled' ... })` line through the final `return { ok: true };` with:

```ts
    await tx.update(bookings).set({ status: 'cancelled', queuePosition: null }).where(eq(bookings.id, input.bookingId));

    // Resolve seating for the session. Sticky rule: seated bookings are never
    // demoted; if a seat just freed (a `booked` row was cancelled), the top of
    // the waitlist is promoted into it.
    const active = await tx.select({ id: bookings.id, userId: bookings.userId, status: bookings.status, paymentType: bookings.paymentType, effectiveAt: bookings.effectiveAt }).from(bookings).where(and(eq(bookings.sessionId, row.sessionId), inArray(bookings.status, [...ACTIVE])));
    const prevStatus = new Map(active.map((a) => [a.id, a.status]));
    const assignments = resolveSeating(active.map((a) => ({ id: a.id, status: a.status as 'booked' | 'waitlisted', paymentType: a.paymentType, effectiveAt: a.effectiveAt })), row.capacity, row.multisportMode);
    for (const a of assignments) await tx.update(bookings).set({ status: a.status, queuePosition: a.queuePosition }).where(eq(bookings.id, a.id));

    // A booking that went waitlisted -> booked filled the freed seat.
    const promotedAssignment = row.status === 'booked'
      ? assignments.find((a) => a.status === 'booked' && prevStatus.get(a.id) === 'waitlisted')
      : undefined;
    const promotedUserId = promotedAssignment ? (active.find((a) => a.id === promotedAssignment.id)?.userId ?? null) : null;
    return promotedUserId ? { ok: true, promoted: { userId: promotedUserId, sessionId: row.sessionId } } : { ok: true };
```

- [ ] **Step 6: Run the full booking + seating suites**

Run: `pnpm test:integration -- src/lib/booking.integration.test.ts` then `pnpm exec vitest run src/lib/seating.test.ts`
Expected: all PASS, including the pre-existing "cancellation auto-promotes the head of the waitlist" test.

- [ ] **Step 7: Typecheck & commit**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

```bash
git add src/lib/booking.ts src/lib/booking.integration.test.ts
git commit -m "feat(booking): sticky seating + report promoted member on cancel"
```

---

### Task 3: Notification email template, render functions & i18n

One parametrized react-email template plus three render functions (one per notice). A single `BookingNoticeEmail` component is used for all three — the notices share the same structure (heading + intro + detail rows), so this is the DRY realization of the spec's "three notice emails."

**Files:**
- Create: `src/emails/booking-notice.tsx`
- Modify: `src/emails/index.ts` (add three render fns + a private `formatWhen`)
- Modify: `messages/tr.json` and `messages/en.json` (add `emails.booking`)
- Test: `src/emails/booking-emails.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type BookingWhen = { clubName: string; boatName: string; startAt: Date; endAt: Date; timezone: string };
  export function renderBookingConfirmation(locale: string, data: BookingWhen & { outcome: 'seated' | 'waitlisted'; queuePosition: number | null }): Promise<RenderedEmail>;
  export function renderWaitlistPromotion(locale: string, data: BookingWhen): Promise<RenderedEmail>;
  export function renderBookingCancellation(locale: string, data: BookingWhen): Promise<RenderedEmail>;
  ```
  `RenderedEmail = { subject: string; html: string; text: string }` (already exported from `src/emails/index.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/emails/booking-emails.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { renderBookingCancellation, renderBookingConfirmation, renderWaitlistPromotion } from './index';

const base = {
  clubName: 'Bebek Rowing',
  boatName: 'Quad',
  startAt: new Date('2026-07-20T05:00:00Z'),
  endAt: new Date('2026-07-20T06:00:00Z'),
  timezone: 'Europe/Istanbul',
};

describe('booking notice emails', () => {
  for (const locale of ['tr', 'en'] as const) {
    it(`confirmation (seated) renders subject/html/text with the club and boat (${locale})`, async () => {
      const out = await renderBookingConfirmation(locale, { ...base, outcome: 'seated', queuePosition: null });
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html).toContain('Bebek Rowing');
      expect(out.html).toContain('Quad');
      expect(out.text.length).toBeGreaterThan(0);
    });

    it(`confirmation (waitlisted) shows the queue position (${locale})`, async () => {
      const out = await renderBookingConfirmation(locale, { ...base, outcome: 'waitlisted', queuePosition: 3 });
      expect(out.html).toContain('3');
    });

    it(`promotion renders (${locale})`, async () => {
      const out = await renderWaitlistPromotion(locale, base);
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html).toContain('Quad');
    });

    it(`cancellation renders (${locale})`, async () => {
      const out = await renderBookingCancellation(locale, base);
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html).toContain('Bebek Rowing');
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/emails/booking-emails.test.ts`
Expected: FAIL — the render functions do not exist.

- [ ] **Step 3: Create the template `src/emails/booking-notice.tsx`**

```tsx
import { Heading, Text } from 'react-email';

import { EmailLayout } from './layout';

export type BookingNoticeProps = {
  heading: string;
  intro: string;
  rows: { label: string; value: string }[];
  locale: string;
};

/**
 * Shared presentational template for booking-related notices (confirmation,
 * waitlist promotion, cancellation). Takes already-translated strings as props
 * so the template stays i18n-agnostic, matching the auth email templates.
 */
export function BookingNoticeEmail({ heading, intro, rows, locale }: BookingNoticeProps) {
  return (
    <EmailLayout preview={heading} locale={locale}>
      <Heading style={headingStyle}>{heading}</Heading>
      <Text style={textStyle}>{intro}</Text>
      {rows.map((r) => (
        <Text key={r.label} style={rowStyle}>
          <strong>{r.label}:</strong> {r.value}
        </Text>
      ))}
    </EmailLayout>
  );
}

export default BookingNoticeEmail;

const headingStyle = { fontSize: '20px', fontWeight: 'bold' as const, color: '#18181b', margin: '0 0 16px' };
const textStyle = { fontSize: '14px', lineHeight: '22px', color: '#3f3f46', margin: '0 0 16px' };
const rowStyle = { fontSize: '14px', lineHeight: '22px', color: '#18181b', margin: '0 0 4px' };
```

- [ ] **Step 4: Add the render functions to `src/emails/index.ts`**

Add this import near the other template imports (after line 7):

```ts
import { BookingNoticeEmail } from './booking-notice';
```

Append to the end of the file:

```ts
type BookingWhen = { clubName: string; boatName: string; startAt: Date; endAt: Date; timezone: string };

/** Human date + time range in the club's timezone, e.g. "Monday, 20 July, 08:00–09:00". */
function formatWhen(locale: Locale, tz: string, startAt: Date, endAt: Date): string {
  const day = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(startAt);
  const clock = (d: Date) => new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${day}, ${clock(startAt)}–${clock(endAt)}`;
}

function baseRows(t: Awaited<ReturnType<typeof loadEmailsTranslator>>, data: BookingWhen, locale: Locale) {
  return [
    { label: t('booking.labels.club'), value: data.clubName },
    { label: t('booking.labels.boat'), value: data.boatName },
    { label: t('booking.labels.when'), value: formatWhen(locale, data.timezone, data.startAt, data.endAt) },
  ];
}

async function renderNotice(locale: Locale, subject: string, heading: string, intro: string, rows: { label: string; value: string }[]): Promise<RenderedEmail> {
  const element = BookingNoticeEmail({ heading, intro, rows, locale });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

export async function renderBookingConfirmation(
  locale: string,
  data: BookingWhen & { outcome: 'seated' | 'waitlisted'; queuePosition: number | null },
): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  const rows = baseRows(t, data, validLocale);
  if (data.outcome === 'waitlisted') rows.push({ label: t('booking.labels.queuePosition'), value: String(data.queuePosition ?? '') });
  const heading = data.outcome === 'seated' ? t('booking.confirmation.headingSeated') : t('booking.confirmation.headingWaitlisted');
  const intro = data.outcome === 'seated' ? t('booking.confirmation.introSeated') : t('booking.confirmation.introWaitlisted');
  return renderNotice(validLocale, t('booking.confirmation.subject'), heading, intro, rows);
}

export async function renderWaitlistPromotion(locale: string, data: BookingWhen): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  return renderNotice(validLocale, t('booking.promotion.subject'), t('booking.promotion.heading'), t('booking.promotion.intro'), baseRows(t, data, validLocale));
}

export async function renderBookingCancellation(locale: string, data: BookingWhen): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  return renderNotice(validLocale, t('booking.cancellation.subject'), t('booking.cancellation.heading'), t('booking.cancellation.intro'), baseRows(t, data, validLocale));
}
```

Note: `createTranslator` is already imported at the top of `index.ts`; `Locale` is imported from `@/i18n/config`; `render`, `toLocale`, `loadEmailsTranslator`, `RenderedEmail` already exist in the file.

- [ ] **Step 5: Add the `emails.booking` keys to both message files**

In `messages/tr.json`, add a `booking` object inside the existing `emails` object (sibling of `verify`/`reset`):

```json
    "booking": {
      "confirmation": {
        "subject": "Oarly — Rezervasyonunuz alındı",
        "headingSeated": "Yeriniz onaylandı",
        "headingWaitlisted": "Bekleme listesindesiniz",
        "introSeated": "Rezervasyonunuz onaylandı. Ayrıntılar aşağıda.",
        "introWaitlisted": "Seans dolu olduğu için bekleme listesine eklendiniz. Yer açılırsa sizi bilgilendireceğiz."
      },
      "promotion": {
        "subject": "Oarly — Yeriniz açıldı!",
        "heading": "İçeridesiniz!",
        "intro": "Bekleme listesinden yükseldiniz — yeriniz onaylandı."
      },
      "cancellation": {
        "subject": "Oarly — Rezervasyonunuz iptal edildi",
        "heading": "Rezervasyon iptal edildi",
        "intro": "Rezervasyonunuz iptal edildi. Ayrıntılar aşağıda."
      },
      "labels": {
        "club": "Kulüp",
        "boat": "Tekne",
        "when": "Tarih",
        "queuePosition": "Sıra"
      }
    }
```

In `messages/en.json`, add the mirrored object inside `emails`:

```json
    "booking": {
      "confirmation": {
        "subject": "Oarly — Booking received",
        "headingSeated": "Your seat is confirmed",
        "headingWaitlisted": "You're on the waitlist",
        "introSeated": "Your booking is confirmed. Details below.",
        "introWaitlisted": "The session was full, so you've been added to the waitlist. We'll let you know if a seat opens up."
      },
      "promotion": {
        "subject": "Oarly — A seat opened up!",
        "heading": "You're in!",
        "intro": "You've been promoted from the waitlist — your seat is confirmed."
      },
      "cancellation": {
        "subject": "Oarly — Booking cancelled",
        "heading": "Booking cancelled",
        "intro": "Your booking has been cancelled. Details below."
      },
      "labels": {
        "club": "Club",
        "boat": "Boat",
        "when": "When",
        "queuePosition": "Queue position"
      }
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run src/emails/booking-emails.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Typecheck & commit**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

```bash
git add src/emails/booking-notice.tsx src/emails/index.ts src/emails/booking-emails.test.ts messages/tr.json messages/en.json
git commit -m "feat(emails): booking notice template + confirmation/promotion/cancellation renderers"
```

---

### Task 4: The `notify` service

A best-effort service that renders and sends each notice, deduping waitlist promotion through the `notifications` idempotency log. Never throws into a caller.

**Files:**
- Create: `src/lib/notify.ts`
- Test: `src/lib/notify.integration.test.ts`

**Interfaces:**
- Consumes: `renderBookingConfirmation`, `renderWaitlistPromotion`, `renderBookingCancellation` (Task 3); `sendEmail` (`@/lib/email`); `notifications` schema.
- Produces:
  ```ts
  export function notifyBookingConfirmation(db: DB, args: { bookingId: string }): Promise<void>;
  export function notifyBookingCancellation(db: DB, args: { bookingId: string }): Promise<void>;
  export function notifyWaitlistPromotion(db: DB, args: { userId: string; sessionId: string }): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/notify.integration.test.ts`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email';

import { zonedWallClockToUtc } from './date-tz';
import { notifyBookingCancellation, notifyBookingConfirmation, notifyWaitlistPromotion } from './notify';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));
const sendMock = vi.mocked(sendEmail);

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
const MON = '2026-07-20';
const START = zonedWallClockToUtc(MON, '08:00', TZ);
const END = zonedWallClockToUtc(MON, '09:00', TZ);

describe.skipIf(!url)('notify', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });
  beforeEach(() => { sendMock.mockReset(); });

  let seq = 0;
  // Seed a single booking + its session/slot/club/boat/user directly (no bookSeat needed).
  async function seedBooking(status: 'booked' | 'waitlisted' | 'cancelled', queuePosition: number | null = null) {
    const tag = `ntf-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: `Club ${tag}`, status: 'active', timezone: TZ }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 2, allowedPayment: 'both' }).returning();
    const [slot] = await db.insert(schema.slots).values({ clubId: club.id, date: MON, startAt: START, endAt: END }).returning();
    const [session] = await db.insert(schema.sessions).values({ slotId: slot.id, clubId: club.id, boatTypeId: boat.id, capacity: 2 }).returning();
    const uid = `${tag}-u`;
    await db.insert(schema.user).values({ id: uid, name: 'Rower', email: `${uid}@t.co` });
    const [booking] = await db.insert(schema.bookings).values({ sessionId: session.id, clubId: club.id, userId: uid, paymentType: 'regular', status, queuePosition, effectiveAt: START }).returning();
    return { club, session, uid, booking, email: `${uid}@t.co` };
  }

  it('confirmation sends one email to the member and writes NO notifications row', async () => {
    const s = await seedBooking('booked');
    await notifyBookingConfirmation(db, { bookingId: s.booking.id });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: s.email });
    const logs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, s.uid));
    expect(logs).toHaveLength(0);
  });

  it('cancellation sends one email and writes NO notifications row', async () => {
    const s = await seedBooking('cancelled');
    await notifyBookingCancellation(db, { bookingId: s.booking.id });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const logs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, s.uid));
    expect(logs).toHaveLength(0);
  });

  it('promotion sends once and is idempotent (second call is a no-op)', async () => {
    const s = await seedBooking('booked');
    await notifyWaitlistPromotion(db, { userId: s.uid, sessionId: s.session.id });
    await notifyWaitlistPromotion(db, { userId: s.uid, sessionId: s.session.id });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const logs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, s.uid));
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe('waitlist_promotion');
  });

  it('never throws when sendEmail fails', async () => {
    const s = await seedBooking('booked');
    sendMock.mockRejectedValueOnce(new Error('resend down'));
    await expect(notifyBookingConfirmation(db, { bookingId: s.booking.id })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration -- src/lib/notify.integration.test.ts`
Expected: FAIL — `./notify` does not exist.

- [ ] **Step 3: Implement `src/lib/notify.ts`**

```ts
import { and, eq, type SQL } from 'drizzle-orm';

import type { DB } from '@/db';
import { boatTypes, bookings, clubs, notifications, sessions, slots, user } from '@/db/schema';
import { renderBookingCancellation, renderBookingConfirmation, renderWaitlistPromotion } from '@/emails';
import { sendEmail } from '@/lib/email';

type Ctx = {
  toEmail: string;
  locale: string;
  clubName: string;
  timezone: string;
  boatName: string;
  startAt: Date;
  endAt: Date;
  status: 'booked' | 'waitlisted' | 'cancelled' | 'no_show' | 'attended';
  queuePosition: number | null;
};

/** Join a booking to everything an email needs. Returns null if not found. */
async function loadCtx(db: DB, where: SQL): Promise<Ctx | null> {
  const [row] = await db
    .select({
      toEmail: user.email,
      locale: user.locale,
      clubName: clubs.name,
      timezone: clubs.timezone,
      boatName: boatTypes.name,
      startAt: slots.startAt,
      endAt: slots.endAt,
      status: bookings.status,
      queuePosition: bookings.queuePosition,
    })
    .from(bookings)
    .innerJoin(user, eq(user.id, bookings.userId))
    .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
    .innerJoin(slots, eq(slots.id, sessions.slotId))
    .innerJoin(clubs, eq(clubs.id, bookings.clubId))
    .innerJoin(boatTypes, eq(boatTypes.id, sessions.boatTypeId))
    .where(where);
  return row ?? null;
}

/** Best-effort: emails a booking/waitlist confirmation. Never throws. */
export async function notifyBookingConfirmation(db: DB, { bookingId }: { bookingId: string }): Promise<void> {
  try {
    const ctx = await loadCtx(db, eq(bookings.id, bookingId));
    if (!ctx) return;
    const outcome = ctx.status === 'booked' ? 'seated' : 'waitlisted';
    const email = await renderBookingConfirmation(ctx.locale, { clubName: ctx.clubName, boatName: ctx.boatName, startAt: ctx.startAt, endAt: ctx.endAt, timezone: ctx.timezone, outcome, queuePosition: ctx.queuePosition });
    await sendEmail({ to: ctx.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyBookingConfirmation failed', err);
  }
}

/** Best-effort: emails a cancellation confirmation. Never throws. */
export async function notifyBookingCancellation(db: DB, { bookingId }: { bookingId: string }): Promise<void> {
  try {
    const ctx = await loadCtx(db, eq(bookings.id, bookingId));
    if (!ctx) return;
    const email = await renderBookingCancellation(ctx.locale, { clubName: ctx.clubName, boatName: ctx.boatName, startAt: ctx.startAt, endAt: ctx.endAt, timezone: ctx.timezone });
    await sendEmail({ to: ctx.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyBookingCancellation failed', err);
  }
}

/**
 * Best-effort: emails a waitlist-promotion notice, at-most-once per (user,
 * session) via the notifications idempotency log. Never throws.
 */
export async function notifyWaitlistPromotion(db: DB, { userId, sessionId }: { userId: string; sessionId: string }): Promise<void> {
  try {
    const [logged] = await db
      .insert(notifications)
      .values({ userId, type: 'waitlist_promotion', sessionId })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!logged) return; // already sent for this (user, session)
    const ctx = await loadCtx(db, and(eq(bookings.userId, userId), eq(bookings.sessionId, sessionId), eq(bookings.status, 'booked'))!);
    if (!ctx) return;
    const email = await renderWaitlistPromotion(ctx.locale, { clubName: ctx.clubName, boatName: ctx.boatName, startAt: ctx.startAt, endAt: ctx.endAt, timezone: ctx.timezone });
    await sendEmail({ to: ctx.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyWaitlistPromotion failed', err);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:integration -- src/lib/notify.integration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck, lint & commit**

Run: `pnpm exec tsc --noEmit` then `pnpm lint`
Expected: both exit 0.

```bash
git add src/lib/notify.ts src/lib/notify.integration.test.ts
git commit -m "feat(notify): best-effort email service for booking, promotion, cancellation"
```

---

### Task 5: Wire `notify` into the member server actions

Call the notify service after each action's transaction commits and paths are revalidated. Because notify is best-effort (never throws), awaiting it is safe and guarantees the send runs before the serverless function returns.

**Files:**
- Modify: `app/s/[slug]/(member)/book/actions.ts`
- Modify: `app/s/[slug]/(member)/bookings/actions.ts`

**Interfaces:**
- Consumes: `notifyBookingConfirmation`, `notifyBookingCancellation`, `notifyWaitlistPromotion` (Task 4); `CancelResult.promoted` (Task 2); `BookResult.bookingId` (existing).

- [ ] **Step 1: Wire confirmation into `bookSeatAction`**

In `app/s/[slug]/(member)/book/actions.ts`, add the import (with the other `@/lib` imports):

```ts
import { notifyBookingConfirmation } from '@/lib/notify';
```

Replace the tail of `bookSeatAction` (from `if (!result.ok)` to the final return) with:

```ts
  if (!result.ok) return { status: 'error', error: result.error };
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);
  await notifyBookingConfirmation(db, { bookingId: result.bookingId });
  return { status: 'ok', error: null, outcome: result.outcome };
```

- [ ] **Step 2: Wire cancellation + promotion into `cancelBookingAction`**

In `app/s/[slug]/(member)/bookings/actions.ts`, add the import:

```ts
import { notifyBookingCancellation, notifyWaitlistPromotion } from '@/lib/notify';
```

Replace the tail of `cancelBookingAction` (from `if (!result.ok)` to the final return) with:

```ts
  if (!result.ok) return { status: 'error', error: result.error };
  revalidatePath(`/s/${slug}/bookings`);
  revalidatePath(`/s/${slug}/book`);
  await notifyBookingCancellation(db, { bookingId: parsed.data.bookingId });
  if (result.promoted) await notifyWaitlistPromotion(db, result.promoted);
  return { status: 'ok', error: null };
```

- [ ] **Step 3: Typecheck, lint & build**

Run: `pnpm exec tsc --noEmit` then `pnpm lint` then `pnpm build`
Expected: all exit 0; all routes compile.

- [ ] **Step 4: Manual verification note (no automated test — server actions need a request context)**

With a dev server and `RESEND_API_KEY`/`EMAIL_FROM` unset, the `sendEmail` dev no-op logs `[email:dev] { to, subject }`. Confirm by watching the server log:
- Book a free seat → one `booking_confirmation`-style log line to the booking member.
- Book into a full session → confirmation log (waitlisted copy).
- A seated member cancels while someone is waitlisted → a cancellation log to the canceller **and** a promotion log to the promoted member.
- Cancel again / re-trigger the same promotion → no second promotion log line (idempotency).

- [ ] **Step 5: Commit**

```bash
git add "app/s/[slug]/(member)/book/actions.ts" "app/s/[slug]/(member)/bookings/actions.ts"
git commit -m "feat(booking): send email notifications on book, cancel, and waitlist promotion"
```

---

### Task 6: Day-roster read model

An owner-facing read model that lists a day's sessions each with its booking roster. Built on `computeCalendar` (enumeration) + a `bookings`→`user` join (roster).

**Files:**
- Create: `src/lib/roster.ts`
- Test: `src/lib/roster.integration.test.ts`

**Interfaces:**
- Consumes: `computeCalendar` (`src/lib/calendar.ts`) — returns `CalendarDay[]`; each `CalendarDay` has `dateISO`, `closed`, `slots: VirtualSlot[]`; each `VirtualSlot` has `windowId: string | null`, `startAt: Date`, `endAt: Date`, `sessions: VirtualSession[]`; each `VirtualSession` has `sessionId: string | null`, `boatTypeId`, `boatName`, `capacity`, `status: 'open'|'closed'|'cancelled'`.
- Produces:
  ```ts
  export type RosterMember = { bookingId: string; name: string; paymentType: 'regular' | 'multisport'; queuePosition: number | null };
  export type RosterSession = { sessionId: string | null; windowId: string | null; startAt: Date; endAt: Date; boatTypeId: string; boatName: string; capacity: number; status: 'open' | 'closed' | 'cancelled'; seated: RosterMember[]; waitlisted: RosterMember[]; freeSeats: number };
  export type RosterDay = { dateISO: string; closed: boolean; sessions: RosterSession[] };
  export function getDayRoster(db: DB, args: { clubId: string; dateISO: string }): Promise<RosterDay>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/roster.integration.test.ts`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { zonedWallClockToUtc } from './date-tz';
import { getDayRoster } from './roster';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
const MON = '2026-07-20';
const START = zonedWallClockToUtc(MON, '08:00', TZ);
const END = zonedWallClockToUtc(MON, '09:00', TZ);

describe.skipIf(!url)('getDayRoster', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  async function seed() {
    const tag = `rst-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 1, allowedPayment: 'both' }).returning();
    const [w] = await db.insert(schema.scheduleWindows).values({ clubId: club.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60 }).returning();
    await db.insert(schema.windowBoats).values({ windowId: w.id, boatTypeId: boat.id, quantity: 1 });
    const [slot] = await db.insert(schema.slots).values({ clubId: club.id, date: MON, startAt: START, endAt: END, fromWindowId: w.id }).returning();
    const [session] = await db.insert(schema.sessions).values({ slotId: slot.id, clubId: club.id, boatTypeId: boat.id, capacity: 1 }).returning();
    const mk = async (name: string, status: 'booked' | 'waitlisted', qpos: number | null) => {
      const uid = `${tag}-${name}`;
      await db.insert(schema.user).values({ id: uid, name, email: `${uid}@t.co` });
      await db.insert(schema.bookings).values({ sessionId: session.id, clubId: club.id, userId: uid, paymentType: 'regular', status, queuePosition: qpos, effectiveAt: START });
    };
    await mk('alice', 'booked', null);
    await mk('bob', 'waitlisted', 1);
    return { club, windowId: w.id };
  }

  it('returns each session with its seated and waitlisted roster', async () => {
    const { club, windowId } = await seed();
    const roster = await getDayRoster(db, { clubId: club.id, dateISO: MON });
    const sess = roster.sessions.find((x) => x.startAt.getTime() === START.getTime());
    expect(sess).toBeTruthy();
    expect(sess!.boatName).toBe('Quad');
    expect(sess!.windowId).toBe(windowId);
    expect(sess!.seated.map((m) => m.name)).toEqual(['alice']);
    expect(sess!.waitlisted.map((m) => m.name)).toEqual(['bob']);
    expect(sess!.freeSeats).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration -- src/lib/roster.integration.test.ts`
Expected: FAIL — `./roster` does not exist.

- [ ] **Step 3: Implement `src/lib/roster.ts`**

```ts
import { and, eq, inArray } from 'drizzle-orm';

import type { DB } from '@/db';
import { bookings, user } from '@/db/schema';

import { computeCalendar } from './calendar';

const ACTIVE = ['booked', 'waitlisted'] as const;

export type RosterMember = { bookingId: string; name: string; paymentType: 'regular' | 'multisport'; queuePosition: number | null };
export type RosterSession = {
  sessionId: string | null;
  windowId: string | null;
  startAt: Date;
  endAt: Date;
  boatTypeId: string;
  boatName: string;
  capacity: number;
  status: 'open' | 'closed' | 'cancelled';
  seated: RosterMember[];
  waitlisted: RosterMember[];
  freeSeats: number;
};
export type RosterDay = { dateISO: string; closed: boolean; sessions: RosterSession[] };

/** Owner-facing: the day's sessions (persisted + virtual), each with its booking roster. */
export async function getDayRoster(db: DB, { clubId, dateISO }: { clubId: string; dateISO: string }): Promise<RosterDay> {
  const [day] = await computeCalendar(db, clubId, { fromDateISO: dateISO, days: 1 });

  const sessionIds: string[] = [];
  for (const slot of day.slots) for (const s of slot.sessions) if (s.sessionId) sessionIds.push(s.sessionId);

  const rows = sessionIds.length
    ? await db
        .select({ bookingId: bookings.id, sessionId: bookings.sessionId, status: bookings.status, paymentType: bookings.paymentType, queuePosition: bookings.queuePosition, effectiveAt: bookings.effectiveAt, name: user.name })
        .from(bookings)
        .innerJoin(user, eq(user.id, bookings.userId))
        .where(and(inArray(bookings.sessionId, sessionIds), inArray(bookings.status, [...ACTIVE])))
    : [];

  const bySession = new Map<string, { seated: RosterMember[]; waitlisted: RosterMember[] }>();
  const ordered = [...rows].sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
  for (const r of ordered) {
    const bucket = bySession.get(r.sessionId) ?? { seated: [], waitlisted: [] };
    const member: RosterMember = { bookingId: r.bookingId, name: r.name, paymentType: r.paymentType, queuePosition: r.queuePosition };
    if (r.status === 'booked') bucket.seated.push(member);
    else bucket.waitlisted.push(member);
    bySession.set(r.sessionId, bucket);
  }
  for (const bucket of bySession.values()) bucket.waitlisted.sort((x, y) => (x.queuePosition ?? 0) - (y.queuePosition ?? 0));

  const sessions: RosterSession[] = [];
  for (const slot of day.slots) {
    for (const s of slot.sessions) {
      const roster = (s.sessionId ? bySession.get(s.sessionId) : undefined) ?? { seated: [], waitlisted: [] };
      sessions.push({
        sessionId: s.sessionId,
        windowId: slot.windowId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        boatTypeId: s.boatTypeId,
        boatName: s.boatName,
        capacity: s.capacity,
        status: s.status,
        seated: roster.seated,
        waitlisted: roster.waitlisted,
        freeSeats: Math.max(0, s.capacity - roster.seated.length),
      });
    }
  }
  return { dateISO: day.dateISO, closed: day.closed, sessions };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:integration -- src/lib/roster.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck & commit**

Run: `pnpm exec tsc --noEmit` → exit 0.

```bash
git add src/lib/roster.ts src/lib/roster.integration.test.ts
git commit -m "feat(roster): owner day-roster read model (sessions + booking rosters)"
```

---

### Task 7: Owner add/remove booking + shared seating helper

Two owner-scoped booking operations, plus a `applySeating` helper extracted from `cancelBooking` (its second caller now exists).

**Files:**
- Modify: `src/lib/booking.ts` (add `applySeating`; refactor `cancelBooking` to use it; add `ownerRemoveBooking`, `ownerAddBooking` + their types)
- Test: `src/lib/booking.integration.test.ts` (add 4 tests)

**Interfaces:**
- Consumes: `resolveSeating` (Task 1); `findOrCreateSlotTx`, `MaterializeBoat` (already imported in `booking.ts`); `CancelResult` (Task 2).
- Produces:
  ```ts
  export type OwnerRemoveResult = { ok: true; promoted?: { userId: string; sessionId: string } } | { ok: false; error: 'not_found' | 'not_active' };
  export function ownerRemoveBooking(db: DB, input: { clubId: string; bookingId: string }): Promise<OwnerRemoveResult>;
  export type OwnerAddInput = { clubId: string; windowId: string; boatTypeId: string; startAt: Date; userId: string; paymentType: 'regular' | 'multisport'; now?: Date };
  export type OwnerAddResult = { ok: true; bookingId: string } | { ok: false; error: 'no_session' | 'not_a_member' | 'already_booked_this_slot' | 'session_full' };
  export function ownerAddBooking(db: DB, input: OwnerAddInput): Promise<OwnerAddResult>;
  ```

- [ ] **Step 1: Add the failing integration tests**

Add these to the `describe.skipIf(!url)('bookSeat / cancelBooking', ...)` block in `src/lib/booking.integration.test.ts`, and extend its booking import to `import { bookSeat, cancelBooking, ownerAddBooking, ownerRemoveBooking } from './booking';`:

```ts
  it('owner removes a booking even past the self-cancel cutoff, and promotes the waitlist', async () => {
    const s = await scenario({ seats: 1, cutoffHours: 9999 });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    const common = { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular' as const };
    const r1 = await bookSeat(db, { ...common, userId: u1, idempotencyKey: key() });
    await bookSeat(db, { ...common, userId: u2, idempotencyKey: key() });
    if (!r1.ok) throw new Error('setup');
    const selfBlocked = await cancelBooking(db, { clubId: s.club.id, userId: u1, bookingId: r1.bookingId });
    expect(selfBlocked).toEqual({ ok: false, error: 'cutoff_passed' });
    const removed = await ownerRemoveBooking(db, { clubId: s.club.id, bookingId: r1.bookingId });
    expect(removed).toMatchObject({ ok: true, promoted: { userId: u2 } });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.clubId, s.club.id));
    expect(rows.find((r) => r.userId === u2)!.status).toBe('booked');
  });

  it('owner seats a member into a free seat, tagged source=owner', async () => {
    const s = await scenario({ seats: 2, allowedPayment: 'both' });
    const u1 = await newMember(s.club.id, 'u1');
    const res = await ownerAddBooking(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u1, paymentType: 'regular' });
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) throw new Error('add failed');
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, res.bookingId));
    expect(row.status).toBe('booked');
    expect(row.source).toBe('owner');
  });

  it('owner-add rejects a full session', async () => {
    const s = await scenario({ seats: 1, allowedPayment: 'both' });
    const u1 = await newMember(s.club.id, 'u1');
    const u2 = await newMember(s.club.id, 'u2');
    await ownerAddBooking(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u1, paymentType: 'regular' });
    const res = await ownerAddBooking(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: u2, paymentType: 'regular' });
    expect(res).toEqual({ ok: false, error: 'session_full' });
  });

  it('owner-add rejects a non-approved member', async () => {
    const s = await scenario({ seats: 2, allowedPayment: 'both' });
    const pend = await newMember(s.club.id, 'p', null, 'pending');
    const res = await ownerAddBooking(db, { clubId: s.club.id, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, userId: pend, paymentType: 'regular' });
    expect(res).toEqual({ ok: false, error: 'not_a_member' });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:integration -- src/lib/booking.integration.test.ts`
Expected: the four new tests FAIL — `ownerRemoveBooking`/`ownerAddBooking` are not exported.

- [ ] **Step 3: Add the `applySeating` helper and refactor `cancelBooking`**

Near the top of `src/lib/booking.ts`, after the `ACTIVE` constant, add a transaction type alias and the helper:

```ts
type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Recompute a session's sticky seating after a mutation and return the user (if
 * any) promoted from waitlisted -> booked into a freed seat. Caller must hold the
 * per-slot advisory lock.
 */
async function applySeating(tx: Tx, sessionId: string, capacity: number, mode: 'equal' | 'priority'): Promise<{ promotedUserId: string | null }> {
  const active = await tx.select({ id: bookings.id, userId: bookings.userId, status: bookings.status, paymentType: bookings.paymentType, effectiveAt: bookings.effectiveAt }).from(bookings).where(and(eq(bookings.sessionId, sessionId), inArray(bookings.status, [...ACTIVE])));
  const prevStatus = new Map(active.map((a) => [a.id, a.status]));
  const assignments = resolveSeating(active.map((a) => ({ id: a.id, status: a.status as 'booked' | 'waitlisted', paymentType: a.paymentType, effectiveAt: a.effectiveAt })), capacity, mode);
  for (const a of assignments) await tx.update(bookings).set({ status: a.status, queuePosition: a.queuePosition }).where(eq(bookings.id, a.id));
  const promoted = assignments.find((a) => a.status === 'booked' && prevStatus.get(a.id) === 'waitlisted');
  return { promotedUserId: promoted ? (active.find((a) => a.id === promoted.id)?.userId ?? null) : null };
}
```

In Task 2's `cancelBooking`, keep the `await tx.update(... status: 'cancelled' ...)` line, then replace everything after it (the inline `const active = ...` recompute through the final `return`) with:

```ts
    const { promotedUserId } = await applySeating(tx, row.sessionId, row.capacity, row.multisportMode);
    return promotedUserId ? { ok: true, promoted: { userId: promotedUserId, sessionId: row.sessionId } } : { ok: true };
```

- [ ] **Step 4: Add `ownerRemoveBooking`**

Append to `src/lib/booking.ts`:

```ts
export type OwnerRemoveResult =
  | { ok: true; promoted?: { userId: string; sessionId: string } }
  | { ok: false; error: 'not_found' | 'not_active' };

/** Owner force-removes any booking in their club, bypassing self-cancel/cutoff gates. */
export async function ownerRemoveBooking(db: DB, input: { clubId: string; bookingId: string }): Promise<OwnerRemoveResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ clubId: bookings.clubId, status: bookings.status, sessionId: bookings.sessionId, capacity: sessions.capacity, slotStartAt: slots.startAt, multisportMode: clubs.multisportMode })
      .from(bookings)
      .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
      .innerJoin(slots, eq(slots.id, sessions.slotId))
      .innerJoin(clubs, eq(clubs.id, bookings.clubId))
      .where(eq(bookings.id, input.bookingId));
    if (!row || row.clubId !== input.clubId) return { ok: false, error: 'not_found' };
    if (!(ACTIVE as readonly string[]).includes(row.status)) return { ok: false, error: 'not_active' };

    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.clubId}), hashtext(${row.slotStartAt.toISOString()}))`);
    await tx.update(bookings).set({ status: 'cancelled', queuePosition: null }).where(eq(bookings.id, input.bookingId));
    const { promotedUserId } = await applySeating(tx, row.sessionId, row.capacity, row.multisportMode);
    return promotedUserId ? { ok: true, promoted: { userId: promotedUserId, sessionId: row.sessionId } } : { ok: true };
  });
}
```

- [ ] **Step 5: Add `ownerAddBooking`**

Append to `src/lib/booking.ts`:

```ts
export type OwnerAddInput = { clubId: string; windowId: string; boatTypeId: string; startAt: Date; userId: string; paymentType: 'regular' | 'multisport'; now?: Date };
export type OwnerAddResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: 'no_session' | 'not_a_member' | 'already_booked_this_slot' | 'session_full' };

/**
 * Owner seats a member into a free seat of a block. Override: skips skill/payment
 * eligibility, but requires an approved, non-banned member; empty-seat-only.
 */
export async function ownerAddBooking(db: DB, input: OwnerAddInput): Promise<OwnerAddResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [club] = await tx.select({ timezone: clubs.timezone, multisportMode: clubs.multisportMode }).from(clubs).where(eq(clubs.id, input.clubId));
    if (!club) return { ok: false, error: 'no_session' };
    const [win] = await tx.select().from(scheduleWindows).where(and(eq(scheduleWindows.id, input.windowId), eq(scheduleWindows.clubId, input.clubId)));
    if (!win) return { ok: false, error: 'no_session' };

    const wbRows = await tx
      .select({ boatTypeId: windowBoats.boatTypeId, quantity: windowBoats.quantity, capacity: boatTypes.seats, minAttendance: boatTypes.minAttendance })
      .from(windowBoats)
      .innerJoin(boatTypes, eq(boatTypes.id, windowBoats.boatTypeId))
      .where(and(eq(windowBoats.windowId, input.windowId), eq(boatTypes.active, true)));
    const chosen = wbRows.find((b) => b.boatTypeId === input.boatTypeId);
    if (!chosen) return { ok: false, error: 'no_session' };
    const boatsSpec: MaterializeBoat[] = wbRows.map((b) => ({ boatTypeId: b.boatTypeId, capacity: b.capacity, minAttendance: b.minAttendance, quantity: b.quantity }));

    // Validate startAt is a real block of this window on its club-local date.
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

    // Owner override: require an approved, non-banned member (skip skill/payment eligibility).
    const [member] = await tx.select({ status: memberships.status, bannedUntil: memberships.bannedUntil }).from(memberships).where(and(eq(memberships.userId, input.userId), eq(memberships.clubId, input.clubId)));
    if (!member || member.status !== 'approved' || (member.bannedUntil != null && member.bannedUntil.getTime() > now.getTime())) return { ok: false, error: 'not_a_member' };

    const foc = await findOrCreateSlotTx(tx, { clubId: input.clubId, dateISO, startAt: input.startAt, endAt, windowId: input.windowId, boats: boatsSpec });

    // One booking per slot.
    const slotSessionIds = foc.sessions.map((s) => s.id);
    if (slotSessionIds.length) {
      const [existingActive] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.userId, input.userId), inArray(bookings.sessionId, slotSessionIds), inArray(bookings.status, [...ACTIVE])));
      if (existingActive) return { ok: false, error: 'already_booked_this_slot' };
    }

    // Target the chosen boat's session that has a free seat (empty-seat-only).
    const boatSessions = foc.sessions.filter((s) => s.boatTypeId === input.boatTypeId).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (boatSessions.length === 0) return { ok: false, error: 'no_session' };
    const activeRows = await tx.select({ sessionId: bookings.sessionId }).from(bookings).where(and(inArray(bookings.sessionId, boatSessions.map((s) => s.id)), inArray(bookings.status, [...ACTIVE])));
    const activeCount = new Map<string, number>();
    for (const r of activeRows) activeCount.set(r.sessionId, (activeCount.get(r.sessionId) ?? 0) + 1);
    const target = boatSessions.find((s) => (activeCount.get(s.id) ?? 0) < s.capacity);
    if (!target) return { ok: false, error: 'session_full' };

    const [inserted] = await tx.insert(bookings).values({ sessionId: target.id, clubId: input.clubId, userId: input.userId, paymentType: input.paymentType, status: 'booked', effectiveAt: now, source: 'owner' }).returning({ id: bookings.id });
    await applySeating(tx, target.id, target.capacity, club.multisportMode);
    return { ok: true, bookingId: inserted.id };
  });
}
```

- [ ] **Step 6: Run the booking suite**

Run: `pnpm test:integration -- src/lib/booking.integration.test.ts`
Expected: all PASS — the four new tests plus every pre-existing test (including Task 2's, unchanged by the `applySeating` refactor).

- [ ] **Step 7: Typecheck, lint & commit**

Run: `pnpm exec tsc --noEmit` then `pnpm lint` → both exit 0.

```bash
git add src/lib/booking.ts src/lib/booking.integration.test.ts
git commit -m "feat(booking): owner add/remove booking with shared applySeating helper"
```

---

### Task 8: Owner-removal notification

A distinct "your booking was removed by the club" email, plus the `notify` entry point for it.

**Files:**
- Modify: `src/emails/index.ts` (add `renderOwnerRemoval`)
- Modify: `messages/tr.json`, `messages/en.json` (add `emails.booking.ownerRemoval`)
- Modify: `src/lib/notify.ts` (add `notifyOwnerRemoval`)
- Test: `src/lib/notify.integration.test.ts` (add 1 test)

**Interfaces:**
- Consumes: `BookingNoticeEmail`, `baseRows`, `renderNotice`, `loadEmailsTranslator`, `toLocale`, `BookingWhen` (Task 3); `loadCtx`, `sendEmail` (Task 4).
- Produces:
  ```ts
  export function renderOwnerRemoval(locale: string, data: BookingWhen): Promise<RenderedEmail>;
  export function notifyOwnerRemoval(db: DB, args: { bookingId: string }): Promise<void>;
  ```

- [ ] **Step 1: Add the failing test**

Add to `src/lib/notify.integration.test.ts` (extend the import to include `notifyOwnerRemoval`):

```ts
  it('owner-removal sends one email and writes NO notifications row', async () => {
    const s = await seedBooking('cancelled');
    await notifyOwnerRemoval(db, { bookingId: s.booking.id });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: s.email });
    const logs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, s.uid));
    expect(logs).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration -- src/lib/notify.integration.test.ts`
Expected: FAIL — `notifyOwnerRemoval` is not exported.

- [ ] **Step 3: Add `renderOwnerRemoval` to `src/emails/index.ts`**

Append:

```ts
export async function renderOwnerRemoval(locale: string, data: BookingWhen): Promise<RenderedEmail> {
  const validLocale = toLocale(locale);
  const t = await loadEmailsTranslator(validLocale);
  return renderNotice(validLocale, t('booking.ownerRemoval.subject'), t('booking.ownerRemoval.heading'), t('booking.ownerRemoval.intro'), baseRows(t, data, validLocale));
}
```

- [ ] **Step 4: Add the `emails.booking.ownerRemoval` keys**

In `messages/tr.json`, inside `emails.booking`, add:

```json
      "ownerRemoval": {
        "subject": "Oarly — Rezervasyonunuz kaldırıldı",
        "heading": "Rezervasyonunuz kaldırıldı",
        "intro": "Kulüp bu seanstaki rezervasyonunuzu kaldırdı. Ayrıntılar aşağıda."
      }
```

In `messages/en.json`, inside `emails.booking`, add:

```json
      "ownerRemoval": {
        "subject": "Oarly — Your booking was removed",
        "heading": "Your booking was removed",
        "intro": "The club removed your booking for this session. Details below."
      }
```

- [ ] **Step 5: Add `notifyOwnerRemoval` to `src/lib/notify.ts`**

Add `renderOwnerRemoval` to the import from `@/emails`, then append:

```ts
/** Best-effort: emails the member that the club removed their booking. Never throws. */
export async function notifyOwnerRemoval(db: DB, { bookingId }: { bookingId: string }): Promise<void> {
  try {
    const ctx = await loadCtx(db, eq(bookings.id, bookingId));
    if (!ctx) return;
    const email = await renderOwnerRemoval(ctx.locale, { clubName: ctx.clubName, boatName: ctx.boatName, startAt: ctx.startAt, endAt: ctx.endAt, timezone: ctx.timezone });
    await sendEmail({ to: ctx.toEmail, subject: email.subject, html: email.html, text: email.text });
  } catch (err) {
    console.error('notifyOwnerRemoval failed', err);
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test:integration -- src/lib/notify.integration.test.ts` then `pnpm exec vitest run src/emails/booking-emails.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck & commit**

Run: `pnpm exec tsc --noEmit` → exit 0.

```bash
git add src/emails/index.ts src/lib/notify.ts src/lib/notify.integration.test.ts messages/tr.json messages/en.json
git commit -m "feat(notify): owner-removal email notice"
```

---

### Task 9: Owner "Bookings" manage view + actions + nav

The owner UI: pick a day, see each session's roster, remove bookings, seat members into free spots. Wires the notifications.

**Files:**
- Create: `app/s/[slug]/manage/bookings/page.tsx`
- Create: `app/s/[slug]/manage/bookings/bookings-roster.tsx`
- Create: `app/s/[slug]/manage/bookings/actions.ts`
- Modify: `app/s/[slug]/manage/_nav.tsx` (add nav item)
- Modify: `messages/tr.json`, `messages/en.json` (add `manage.bookings.*`)

**Interfaces:**
- Consumes: `getDayRoster` + `RosterSession`/`RosterMember` (Task 6); `ownerAddBooking`, `ownerRemoveBooking` (Task 7); `notifyBookingConfirmation`, `notifyOwnerRemoval`, `notifyWaitlistPromotion` (Tasks 4, 8); `requireOwner`; `ManageActionResult` (`../action-result`); `addDaysISO`, `utcToClubDate` (`@/lib/date-tz`).

- [ ] **Step 1: Add the server actions**

Create `app/s/[slug]/manage/bookings/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import * as z from 'zod';

import { db } from '@/db';
import { ownerAddBooking, ownerRemoveBooking } from '@/lib/booking';
import { requireOwner } from '@/lib/membership';
import { notifyBookingConfirmation, notifyOwnerRemoval, notifyWaitlistPromotion } from '@/lib/notify';

import type { ManageActionResult } from '../action-result';

const removeSchema = z.object({ bookingId: z.uuid() });
const addSchema = z.object({
  windowId: z.uuid(),
  boatTypeId: z.uuid(),
  startAt: z.iso.datetime(),
  userId: z.string().min(1),
  paymentType: z.enum(['regular', 'multisport']),
});

export async function ownerRemoveBookingAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug, '/manage/bookings');
  const parsed = removeSchema.safeParse({ bookingId: formData.get('bookingId') });
  if (!parsed.success) return { ok: false };
  const result = await ownerRemoveBooking(db, { clubId: club.id, bookingId: parsed.data.bookingId });
  if (!result.ok) return { ok: false };
  revalidatePath(`/s/${slug}/manage/bookings`);
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);
  await notifyOwnerRemoval(db, { bookingId: parsed.data.bookingId });
  if (result.promoted) await notifyWaitlistPromotion(db, result.promoted);
  return { ok: true };
}

export async function ownerAddBookingAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug, '/manage/bookings');
  const parsed = addSchema.safeParse({
    windowId: formData.get('windowId'),
    boatTypeId: formData.get('boatTypeId'),
    startAt: formData.get('startAt'),
    userId: formData.get('userId'),
    paymentType: formData.get('paymentType'),
  });
  if (!parsed.success) return { ok: false };
  const result = await ownerAddBooking(db, { clubId: club.id, windowId: parsed.data.windowId, boatTypeId: parsed.data.boatTypeId, startAt: new Date(parsed.data.startAt), userId: parsed.data.userId, paymentType: parsed.data.paymentType });
  if (!result.ok) return { ok: false };
  revalidatePath(`/s/${slug}/manage/bookings`);
  revalidatePath(`/s/${slug}/book`);
  revalidatePath(`/s/${slug}/bookings`);
  await notifyBookingConfirmation(db, { bookingId: result.bookingId });
  return { ok: true };
}
```

- [ ] **Step 2: Add the client roster component**

Create `app/s/[slug]/manage/bookings/bookings-roster.tsx`:

```tsx
'use client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RosterSession } from '@/lib/roster';

import type { ManageActionResult } from '../action-result';
import { ownerAddBookingAction, ownerRemoveBookingAction } from './actions';

type Member = { userId: string; name: string };

export function BookingsRoster({ slug, sessions, members, timezone }: { slug: string; sessions: RosterSession[]; members: Member[]; timezone: string }) {
  const t = useTranslations('manage.bookings');
  const tm = useTranslations('manage');

  // Remove + add state live here (stable parent): a successful action revalidates
  // and can unmount the row/add-form, so a row-local toast effect would be dropped.
  const [rmState, rmAction, rmPending] = useActionState<ManageActionResult | null, FormData>(ownerRemoveBookingAction.bind(null, slug), null);
  const rmHandled = useRef<ManageActionResult | null>(null);
  useEffect(() => {
    if (rmState === null || rmState === rmHandled.current) return;
    rmHandled.current = rmState;
    if (rmState.ok) toast.success(t('removed'));
    else toast.error(tm('actionError'));
  }, [rmState, t, tm]);

  const [addState, addAction, addPending] = useActionState<ManageActionResult | null, FormData>(ownerAddBookingAction.bind(null, slug), null);
  const addHandled = useRef<ManageActionResult | null>(null);
  useEffect(() => {
    if (addState === null || addState === addHandled.current) return;
    addHandled.current = addState;
    if (addState.ok) toast.success(t('added'));
    else toast.error(tm('actionError'));
  }, [addState, t, tm]);

  if (sessions.length === 0) return <p className="text-sm text-muted-foreground">{t('empty')}</p>;

  return (
    <div className="flex flex-col gap-3">
      {sessions.map((s, i) => {
        const time = `${fmt(s.startAt, timezone)}–${fmt(s.endAt, timezone)}`;
        return (
          <Card key={s.sessionId ?? `${s.boatTypeId}-${i}`} size="sm">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-heading text-sm font-semibold">{s.boatName} · {time}</span>
                <span className="text-xs text-muted-foreground">{s.seated.length}/{s.capacity}</span>
              </div>

              {s.seated.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {s.seated.map((m) => (
                    <li key={m.bookingId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{m.name}</span>
                      <form action={rmAction} className="shrink-0">
                        <input type="hidden" name="bookingId" value={m.bookingId} />
                        <Button type="submit" size="sm" variant="ghost" disabled={rmPending}>{t('remove')}</Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              {s.waitlisted.length > 0 && (
                <ul className="flex flex-col gap-1 border-t pt-2">
                  {s.waitlisted.map((m) => (
                    <li key={m.bookingId} className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                      <span className="min-w-0 truncate">{t('waitPosition', { n: m.queuePosition ?? 0 })} · {m.name}</span>
                      <form action={rmAction} className="shrink-0">
                        <input type="hidden" name="bookingId" value={m.bookingId} />
                        <Button type="submit" size="sm" variant="ghost" disabled={rmPending}>{t('remove')}</Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              {s.freeSeats > 0 && s.windowId && (
                <AddMemberForm session={s} members={members} addAction={addAction} addPending={addPending} />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AddMemberForm({ session, members, addAction, addPending }: {
  session: RosterSession; members: Member[]; addAction: (fd: FormData) => void; addPending: boolean;
}) {
  const t = useTranslations('manage.bookings');
  const [userId, setUserId] = useState('');
  const [payment, setPayment] = useState<'regular' | 'multisport'>('regular');

  return (
    <form action={addAction} className="flex flex-wrap items-center gap-2 border-t pt-2">
      <input type="hidden" name="windowId" value={session.windowId ?? ''} />
      <input type="hidden" name="boatTypeId" value={session.boatTypeId} />
      <input type="hidden" name="startAt" value={session.startAt.toISOString()} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="paymentType" value={payment} />
      <Select value={userId || undefined} onValueChange={setUserId}>
        <SelectTrigger className="min-w-40 flex-1"><SelectValue placeholder={t('selectMember')} /></SelectTrigger>
        <SelectContent>
          {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={payment} onValueChange={(v) => setPayment(v as 'regular' | 'multisport')}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="regular">{t('paymentRegular')}</SelectItem>
          <SelectItem value="multisport">{t('paymentMultisport')}</SelectItem>
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" disabled={addPending || !userId}>{t('add')}</Button>
    </form>
  );
}

// startAt/endAt are UTC instants; render the wall-clock in the club timezone.
const fmt = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
```

- [ ] **Step 3: Add the page**

Create `app/s/[slug]/manage/bookings/page.tsx`:

```tsx
import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { memberships, user } from '@/db/schema';
import { addDaysISO, utcToClubDate } from '@/lib/date-tz';
import { requireOwner } from '@/lib/membership';
import { getDayRoster } from '@/lib/roster';

import { BookingsRoster } from './bookings-roster';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export default async function ManageBookingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/bookings');
  const t = await getTranslations('manage.bookings');
  const sp = await searchParams;

  const today = utcToClubDate(new Date(), club.timezone).dateISO;
  const dateISO = sp.date && dateRe.test(sp.date) ? sp.date : today;

  const roster = await getDayRoster(db, { clubId: club.id, dateISO });
  const memberRows = await db
    .select({ userId: memberships.userId, name: user.name, status: memberships.status, bannedUntil: memberships.bannedUntil })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(memberships.clubId, club.id), eq(memberships.status, 'approved')));
  const now = Date.now();
  const members = memberRows
    .filter((m) => m.bannedUntil == null || m.bannedUntil.getTime() <= now)
    .map((m) => ({ userId: m.userId, name: m.name }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Link className={buttonVariants({ size: 'sm', variant: 'ghost' })} href={`/manage/bookings?date=${addDaysISO(dateISO, -1)}`}>{t('prevDay')}</Link>
        <span className="font-heading text-sm font-semibold">{dateISO}</span>
        <Link className={buttonVariants({ size: 'sm', variant: 'ghost' })} href={`/manage/bookings?date=${addDaysISO(dateISO, 1)}`}>{t('nextDay')}</Link>
      </div>
      {roster.closed ? (
        <p className="text-sm text-muted-foreground">{t('closed')}</p>
      ) : (
        <BookingsRoster slug={slug} sessions={roster.sessions} members={members} timezone={club.timezone} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the nav item**

In `app/s/[slug]/manage/_nav.tsx`, add to the `items` array (after `members`):

```ts
  { href: '/bookings', key: 'bookings' },
```

The existing label logic resolves this via `t('bookings.navLabel')` (the `${it.key}.navLabel` branch), so add that key in Step 5.

- [ ] **Step 5: Add the `manage.bookings.*` keys**

In `messages/tr.json`, add inside the `manage` object:

```json
    "bookings": {
      "navLabel": "Rezervasyonlar",
      "empty": "Bu gün için seans yok.",
      "closed": "Kulüp bu gün kapalı.",
      "prevDay": "Önceki gün",
      "nextDay": "Sonraki gün",
      "remove": "Çıkar",
      "add": "Ekle",
      "selectMember": "Üye seçin",
      "paymentRegular": "Normal",
      "paymentMultisport": "MultiSport",
      "waitPosition": "#{n}",
      "removed": "Rezervasyon kaldırıldı.",
      "added": "Üye eklendi."
    }
```

In `messages/en.json`, add inside the `manage` object:

```json
    "bookings": {
      "navLabel": "Bookings",
      "empty": "No sessions this day.",
      "closed": "The club is closed this day.",
      "prevDay": "Previous day",
      "nextDay": "Next day",
      "remove": "Remove",
      "add": "Add",
      "selectMember": "Select member",
      "paymentRegular": "Regular",
      "paymentMultisport": "MultiSport",
      "waitPosition": "#{n}",
      "removed": "Booking removed.",
      "added": "Member added."
    }
```

- [ ] **Step 6: Typecheck, lint & build**

Run: `pnpm exec tsc --noEmit` then `pnpm lint` then `pnpm build` → all exit 0; the new `/s/[slug]/manage/bookings` route compiles.

- [ ] **Step 7: Manual verification note**

With a dev server (Resend unset → `[email:dev]` log lines): open `/manage/bookings` as an owner → the day's sessions render with rosters. Remove a seated member while someone is waitlisted → the row goes, a promotion happens, and two `[email:dev]` lines appear (owner-removal to the removed member, promotion to the promoted member). Seat a member into a free spot → they appear seated and a confirmation `[email:dev]` line appears. Prev/next day changes the day.

- [ ] **Step 8: Commit**

```bash
git add "app/s/[slug]/manage/bookings/" "app/s/[slug]/manage/_nav.tsx" messages/tr.json messages/en.json
git commit -m "feat(manage): owner Bookings view — roster, remove, and seat a member"
```

---

## Final verification (run before finishing the branch)

- [ ] `pnpm lint` → 0 warnings.
- [ ] `pnpm test` → all unit suites green (includes `seating.test.ts`, `booking-emails.test.ts`).
- [ ] `pnpm test:integration` → all integration suites green (includes `booking.integration.test.ts`, `notify.integration.test.ts`, `roster.integration.test.ts`, and the pre-existing eligibility/calendar suites). Requires the test Postgres to be up — a skipped suite is NOT a pass.
- [ ] `pnpm exec tsc --noEmit` → exit 0.
- [ ] `pnpm build` → clean.

## Notes / follow-ups (out of scope — do not implement)

- In-app notification feed (needs `notifications` schema changes + UI).
- `reminder` emails (needs cron/scheduled infrastructure).
- `.ics` attachment / Google Calendar API sync.
- `displaced` email — eliminated by the sticky-seating fix.
- Send retry / transactional outbox for failed emails (current sends are best-effort).
- Per-club "from" address (single global `EMAIL_FROM`).
- Per-session capacity-decrease demotion edge (per-session overrides out of scope; `resolveSeating` tolerates `booked > capacity` by leaving all seated).
