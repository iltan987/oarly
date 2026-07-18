# Member Booking UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the member-facing Book and My Bookings screens to the designer's "Oarly Booking Flow" spec — a token-skin system with state-driven session cards, tone-paired status pills, seat pips, and tinted action buttons — as a responsive web layout, keeping the existing inline-booking flow.

**Architecture:** Extend the design-token layer in `app/globals.css` additively (reuse the existing per-club accent tokens for the "accent" role; map "neutral" onto the existing `muted` tokens; add only the fixed semantic tones `ok/warn/bad/info`, `surface-2`, and the design radii). Build a token-based `StatusPill`, a responsive member header, and restyle the two client components. This is a visual restyle of the current structure (14-day vertical day list, inline booking, stacked Upcoming/Past) — NOT a flow change.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind 4 (CSS-first, tokens in `app/globals.css`), next-intl, shadcn/ui (`Card`, `Button`), sonner, lucide-react, Vitest + @testing-library/react.

## Global Constraints

- **Commits:** never add a `Co-Authored-By` or any AI-attribution trailer.
- **shadcn `src/components/ui/`:** CLI-add only. Never hand-author or edit files in that folder — in particular, do NOT add variants to `ui/button.tsx`; apply tinted button styles via `className` overrides on `Button`. Custom components go in `src/components/` (not `ui/`).
- **Additive tokens:** the new semantic tokens must not change the neutral/brand palette used by the rest of the app. Only ADD `--ok/--warn/--bad/--info` (+ `-bg`), `--surface-2`, and `--radius-card/pill/field`. Do NOT edit existing `--background/--card/--foreground/--muted/--border/--club-accent/--brand-*` values.
- **Accent = existing brand tokens.** The design's "accent" role maps to `--club-accent` (utility `brand`), "accent-tint" to `--brand-tint` (`brand-tint`), "accent-ink" to `--primary-foreground`. The design's "neutral" tone maps to `text-muted-foreground` on `bg-muted`. Do not introduce parallel accent/neutral tokens.
- **Design values (from the "Oarly Booking Flow" brief):** semantic hexes below are exact from the design. Radii: card 18px, pill 999px, field 13px. Pills are `font-heading` (Space Grotesk) bold. Cards are flat/border-defined (no drop shadows).
- **i18n:** every user-visible string comes from `messages/en.json` + `messages/tr.json` under the `booking` namespace; every new key goes in BOTH files with the same key path.
- **Tenant client links:** client `<Link href>` MUST use public paths `/book` and `/bookings` (slug is in the hostname — see `proxy.ts`). NEVER `/s/${slug}/...`. This plan removes the existing `/s/${slug}/...` links.
- **Toasts:** `<Toaster />` is already mounted in `app/layout.tsx`. Fire feedback with `import { toast } from 'sonner'`. Do NOT mount another Toaster.
- **Server-side zod validation stays authoritative.**
- **Test locations:** Vitest only includes `src/**/*.test.ts(x)`. Tests MUST live under `src/`. Component render tests need `// @vitest-environment jsdom` as the first line (default env is `node`).

### Design token reference (used across Tasks 1–7)

Semantic tone → Tailwind utility pair used by pills/buttons/chips:

| Tone | Text util | Fill util | Meaning |
|---|---|---|---|
| ok | `text-ok` | `bg-ok-bg` | seats available |
| warn | `text-warn` | `bg-warn-bg` | full / waitlisted |
| bad | `text-bad` | `bg-bad-bg` | cancelled / no-show |
| info | `text-info` | `bg-info-bg` | not open yet / MultiSport chip |
| neutral | `text-muted-foreground` | `bg-muted` | locked / closed |
| accent | `text-brand` | `bg-brand-tint` | you're booked |

Radii utilities (after Task 1): `rounded-card` (18px), `rounded-pill` (999px), `rounded-field` (13px). Inset fill: `bg-surface-2`.

Session UI-state map (Book screen), derived from `MemberVirtualSession`:

| UI state | Condition | Pill tone | Action control |
|---|---|---|---|
| booked | `myStatus==='booked'` | accent | none (pill only) |
| waitlisted | `myStatus==='waitlisted'` | warn | none (pill only) |
| ineligible | `!eligibility.ok` | neutral | lock icon + "Locked" |
| notopen | `!bookingOpen` | info | none; seat text = "Opens {date}" |
| full | `seatsLeft<=0` | neutral | Join waitlist (warn-tint) |
| open | else | ok | Book (solid accent) |

---

### Task 1: Design tokens (semantic tones + radii)

**Files:**
- Modify: `app/globals.css` (add to `:root`, `.dark`, and `@theme inline`)

**Interfaces:**
- Produces: Tailwind utilities `text-ok`/`bg-ok-bg`, `text-warn`/`bg-warn-bg`, `text-bad`/`bg-bad-bg`, `text-info`/`bg-info-bg`, `bg-surface-2`, and `rounded-card`/`rounded-pill`/`rounded-field`. Consumed by Tasks 2, 5, 6, 7.

- [ ] **Step 1: Add the tokens to `:root`**

In `app/globals.css`, immediately after the `--brand-ink: ...;` line inside `:root` (currently line 32), add:

```css

  /* Design-system semantic tones — fixed per theme, independent of the club accent. */
  --ok: #15803d;
  --ok-bg: #e5f6eb;
  --warn: #b45309;
  --warn-bg: #fbeedc;
  --bad: #b91c1c;
  --bad-bg: #fbebeb;
  --info: #1d4ed8;
  --info-bg: #e6eefd;
  --surface-2: #f3f7f9;

  --r-card: 18px;
  --r-pill: 999px;
  --r-field: 13px;
```

- [ ] **Step 2: Add the dark-theme tones to `.dark`**

Immediately after the `--brand-ink: ...;` line inside `.dark` (currently line 57), add:

```css

  --ok: #4ade80;
  --ok-bg: #12291c;
  --warn: #fbbf24;
  --warn-bg: #2e2410;
  --bad: #f87171;
  --bad-bg: #2e1616;
  --info: #60a5fa;
  --info-bg: #122238;
  --surface-2: #0f1b25;
```

- [ ] **Step 3: Expose the tokens as Tailwind utilities**

In the `@theme inline` block, immediately after the `--color-brand-ink: var(--brand-ink);` line (currently line 84), add:

```css

  --color-ok: var(--ok);
  --color-ok-bg: var(--ok-bg);
  --color-warn: var(--warn);
  --color-warn-bg: var(--warn-bg);
  --color-bad: var(--bad);
  --color-bad-bg: var(--bad-bg);
  --color-info: var(--info);
  --color-info-bg: var(--info-bg);
  --color-surface-2: var(--surface-2);

  --radius-card: var(--r-card);
  --radius-pill: var(--r-pill);
  --radius-field: var(--r-field);
```

- [ ] **Step 4: Verify the build picks up the utilities**

Run: `pnpm build`
Expected: clean build (Tailwind compiles the new `--color-*` / `--radius-*` into utilities). If the build fails, the CSS is malformed — fix before continuing.

- [ ] **Step 5: Lint + commit**

Run: `pnpm lint`
Expected: 0 warnings/errors.

```bash
git add app/globals.css
git commit -m "feat(design): add semantic tone tokens and booking-flow radii"
```

---

### Task 2: StatusPill component

**Files:**
- Create: `src/components/booking-status-badge.tsx`
- Test: `src/components/booking-status-badge.test.tsx`

**Interfaces:**
- Consumes: token utilities from Task 1; `cn` from `@/lib/utils`.
- Produces:
  - `type BadgeTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent'`
  - `type BookingStatus = 'booked' | 'waitlisted' | 'cancelled' | 'no_show' | 'attended'`
  - `toneByStatus: Record<BookingStatus, BadgeTone>` (used by My Bookings)
  - `StatusPill({ tone, className?, children }: { tone: BadgeTone; className?: string; children: React.ReactNode })`

- [ ] **Step 1: Write the failing test**

Create `src/components/booking-status-badge.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusPill, toneByStatus } from '@/components/booking-status-badge';

describe('StatusPill', () => {
  it('maps each booking status to its intended tone', () => {
    expect(toneByStatus).toEqual({
      booked: 'accent',
      waitlisted: 'warn',
      attended: 'ok',
      no_show: 'bad',
      cancelled: 'neutral',
    });
  });

  it('renders the label with the tone classes for the given tone', () => {
    render(<StatusPill tone="warn">Waitlisted</StatusPill>);
    const el = screen.getByText('Waitlisted');
    expect(el.className).toContain('bg-warn-bg');
    expect(el.className).toContain('text-warn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/booking-status-badge.test.tsx`
Expected: FAIL — `Cannot find module '@/components/booking-status-badge'`.

- [ ] **Step 3: Write the component**

Create `src/components/booking-status-badge.tsx`:

```tsx
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type BadgeTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent';
export type BookingStatus = 'booked' | 'waitlisted' | 'cancelled' | 'no_show' | 'attended';

const toneClass: Record<BadgeTone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  info: 'bg-info-bg text-info',
  neutral: 'bg-muted text-muted-foreground',
  accent: 'bg-brand-tint text-brand',
};

export const toneByStatus: Record<BookingStatus, BadgeTone> = {
  booked: 'accent',
  waitlisted: 'warn',
  attended: 'ok',
  no_show: 'bad',
  cancelled: 'neutral',
};

export function StatusPill({
  tone,
  className,
  children,
}: {
  tone: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn('inline-flex items-center rounded-pill px-2.5 py-1 font-heading text-xs font-bold whitespace-nowrap', toneClass[tone], className)}>
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/booking-status-badge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint + commit**

Run: `pnpm lint`
Expected: 0 warnings/errors.

```bash
git add src/components/booking-status-badge.tsx src/components/booking-status-badge.test.tsx
git commit -m "feat(booking): add tone-paired StatusPill component"
```

---

### Task 3: Surface when booking opens (`bookingOpensAt`)

**Files:**
- Modify: `src/lib/calendar-rules.ts`
- Modify: `src/lib/member-calendar.ts:7` (import), `:18-26` (type), `:79-88` (populate)
- Test: `src/lib/calendar-rules.test.ts`

**Interfaces:**
- Produces: `bookingOpensAt(input: { startAt: Date; bookingOpenMode: 'always' | 'lead'; bookingOpenLeadDays: number | null }): Date | null`; new field `bookingOpensAt: Date | null` on `MemberVirtualSession` (read by Task 5).

- [ ] **Step 1: Write the failing test**

Append to `src/lib/calendar-rules.test.ts` (and add `bookingOpensAt` to the existing import from `'./calendar-rules'`):

```ts
describe('bookingOpensAt', () => {
  it('returns null when the club is always open', () => {
    expect(bookingOpensAt({ startAt: new Date('2026-08-01T06:00:00Z'), bookingOpenMode: 'always', bookingOpenLeadDays: null })).toBeNull();
  });

  it('returns null in lead mode when lead days is missing', () => {
    expect(bookingOpensAt({ startAt: new Date('2026-08-01T06:00:00Z'), bookingOpenMode: 'lead', bookingOpenLeadDays: null })).toBeNull();
  });

  it('returns startAt minus the lead days in lead mode', () => {
    expect(bookingOpensAt({ startAt: new Date('2026-08-01T06:00:00Z'), bookingOpenMode: 'lead', bookingOpenLeadDays: 2 })).toEqual(new Date('2026-07-30T06:00:00Z'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/calendar-rules.test.ts`
Expected: FAIL — `bookingOpensAt is not a function` / import error.

- [ ] **Step 3: Implement the helper**

Append to `src/lib/calendar-rules.ts` (after `isBookingOpen`; reuse the module-level `DAY_MS`):

```ts
/**
 * The instant a session's booking window opens, or null when it is not lead-gated
 * (always-open clubs, or lead mode without a configured lead — mirrors isBookingOpen's
 * guards). Used to tell the member "Opens {date}" instead of a bare dash.
 */
export function bookingOpensAt(input: {
  startAt: Date;
  bookingOpenMode: 'always' | 'lead';
  bookingOpenLeadDays: number | null;
}): Date | null {
  const { startAt, bookingOpenMode, bookingOpenLeadDays } = input;
  if (bookingOpenMode === 'always') return null;
  if (bookingOpenLeadDays == null) return null;
  return new Date(startAt.getTime() - bookingOpenLeadDays * DAY_MS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/calendar-rules.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Expose it on the member session**

In `src/lib/member-calendar.ts`, change the import on line 7 to:

```ts
import { bookingOpensAt, isBookingOpen } from './calendar-rules';
```

Add the field to `MemberVirtualSession` (after `myQueuePosition: number | null;`, currently line 25):

```ts
  myQueuePosition: number | null;
  bookingOpensAt: Date | null;
```

Populate it in the session map, right after the `bookingOpen: isBookingOpen({ ... }),` line (currently line 82):

```ts
          bookingOpensAt: bookingOpensAt({ startAt: slot.startAt, bookingOpenMode: club.bookingOpenMode, bookingOpenLeadDays: club.bookingOpenLeadDays }),
```

- [ ] **Step 6: Verify types + lint**

Run: `pnpm test src/lib/calendar-rules.test.ts src/lib/member-calendar.integration.test.ts`
Expected: calendar-rules PASS; member-calendar integration PASS or SKIP (no `TEST_DATABASE_URL`), never a type error.

Run: `pnpm lint`
Expected: 0 warnings/errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/calendar-rules.ts src/lib/calendar-rules.test.ts src/lib/member-calendar.ts
git commit -m "feat(booking): expose bookingOpensAt on member calendar sessions"
```

---

### Task 4: Responsive member header

**Files:**
- Create: `src/components/member-header.tsx`

**Interfaces:**
- Consumes: `getTranslations`, existing `SignOutButton`, `ThemeToggle`, `booking` keys `book` + `myBookings`.
- Produces: `MemberHeader({ active, club }: { active: 'book' | 'bookings'; club: { name: string; logoUrl: string | null } })` — async server component. Rendered by Tasks 5 and 6.

- [ ] **Step 1: Write the component**

Create `src/components/member-header.tsx`:

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';

// Public tenant paths (slug is in the hostname — see proxy.ts). Never /s/{slug}/...
const tabs = [
  { key: 'book', href: '/book', labelKey: 'book' },
  { key: 'bookings', href: '/bookings', labelKey: 'myBookings' },
] as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export async function MemberHeader({
  active,
  club,
}: {
  active: 'book' | 'bookings';
  club: { name: string; logoUrl: string | null };
}) {
  const t = await getTranslations('booking');
  return (
    <header className="mb-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          {club.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={club.logoUrl} alt="" className="size-8 shrink-0 rounded-field object-cover" />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-field bg-brand font-heading text-xs font-bold text-primary-foreground">
              {initials(club.name)}
            </span>
          )}
          <span className="truncate font-heading text-lg font-semibold text-brand">{club.name}</span>
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>
      <nav className="flex flex-wrap gap-1 border-b">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={`border-b-2 px-3 py-2 text-sm ${
                isActive
                  ? 'border-brand font-medium text-brand'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(tab.labelKey)}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: Lint + commit**

Run: `pnpm lint`
Expected: 0 warnings/errors (the `<img>` inline-disable matches `app/s/[slug]/page.tsx`).

```bash
git add src/components/member-header.tsx
git commit -m "feat(booking): add responsive member header with club identity and nav"
```

> No unit test: presentational server chrome with a single `active` branch; exercised by the route builds in Tasks 5/6 and validated by review.

---

### Task 5: Restyle the Book screen

**Files:**
- Modify: `app/s/[slug]/book/actions.ts:9,42` (add `outcome`)
- Modify: `app/s/[slug]/book/page.tsx` (header + container)
- Modify: `app/s/[slug]/book/book-calendar.tsx` (full rewrite — state-driven cards)
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `MemberHeader` (Task 4), `StatusPill` + `BadgeTone` (Task 2), `session.bookingOpensAt` (Task 3), `Card`/`CardHeader`/`CardTitle`/`CardContent`, `toast` from `sonner`, `Lock` from `lucide-react`, `cn`.
- Produces: `type BookFormState = { status: 'idle' | 'ok' | 'error'; error: string | null; outcome?: 'seated' | 'waitlisted' | null }`.

- [ ] **Step 1: Add i18n keys (both files)**

In `messages/en.json`, inside `booking` add:

```json
    "paymentRegular": "Cash",
    "paymentMultisport": "MultiSport",
    "bookedToast": "Seat booked",
    "waitlistedToast": "Added to the waitlist",
    "soon": "Soon",
    "locked": "Locked",
```

In `messages/tr.json`, inside `booking` add:

```json
    "paymentRegular": "Nakit",
    "paymentMultisport": "MultiSport",
    "bookedToast": "Yerin ayrıldı",
    "waitlistedToast": "Bekleme listesine eklendin",
    "soon": "Yakında",
    "locked": "Kilitli",
```

- [ ] **Step 2: Thread the booking outcome through the server action**

In `app/s/[slug]/book/actions.ts`, change line 9:

```ts
export type BookFormState = { status: 'idle' | 'ok' | 'error'; error: string | null; outcome?: 'seated' | 'waitlisted' | null };
```

And the success return (line 42):

```ts
  return { status: 'ok', error: null, outcome: result.outcome };
```

- [ ] **Step 3: Rewrite the Book page shell**

In `app/s/[slug]/book/page.tsx`, remove the `import Link from 'next/link';` line and add `import { MemberHeader } from '@/components/member-header';`. Replace the `return (...)` block:

```tsx
  return (
    <div className="mx-auto max-w-2xl p-4">
      <MemberHeader active="book" club={{ name: club.name, logoUrl: club.logoUrl }} />
      <div className="mb-4">
        <h1 className="font-heading text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description', { days: BOOK_DAYS })}</p>
      </div>
      <BookCalendar slug={slug} days={days} timeZone={club.timezone} />
    </div>
  );
```

- [ ] **Step 4: Rewrite the calendar component**

Replace the entire contents of `app/s/[slug]/book/book-calendar.tsx` with:

```tsx
'use client';

import { Lock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { type BadgeTone, StatusPill } from '@/components/booking-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { MemberCalendarDay, MemberVirtualSession } from '@/lib/member-calendar';

import { type BookFormState, bookSeatAction } from './actions';

const initial: BookFormState = { status: 'idle', error: null };
const selectClass = 'h-8 rounded-field border border-input bg-transparent px-2 text-xs shadow-xs';

type UiState = 'booked' | 'waitlisted' | 'ineligible' | 'notopen' | 'full' | 'open';

function uiStateOf(s: MemberVirtualSession): UiState {
  if (s.myStatus === 'booked') return 'booked';
  if (s.myStatus === 'waitlisted') return 'waitlisted';
  if (!s.eligibility.ok) return 'ineligible';
  if (!s.bookingOpen) return 'notopen';
  return s.seatsLeft <= 0 ? 'full' : 'open';
}

const toneOf: Record<UiState, BadgeTone> = {
  booked: 'accent',
  waitlisted: 'warn',
  ineligible: 'neutral',
  notopen: 'info',
  full: 'neutral',
  open: 'ok',
};

function SeatPips({ capacity, seatsLeft, mine }: { capacity: number; seatsLeft: number; mine: boolean }) {
  const filled = Math.min(capacity, Math.max(0, capacity - seatsLeft));
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: capacity }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'size-2.5 rounded-full border',
            mine && i === filled - 1
              ? 'border-brand bg-brand'
              : i < filled
                ? 'border-muted-foreground bg-muted-foreground'
                : 'border-border',
          )}
        />
      ))}
    </span>
  );
}

function BookForm({ slug, windowId, startAtISO, session, full }: { slug: string; windowId: string; startAtISO: string; session: MemberVirtualSession; full: boolean }) {
  const t = useTranslations('booking');
  const [state, formAction, pending] = useActionState(bookSeatAction.bind(null, slug), initial);
  const [payment, setPayment] = useState(session.defaultPayment);
  const [idempotencyKey] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`));

  useEffect(() => {
    if (state.status === 'ok') toast.success(state.outcome === 'waitlisted' ? t('waitlistedToast') : t('bookedToast'));
  }, [state, t]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="windowId" value={windowId} />
      <input type="hidden" name="boatTypeId" value={session.boatTypeId} />
      <input type="hidden" name="startAt" value={startAtISO} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {session.paymentChoices.length > 1 ? (
        <select name="paymentType" value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)} className={selectClass} aria-label={t('paymentLabel')}>
          {session.paymentChoices.map((p) => (
            <option key={p} value={p}>{p === 'regular' ? t('paymentRegular') : t('paymentMultisport')}</option>
          ))}
        </select>
      ) : (
        <input type="hidden" name="paymentType" value={session.paymentChoices[0]} />
      )}
      <Button
        type="submit"
        size="xs"
        variant={full ? 'secondary' : 'default'}
        className={cn(full && 'border-transparent bg-warn-bg text-warn hover:bg-warn-bg/80')}
        disabled={pending}
      >
        {full ? t('joinWaitlist') : t('book')}
      </Button>
      {state.status === 'error' && <span className="text-xs text-destructive">{t(`errors.${state.error ?? 'generic'}`)}</span>}
    </form>
  );
}

function SessionRow({ slug, windowId, startAtISO, session, timeZone }: { slug: string; windowId: string; startAtISO: string; session: MemberVirtualSession; timeZone: string }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  const ui = uiStateOf(session);

  const pillText =
    ui === 'open' ? t('seatsLeft', { count: session.seatsLeft, capacity: session.capacity })
    : ui === 'full' ? t('full')
    : ui === 'booked' ? t('booked')
    : ui === 'waitlisted' ? t('waitlisted', { position: session.myQueuePosition ?? 0 })
    : ui === 'notopen' ? t('soon')
    : t('locked');

  const subText =
    ui === 'notopen'
      ? (session.bookingOpensAt ? t('opensOn', { date: f.dateTime(session.bookingOpensAt, { day: 'numeric', month: 'short', timeZone }) }) : null)
      : ui === 'ineligible' && !session.eligibility.ok
        ? t(`reasons.${session.eligibility.reason}`)
        : null;

  const restrictedPayment = session.paymentChoices.length === 1 ? session.paymentChoices[0] : null;

  return (
    <div className="flex flex-col gap-2 rounded-field border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-2 font-heading text-sm font-bold">{session.capacity}</span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-heading text-sm font-semibold">{session.boatName}</span>
            {restrictedPayment && (
              <span className={cn('mt-0.5 inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium', restrictedPayment === 'multisport' ? 'bg-info-bg text-info' : 'bg-surface-2 text-muted-foreground')}>
                {restrictedPayment === 'multisport' ? t('paymentMultisport') : t('paymentRegular')}
              </span>
            )}
          </div>
        </div>
        <StatusPill tone={toneOf[ui]}>{pillText}</StatusPill>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <SeatPips capacity={session.capacity} seatsLeft={session.seatsLeft} mine={ui === 'booked'} />
          {subText && <span className="text-xs text-muted-foreground">{subText}</span>}
        </div>
        {ui === 'open' || ui === 'full' ? (
          <BookForm slug={slug} windowId={windowId} startAtISO={startAtISO} session={session} full={ui === 'full'} />
        ) : ui === 'ineligible' ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" />{t('locked')}</span>
        ) : null}
      </div>
    </div>
  );
}

export function BookCalendar({ slug, days, timeZone }: { slug: string; days: MemberCalendarDay[]; timeZone: string }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  return (
    <ul className="flex flex-col gap-3">
      {days.map((day) => (
        <li key={day.dateISO}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>{f.dateTime(new Date(`${day.dateISO}T00:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span>
                {day.closed && <StatusPill tone="neutral" className="font-normal">{day.closedReason === 'holiday' ? t('closedHoliday') : t('closedByClub')}</StatusPill>}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {day.slots.length > 0 ? (
                day.slots.map((slot) => (
                  <div key={slot.startAt.toISOString()} className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
                    <span className="font-heading text-xs font-bold text-muted-foreground">
                      {f.dateTime(slot.startAt, { hour: '2-digit', minute: '2-digit', timeZone })} – {f.dateTime(slot.endAt, { hour: '2-digit', minute: '2-digit', timeZone })}
                    </span>
                    {day.closed ? (
                      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                        {slot.sessions.map((session, i) => (
                          <li key={`${session.boatTypeId}-${session.sessionId ?? i}`}>{session.boatName}</li>
                        ))}
                      </ul>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {slot.sessions.map((session, i) => (
                          <li key={`${session.boatTypeId}-${session.sessionId ?? i}`}>
                            <SessionRow slug={slug} windowId={slot.windowId ?? ''} startAtISO={slot.startAt.toISOString()} session={session} timeZone={timeZone} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              ) : (
                !day.closed && <p className="text-sm text-muted-foreground">{t('noSessions')}</p>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Verify i18n mirrored + lint + build**

Run: `node -e "const e=require('./messages/en.json').booking,t=require('./messages/tr.json').booking;const k=o=>Object.keys(o).sort().join(',');if(k(e)!==k(t))throw new Error('booking keys differ');console.log('booking keys mirrored:',Object.keys(e).length)"`
Expected: prints the mirrored count, no error.

Run: `pnpm lint` — expected 0 warnings/errors.
Run: `pnpm build` — expected `/s/[slug]/book` builds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/s/[slug]/book/actions.ts app/s/[slug]/book/page.tsx app/s/[slug]/book/book-calendar.tsx messages/en.json messages/tr.json
git commit -m "feat(booking): restyle Book screen with state-driven cards, pills and seat pips"
```

---

### Task 6: Restyle the My Bookings screen

**Files:**
- Modify: `app/s/[slug]/bookings/page.tsx` (header + container)
- Modify: `app/s/[slug]/bookings/bookings-list.tsx` (full rewrite — cards + pills)
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `MemberHeader` (Task 4), `StatusPill` + `toneByStatus` (Task 2), `Card`/`CardContent`, `toast` from `sonner`.

- [ ] **Step 1: Add i18n keys (both files)**

In `messages/en.json`, inside `booking` add:

```json
    "cancelled": "Cancelled",
    "noShow": "No-show",
    "attended": "Attended",
    "cancelClosed": "Cancellation closed",
    "cancelledToast": "Booking cancelled",
```

In `messages/tr.json`, inside `booking` add:

```json
    "cancelled": "İptal edildi",
    "noShow": "Gelmedi",
    "attended": "Katıldı",
    "cancelClosed": "İptal kapalı",
    "cancelledToast": "Rezervasyon iptal edildi",
```

- [ ] **Step 2: Rewrite the My Bookings page shell**

In `app/s/[slug]/bookings/page.tsx`, remove `import Link from 'next/link';` and add `import { MemberHeader } from '@/components/member-header';`. Replace the `return (...)` block:

```tsx
  return (
    <div className="mx-auto max-w-2xl p-4">
      <MemberHeader active="bookings" club={{ name: club.name, logoUrl: club.logoUrl }} />
      <h1 className="mb-4 font-heading text-xl font-semibold">{t('myTitle')}</h1>
      <BookingsList slug={slug} upcoming={upcoming} past={past} timeZone={club.timezone} />
    </div>
  );
```

- [ ] **Step 3: Rewrite the bookings list component**

Replace the entire contents of `app/s/[slug]/bookings/bookings-list.tsx` with:

```tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';

import { StatusPill, toneByStatus } from '@/components/booking-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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

  useEffect(() => {
    if (state.status === 'ok') toast.success(t('cancelledToast'));
  }, [state, t]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Button type="submit" size="xs" variant="outline" disabled={pending}>{t('cancel')}</Button>
      {state.status === 'error' && <span className="text-xs text-destructive">{t(`cancelErrors.${state.error ?? 'generic'}`)}</span>}
    </form>
  );
}

function statusLabel(t: ReturnType<typeof useTranslations>, row: BookingRow): string {
  if (row.status === 'waitlisted') return t('waitlisted', { position: row.queuePosition ?? 0 });
  if (row.status === 'booked') return t('seated');
  if (row.status === 'cancelled') return t('cancelled');
  if (row.status === 'no_show') return t('noShow');
  return t('attended');
}

function Section({ slug, title, rows, timeZone, cancellable }: { slug: string; title: string; rows: BookingRow[]; timeZone: string; cancellable: boolean }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Card size="sm">
                <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-heading text-sm font-semibold">
                      {f.dateTime(new Date(row.startAt), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })}
                    </span>
                    <span className="text-xs text-muted-foreground">{row.boatName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={toneByStatus[row.status]}>{statusLabel(t, row)}</StatusPill>
                    {cancellable && (row.canCancel ? <CancelButton slug={slug} bookingId={row.id} /> : <span className="text-xs text-muted-foreground">{t('cancelClosed')}</span>)}
                  </div>
                </CardContent>
              </Card>
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

- [ ] **Step 4: Verify i18n mirrored + lint + build**

Run: `node -e "const e=require('./messages/en.json').booking,t=require('./messages/tr.json').booking;const k=o=>Object.keys(o).sort().join(',');if(k(e)!==k(t))throw new Error('booking keys differ');console.log('booking keys mirrored:',Object.keys(e).length)"`
Expected: prints the mirrored count, no error.

Run: `pnpm lint` — expected 0 warnings/errors.
Run: `pnpm build` — expected `/s/[slug]/bookings` builds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/s/[slug]/bookings/page.tsx app/s/[slug]/bookings/bookings-list.tsx messages/en.json messages/tr.json
git commit -m "feat(booking): restyle My Bookings with cards, status pills and cancel-closed hint"
```

---

### Task 7: Loading + error states

**Files:**
- Create: `src/components/page-skeleton.tsx`
- Create: `src/components/route-error.tsx`
- Create: `app/s/[slug]/book/loading.tsx`, `app/s/[slug]/book/error.tsx`
- Create: `app/s/[slug]/bookings/loading.tsx`, `app/s/[slug]/bookings/error.tsx`
- Modify: `messages/en.json`, `messages/tr.json`

**Interfaces:**
- Consumes: `Button`, `useTranslations`, `booking` keys `loadError` + `retry`, token utilities (Task 1).
- Produces: `PageSkeleton()`; `RouteError({ reset }: { reset: () => void })`.

- [ ] **Step 1: Add i18n keys (both files)**

In `messages/en.json`, inside `booking` add:

```json
    "loadError": "Couldn't load this page.",
    "retry": "Try again",
```

In `messages/tr.json`, inside `booking` add:

```json
    "loadError": "Bu sayfa yüklenemedi.",
    "retry": "Tekrar dene",
```

- [ ] **Step 2: Create the shared skeleton**

Create `src/components/page-skeleton.tsx`:

```tsx
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-6 h-8 w-40 animate-pulse rounded-field bg-muted" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-card bg-muted" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the shared error UI**

Create `src/components/route-error.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

export function RouteError({ reset }: { reset: () => void }) {
  const t = useTranslations('booking');
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">{t('loadError')}</p>
      <Button onClick={reset} variant="outline" size="sm">{t('retry')}</Button>
    </div>
  );
}
```

- [ ] **Step 4: Wire the four route files**

Create `app/s/[slug]/book/loading.tsx` and `app/s/[slug]/bookings/loading.tsx` (identical):

```tsx
import { PageSkeleton } from '@/components/page-skeleton';

export default function Loading() {
  return <PageSkeleton />;
}
```

Create `app/s/[slug]/book/error.tsx` and `app/s/[slug]/bookings/error.tsx` (identical):

```tsx
'use client';

import { RouteError } from '@/components/route-error';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError reset={reset} />;
}
```

- [ ] **Step 5: Verify i18n mirrored + lint + build**

Run: `node -e "const e=require('./messages/en.json').booking,t=require('./messages/tr.json').booking;const k=o=>Object.keys(o).sort().join(',');if(k(e)!==k(t))throw new Error('booking keys differ');console.log('booking keys mirrored:',Object.keys(e).length)"`
Expected: prints the mirrored count, no error.

Run: `pnpm lint` — expected 0 warnings/errors.
Run: `pnpm build` — expected clean build with the loading/error boundaries.

- [ ] **Step 6: Commit**

```bash
git add src/components/page-skeleton.tsx src/components/route-error.tsx app/s/[slug]/book/loading.tsx app/s/[slug]/book/error.tsx app/s/[slug]/bookings/loading.tsx app/s/[slug]/bookings/error.tsx messages/en.json messages/tr.json
git commit -m "feat(booking): add loading and error states for member routes"
```

---

## Deferred (out of scope for this pass — from the full design)

Explicitly NOT built here, per the "restyle existing screens" decision; flag for a future plan:
- Separate **session-detail route** (choose boat → payment radio cards → sticky Book footer).
- **5-day date-strip selector** (we keep the 14-day vertical list) and the **Upcoming/Past tab switcher** (we keep stacked sections).
- **Opening-soon countdown banner** with pulsing dot; **live countdowns**.
- **TR/EN in-app language switcher** (no locale switcher exists in the app yet — net-new).
- **Promoted-from-waitlist** distinct state, **ban/no-show notes**, and **"your seat" identity** beyond the simple pip approximation.
- Optional **serif club heading** (`--club-heading` / Newsreader).

## Final verification (after all tasks)

- [ ] `pnpm test` — all pass (adds StatusPill + bookingOpensAt tests).
- [ ] `pnpm lint` — 0 warnings/errors.
- [ ] `pnpm build` — clean, both member routes + loading/error boundaries.
- [ ] `grep -rn "/s/\${slug}" app/s/\[slug\]/book app/s/\[slug\]/bookings` — no matches (no internal-path client links remain).
</content>
