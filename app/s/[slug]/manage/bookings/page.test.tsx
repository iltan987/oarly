// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `@/db` reads server-only env at module load. Left unmocked under jsdom it fails and
// takes the whole FILE down — `0 test`, which is an absent assertion, not a failing one.
vi.mock('@/db', () => ({ db: {} }));

const { requireOwner, getDayRoster } = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  getDayRoster: vi.fn(),
}));
vi.mock('@/lib/membership', () => ({ requireOwner }));
vi.mock('@/lib/roster', () => ({ getDayRoster }));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
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
