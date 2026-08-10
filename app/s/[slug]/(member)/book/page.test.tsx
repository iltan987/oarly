// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireMemberView, getRestriction, computeMemberCalendar } = vi.hoisted(() => ({
  requireMemberView: vi.fn(),
  getRestriction: vi.fn(),
  computeMemberCalendar: vi.fn(),
}));

// `@/db` reads server-only env at module load; unmocked under jsdom it takes the whole
// FILE down as `0 test`, which is an absent assertion rather than a failing one.
vi.mock('@/db', () => ({ db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) } }));
vi.mock('@/lib/membership', () => ({ requireMemberView }));
vi.mock('@/lib/restriction', () => ({ getRestriction }));
vi.mock('@/lib/member-calendar', () => ({ computeMemberCalendar }));
vi.mock('next-intl/server', () => ({ getTranslations: () => Promise.resolve((key: string) => key) }));
vi.mock('./book-calendar', () => ({ BookCalendar: () => <div data-testid="calendar" /> }));
/** Async server component: stubbed, and publishes the props this page is responsible for. */
vi.mock('@/components/restriction-notice', () => ({
  RestrictionNotice: ({ restriction, timeZone, clubPhone, variant }: { restriction: { state: string }; timeZone: string; clubPhone?: string | null; variant?: string }) =>
    restriction.state === 'none'
      ? null
      : <span data-testid="notice" data-state={restriction.state} data-tz={timeZone} data-phone={clubPhone ?? ''} data-variant={variant} />,
}));

import BookPage from './page';

const CLUB = { id: 'club-1', timezone: 'Europe/Istanbul', phone: '0212 555 44 33' };
const USER = { id: 'u1', defaultPaymentType: 'regular' };

function membership(over: Record<string, unknown> = {}) {
  return { id: 'm-1', status: 'approved', bannedUntil: null, skillLevelId: null, ...over };
}

const render_ = async () => render(await BookPage({ params: Promise.resolve({ slug: 'demo' }) }));

beforeEach(() => {
  vi.clearAllMocks();
  requireMemberView.mockResolvedValue({ club: CLUB, user: USER, membership: membership() });
  getRestriction.mockResolvedValue({ state: 'none' });
  computeMemberCalendar.mockResolvedValue([]);
});

describe('BookPage', () => {
  it('renders real DOM, not the empty div an async component in a prop produces', async () => {
    const { container } = await render_();

    expect(container.firstElementChild).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    expect(screen.getByTestId('calendar')).toBeInTheDocument();
  });

  /**
   * The banner that used to live inside `BookCalendar` now lives here, and this is the
   * assertion that says so. Deleting the `<RestrictionNotice/>` line from this page was
   * green before this file existed — typecheck included, because the page simply stops
   * using a value it still computes.
   */
  it('shows a restricted member the notice, as a card, with the club phone and timezone', async () => {
    requireMemberView.mockResolvedValue({ club: CLUB, user: USER, membership: membership({ bannedUntil: new Date('2026-08-12T04:00:00Z') }) });
    getRestriction.mockResolvedValue({ state: 'paused', endsAt: new Date('2026-08-12T04:00:00Z'), cause: null });
    await render_();

    const notice = screen.getByTestId('notice');
    expect(notice).toHaveAttribute('data-state', 'paused');
    expect(notice).toHaveAttribute('data-variant', 'card');
    expect(notice).toHaveAttribute('data-tz', 'Europe/Istanbul');
    expect(notice).toHaveAttribute('data-phone', '0212 555 44 33');
  });

  /**
   * ABOVE the calendar, not below it. Every session in that calendar will read
   * "ineligible" for this member, and an explanation underneath them arrives after the
   * confusion it exists to prevent. Compared by document order rather than by asserting
   * both exist, which a notice rendered last would also satisfy.
   */
  it('puts the notice above the calendar', async () => {
    requireMemberView.mockResolvedValue({ club: CLUB, user: USER, membership: membership({ status: 'banned' }) });
    getRestriction.mockResolvedValue({ state: 'suspended', cause: null });
    await render_();

    const position = screen.getByTestId('notice').compareDocumentPosition(screen.getByTestId('calendar'));
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The common case. A null child contributes no DOM node and therefore no flex gap —
  // the reason the page is a `flex flex-col gap-4` rather than a margin on the heading.
  it('renders nothing for an unrestricted member', async () => {
    await render_();
    expect(screen.queryByTestId('notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('calendar')).toBeInTheDocument();
  });

  /**
   * `requireMemberView`, never `requireMember`. The strict guard 404s a restricted
   * member, which would leave them staring at a not-found page instead of the reason —
   * and would make every assertion above unreachable in production while still passing
   * here, because the guard is mocked.
   */
  it('guards with the viewing gate, which admits a restricted member', async () => {
    await render_();
    expect(requireMemberView).toHaveBeenCalledWith('demo', '/book');
  });
});
