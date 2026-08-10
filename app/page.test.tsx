// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentUser, getRestrictions, getRestriction } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getRestrictions: vi.fn(),
  getRestriction: vi.fn(),
}));

/** What `db.select(...)` resolves to. Set per test. */
let clubRows: Record<string, unknown>[] = [];

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ orderBy: () => Promise.resolve(clubRows) }),
        }),
      }),
    }),
  },
}));
vi.mock('@/lib/session', () => ({ getCurrentUser }));
vi.mock('@/lib/restriction', () => ({ getRestrictions, getRestriction }));
vi.mock('@/env', () => ({ env: { APP_URL: 'http://localhost:3000' } }));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));
// Client component with its own suite; rendering it here would drag next-themes in.
vi.mock('@/components/user-menu', () => ({ UserMenu: () => null }));
/**
 * Stubbed because it is ASYNC. An async component anywhere in the tree
 * `render(await Home())` returns makes @testing-library produce an empty div with no
 * error — the exact failure this file's first assertion exists to catch. The stub
 * publishes its props so the page's contract with the notice (which restriction, in
 * which timezone, in which variant) is still under test; the notice's own rendering is
 * `src/components/restriction-notice.test.tsx`'s job.
 */
vi.mock('@/components/restriction-notice', () => ({
  RestrictionNotice: ({ restriction, timeZone, variant }: { restriction: { state: string }; timeZone: string; variant?: string }) => (
    <span data-testid="notice" data-state={restriction.state} data-tz={timeZone} data-variant={variant} />
  ),
}));

import type { Restriction } from '@/lib/restriction';

import Home from './page';

const USER = { id: 'user-1', name: 'İltan Caner', email: 'member@example.com', image: null };

function club(over: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    slug: 'bebek',
    name: 'Bebek Rowing',
    logoUrl: null,
    timezone: 'Europe/Istanbul',
    role: 'member',
    status: 'approved',
    bannedUntil: null,
    ...over,
  };
}

/** The map the real `getRestrictions` returns: every id present, restricted or not. */
function restrictionsFor(entries: Record<string, Restriction>) {
  return async (_db: unknown, ms: { id: string }[]) =>
    new Map(ms.map((m) => [m.id, entries[m.id] ?? ({ state: 'none' } as Restriction)]));
}

function hrefs(): string[] {
  return [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue(USER);
  clubRows = [club()];
  getRestrictions.mockImplementation(restrictionsFor({}));
});

describe('the apex club list', () => {
  /**
   * Asserted first and alone, for the reason `app/account/page.test.tsx` records: an async
   * component nested in one of `AppShell`'s props renders as an empty div with NO error,
   * and every query below would then fail for a reason unrelated to what it tests.
   */
  it('renders real DOM, not the empty div an async component in a prop produces', async () => {
    const { container } = render(await Home());

    expect(container.querySelector('main')).not.toBeNull();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByText('Bebek Rowing')).toBeInTheDocument();
  });

  /**
   * THE N+1 test. The list is the page every signed-in member lands on, and one
   * restriction read per club is the shape this page had every reason to grow: the
   * previous version called `restrictionState` inside `map`, and the obvious way to add
   * a cause is to make that call async.
   *
   * Both halves matter. "Called once" alone passes for a page that calls the SINGLE-row
   * `getRestriction` in a loop and never touches `getRestrictions` at all, so the
   * single-row entry point is asserted absent as well.
   */
  it('asks about every club in one call, never once per club', async () => {
    clubRows = [
      club({ id: 'm-1', slug: 'bebek', name: 'Bebek' }),
      club({ id: 'm-2', slug: 'kurucesme', name: 'Kuruçeşme' }),
      club({ id: 'm-3', slug: 'moda', name: 'Moda' }),
    ];
    await Home();

    expect(getRestrictions).toHaveBeenCalledTimes(1);
    expect(getRestriction).not.toHaveBeenCalled();
    expect(vi.mocked(getRestrictions).mock.calls[0][1]).toHaveLength(3);
  });

  /**
   * One instant for the whole list. Two clubs whose bans straddle the same millisecond
   * must not disagree about what time it is, which is only guaranteed if `now` is
   * computed once and handed down — a page that let `getRestrictions` default would get
   * a fresh `new Date()` inside the call instead.
   */
  it('hands the same instant to the whole list', async () => {
    await Home();
    expect(vi.mocked(getRestrictions).mock.calls[0][2]).toBeInstanceOf(Date);
  });

  /**
   * The reported bug, in one assertion. A restricted member used to get a red pill
   * reading "Askıda" and a note slot hard-coded to `null`: one word, no explanation, and
   * nothing to click on the page they land on after signing in.
   */
  it('gives a restricted club an explanation and a door', async () => {
    clubRows = [club({ id: 'm-1', bannedUntil: new Date('2026-08-12T04:00:00Z') })];
    getRestrictions.mockImplementation(
      restrictionsFor({ 'm-1': { state: 'paused', endsAt: new Date('2026-08-12T04:00:00Z'), cause: null } }),
    );

    render(await Home());

    expect(screen.getByTestId('notice')).toHaveAttribute('data-state', 'paused');
    expect(hrefs()).toContain('http://bebek.localhost:3000');
    expect(screen.getByText('ctaOpenClub')).toBeInTheDocument();
  });

  /**
   * The per-row timezone is the reason the notice is a server component at all: two clubs
   * in the list can be in different zones, so the lift date cannot be formatted in the
   * request's timezone. A page that passed a constant would render an identical-looking
   * notice with a date wrong by up to a day, so the two rows here carry DIFFERENT zones
   * and both are checked.
   */
  it('formats each club\'s restriction in that club\'s own timezone', async () => {
    clubRows = [
      club({ id: 'm-1', slug: 'bebek', name: 'Bebek', timezone: 'Europe/Istanbul' }),
      club({ id: 'm-2', slug: 'henley', name: 'Henley', timezone: 'Europe/London' }),
    ];
    getRestrictions.mockImplementation(
      restrictionsFor({
        'm-1': { state: 'suspended', cause: null },
        'm-2': { state: 'suspended', cause: null },
      }),
    );

    render(await Home());

    expect(screen.getAllByTestId('notice').map((n) => n.getAttribute('data-tz')))
      .toEqual(['Europe/Istanbul', 'Europe/London']);
  });

  it('uses the compact inline variant in a list row', async () => {
    clubRows = [club({ id: 'm-1' })];
    getRestrictions.mockImplementation(restrictionsFor({ 'm-1': { state: 'suspended', cause: null } }));

    render(await Home());
    expect(screen.getByTestId('notice')).toHaveAttribute('data-variant', 'inline');
  });

  // The healthy member is the common case and must be untouched by all of the above.
  it('leaves an unrestricted member with their booking link and no notice', async () => {
    render(await Home());

    expect(screen.queryByTestId('notice')).not.toBeInTheDocument();
    expect(hrefs()).toContain('http://bebek.localhost:3000/book');
    expect(screen.getByText('ctaGoBooking')).toBeInTheDocument();
  });

  it('still sends an approved owner to the manage console', async () => {
    clubRows = [club({ role: 'owner' })];
    render(await Home());

    expect(hrefs()).toContain('http://bebek.localhost:3000/manage');
  });

  /**
   * A restricted OWNER gets the member's door, not the console. The restriction outranks
   * the owner role everywhere else (`viewerKindOf`), and a list row that kept offering
   * "Manage" would be the one surface that disagreed.
   */
  it('does not offer the manage console to a restricted owner', async () => {
    clubRows = [club({ role: 'owner', status: 'banned' })];
    getRestrictions.mockImplementation(restrictionsFor({ 'm-1': { state: 'suspended', cause: null } }));

    render(await Home());

    expect(hrefs()).not.toContain('http://bebek.localhost:3000/manage');
    expect(hrefs()).toContain('http://bebek.localhost:3000');
  });

  it('shows the signed-out hero with no club query at all', async () => {
    getCurrentUser.mockResolvedValue(null);
    render(await Home());

    expect(screen.getByText('heroTitle')).toBeInTheDocument();
    expect(getRestrictions).not.toHaveBeenCalled();
  });
});
