// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RosterModule from '@/lib/roster';

import en from '../../../../../messages/en.json';
import tr from '../../../../../messages/tr.json';

// `@/db` reads server-only env at module load. Left unmocked under jsdom it fails and
// takes the whole FILE down — `0 test`, which is an absent assertion, not a failing one.
vi.mock('@/db', () => ({ db: {} }));

const { requireOwner, getDayRoster } = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  getDayRoster: vi.fn(),
}));
vi.mock('@/lib/membership', () => ({ requireOwner }));
/**
 * The LOADER is stubbed; `rosterDayTotals` is the real one, spread in from the actual
 * module. Re-implementing it in this factory would make every totals assertion below a
 * comparison of the mock with itself — the trap `members/page.test.tsx` documents for
 * `MEMBERS_PAGE_SIZE`, where the `no_show` rule could be inverted in `src/lib/roster.ts`
 * with this file still green. (`roster.ts` imports `DB` as a type only, so importing it
 * for real here pulls in no database.)
 */
vi.mock('@/lib/roster', async (importOriginal) => ({
  ...await importOriginal<typeof RosterModule>(),
  getDayRoster,
}));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key)),
}));
// Client components with their own next-intl boundary; this file is about which date
// the page resolves and what it puts in its own navigation links.
vi.mock('./bookings-roster', () => ({ BookingsRoster: () => null }));
vi.mock('./date-jump', () => ({ DateJump: ({ dateISO }: { dateISO: string }) => <span data-testid="jump">{dateISO}</span> }));

import ManageBookingsPage from './page';

/** UTC, so "today" in the club is the same calendar date the fake clock reports. */
const CLUB = { id: 'club-1', timezone: 'UTC', noshowPenalty: 'off', multisportEnabled: true };
const TODAY = '2026-08-08';

async function renderAt(date?: string) {
  render(await ManageBookingsPage({
    params: Promise.resolve({ slug: 'bebek' }),
    searchParams: Promise.resolve(date === undefined ? {} : { date }),
  }));
}

function hrefs(): string[] {
  return [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  requireOwner.mockResolvedValue({ club: CLUB, user: { id: 'u1' } });
  getDayRoster.mockResolvedValue({ dateISO: TODAY, closed: false, sessions: [] });
});

describe('ManageBookingsPage ?date', () => {
  it('uses a real date it was given', async () => {
    await renderAt('2026-08-20');
    expect(getDayRoster).toHaveBeenCalledWith({}, { clubId: CLUB.id, dateISO: '2026-08-20' });
    expect(screen.getByTestId('jump')).toHaveTextContent('2026-08-20');
  });

  it('falls back to today when ?date is absent', async () => {
    await renderAt();
    expect(getDayRoster).toHaveBeenCalledWith({}, { clubId: CLUB.id, dateISO: TODAY });
  });

  /**
   * The fifth instance of the defect class this cycle proved exists (after ?cursor,
   * ?page, /admin/clubs/[id] and ?clubId) and the most reachable: a hand-edited URL or
   * a stale bookmark, no crafted POST. `/^\d{4}-\d{2}-\d{2}$/` accepted every one of
   * these, and each reaches a `date` column as 22008.
   */
  it.each(['2026-02-31', '2026-13-45', '2026-04-31', '1900-02-29', '2026-01-00', '2026-01-32'])(
    'never passes the well-shaped non-date %s to the query',
    async (date) => {
      await renderAt(date);
      expect(getDayRoster).toHaveBeenCalledWith({}, { clubId: CLUB.id, dateISO: TODAY });
    },
  );

  /**
   * The half with no server error to notice. `addDaysISO('2026-13-45', 1)` is
   * `new Date('2026-13-45T00:00:00Z')` → Invalid Date → the string "NaN-NaN-NaN",
   * which the page then wrote into its OWN prev/next links: every subsequent click
   * carried the corruption forward.
   */
  it('never writes NaN-NaN-NaN into its own prev/next links', async () => {
    await renderAt('2026-13-45');
    expect(hrefs()).toEqual(['/manage/bookings?date=2026-08-07', '/manage/bookings?date=2026-08-09']);
    expect(hrefs().join(' ')).not.toContain('NaN');
  });

  it('still accepts a real leap day', async () => {
    await renderAt('2024-02-29');
    expect(getDayRoster).toHaveBeenCalledWith({}, { clubId: CLUB.id, dateISO: '2024-02-29' });
    expect(hrefs()).toEqual(['/manage/bookings?date=2024-02-28', '/manage/bookings?date=2024-03-01']);
  });
});

type Session = RosterModule.RosterSession;

function seat(bookingId: string, status: Session['seated'][number]['status']): Session['seated'][number] {
  return { bookingId, name: bookingId, paymentType: 'regular', queuePosition: null, status };
}

function mkSession(over: Partial<Session> = {}): Session {
  return {
    sessionId: `s-${Math.random()}`, windowId: 'w1',
    startAt: new Date(`${TODAY}T06:00:00Z`), endAt: new Date(`${TODAY}T07:00:00Z`),
    boatTypeId: 'bt1', boatName: 'Dört tek', capacity: 4, status: 'open',
    seated: [], waitlisted: [], freeSeats: 4, waitlistCapacity: 2, ...over,
  };
}

async function renderWith(sessions: Session[]) {
  getDayRoster.mockResolvedValue({ dateISO: TODAY, closed: false, sessions });
  await renderAt();
}

describe('ManageBookingsPage day totals', () => {
  /**
   * The numbers that were one nav click away on `/manage`, put beside the control that
   * changes the day they describe. They are summed across every session of the day, so a
   * club running six boats reads one figure rather than six headers.
   */
  it('sums the day across its sessions, beside the date control', async () => {
    await renderWith([
      mkSession({ capacity: 8, seated: [seat('a', 'booked'), seat('b', 'booked')], waitlisted: [] }),
      mkSession({ capacity: 12, seated: [seat('c', 'booked')], waitlisted: [{ ...seat('w', 'waitlisted'), queuePosition: 1 }] }),
    ]);
    expect(screen.getByText(/daySeated/)).toHaveTextContent('daySeated:{"seated":3,"capacity":20}');
    expect(screen.getByText(/dayWaitlisted/)).toHaveTextContent('dayWaitlisted:{"count":1}');
  });

  /**
   * The rule that separates `seated` from "everyone in the seated array", asserted at the
   * page rather than only at the helper: `getDayRoster` keeps `no_show` rows in `seated`
   * so the owner can undo the mark, and counting them would report 3/4 above a roster
   * that is offering the fourth seat AND the third to the add form.
   */
  it('does not count a no-show as a filled seat', async () => {
    await renderWith([
      mkSession({ capacity: 4, seated: [seat('a', 'booked'), seat('b', 'no_show'), seat('c', 'booked')] }),
    ]);
    expect(screen.getByText(/daySeated/)).toHaveTextContent('daySeated:{"seated":2,"capacity":4}');
  });

  // Nothing to say about a waitlist nobody is on — "· 0 yedek" beside the date is a
  // permanent zero on the majority of days.
  it('says nothing about the waitlist when nobody is waiting', async () => {
    await renderWith([mkSession({ capacity: 4, seated: [seat('a', 'booked')] })]);
    expect(screen.getByText(/daySeated/)).toBeInTheDocument();
    expect(screen.queryByText(/dayWaitlisted/)).toBeNull();
  });

  // And nothing at all on a day with no sessions: "0/0 dolu" beside the date duplicates
  // the roster's own empty sentence with a number that reads like a fault.
  it('renders no totals at all on a day with no sessions', async () => {
    await renderWith([]);
    expect(screen.queryByText(/daySeated/)).toBeNull();
    expect(screen.queryByText(/dayWaitlisted/)).toBeNull();
  });

  /**
   * The control row is centred while the canvas is narrow and left-aligned once it is
   * 1024px wide — a date control floating in the middle of that canvas is what the width
   * would otherwise buy. Asserted on the row itself (found by walking up from the prev-day
   * link) rather than by class query, so a nested primitive carrying `justify-center`
   * cannot satisfy it.
   */
  it('centres the date control only until the canvas is wide', async () => {
    await renderWith([mkSession()]);
    const row = screen.getByRole('link', { name: 'prevDay' }).parentElement;
    expect(row).toHaveClass('justify-center', 'lg:justify-start');
    // The totals share that row, and wrap below it rather than widening the page.
    expect(row).toContainElement(screen.getByText(/daySeated/));
    expect(row).toHaveClass('flex-wrap');
  });
});

describe('bookings message catalogs', () => {
  // NOT superseded by src/i18n/messages-parity.test.ts: that test compares the two
  // catalogs against EACH OTHER, so a key deleted from BOTH is invisible to it by
  // construction. Naming the keys is the only thing that catches it, and Turkish is the
  // app default — an English-only key ships as a missing-message warning to every real
  // user of this page.
  it.each([['en', en], ['tr', tr]] as const)('%s carries the day-totals keys', (_locale, messages) => {
    expect(messages.manage.bookings.daySeated).toBeTruthy();
    expect(messages.manage.bookings.dayWaitlisted).toBeTruthy();
  });

  // Both placeholders, in both catalogs: `{seated}/{capacity}` with one of them dropped
  // renders a half-sentence that the key-presence check above cannot see.
  it.each([['en', en], ['tr', tr]] as const)('%s interpolates both halves of the seat count', (_locale, messages) => {
    expect(messages.manage.bookings.daySeated).toContain('{seated}');
    expect(messages.manage.bookings.daySeated).toContain('{capacity}');
    expect(messages.manage.bookings.dayWaitlisted).toContain('{count}');
  });
});
