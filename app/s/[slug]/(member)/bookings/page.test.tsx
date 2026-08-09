// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireMemberView, getRestriction } = vi.hoisted(() => ({
  requireMemberView: vi.fn(),
  getRestriction: vi.fn(),
}));

/** What the bookings query resolves to. */
let bookingRows: Record<string, unknown>[] = [];

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            innerJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve(bookingRows) }) }),
          }),
        }),
      }),
    }),
  },
}));
vi.mock('@/lib/membership', () => ({ requireMemberView }));
vi.mock('@/lib/restriction', () => ({ getRestriction }));
vi.mock('next-intl/server', () => ({ getTranslations: () => Promise.resolve((key: string) => key) }));
vi.mock('./bookings-list', () => ({ BookingsList: () => <div data-testid="list" /> }));
vi.mock('@/components/restriction-notice', () => ({
  RestrictionNotice: ({ restriction, timeZone, clubPhone, variant }: { restriction: { state: string }; timeZone: string; clubPhone?: string | null; variant?: string }) =>
    restriction.state === 'none'
      ? null
      : <span data-testid="notice" data-state={restriction.state} data-tz={timeZone} data-phone={clubPhone ?? ''} data-variant={variant} />,
}));

import MyBookingsPage from './page';

const CLUB = { id: 'club-1', timezone: 'Europe/Istanbul', phone: '0212 555 44 33', cancelCutoffHours: null, selfCancelEnabled: true };
const USER = { id: 'u1' };

function membership(over: Record<string, unknown> = {}) {
  return { id: 'm-1', status: 'approved', bannedUntil: null, ...over };
}

const render_ = async () => render(await MyBookingsPage({ params: Promise.resolve({ slug: 'demo' }) }));

beforeEach(() => {
  vi.clearAllMocks();
  bookingRows = [];
  requireMemberView.mockResolvedValue({ club: CLUB, user: USER, membership: membership() });
  getRestriction.mockResolvedValue({ state: 'none' });
});

describe('MyBookingsPage', () => {
  it('renders real DOM, not the empty div an async component in a prop produces', async () => {
    const { container } = await render_();

    expect(container.firstElementChild).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'myTitle' })).toBeInTheDocument();
    expect(screen.getByTestId('list')).toBeInTheDocument();
  });

  /**
   * This is the page where the penalty's COLLATERAL damage is visible: `markNoShow`
   * cancels every future seat the ban swallows, so a restricted member arrives to N
   * cancelled rows. Without the notice above them that is N repetitions of a consequence
   * with no statement of the restriction it belongs to. Deleting the line was green.
   */
  it('shows a restricted member the notice, as a card, above their bookings', async () => {
    requireMemberView.mockResolvedValue({ club: CLUB, user: USER, membership: membership({ status: 'banned' }) });
    getRestriction.mockResolvedValue({ state: 'suspended', cause: null });
    await render_();

    const notice = screen.getByTestId('notice');
    expect(notice).toHaveAttribute('data-state', 'suspended');
    expect(notice).toHaveAttribute('data-variant', 'card');
    expect(notice).toHaveAttribute('data-phone', '0212 555 44 33');

    const position = notice.compareDocumentPosition(screen.getByTestId('list'));
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /**
   * The page destructures `membership` purely to answer this question, and it is the
   * membership the GUARD returned — not a second lookup that could disagree with it.
   * The same `now` is passed so the two halves of the page cannot disagree about the time.
   */
  it('asks about the restriction for the membership the guard returned', async () => {
    const m = membership({ id: 'm-42' });
    requireMemberView.mockResolvedValue({ club: CLUB, user: USER, membership: m });
    await render_();

    expect(getRestriction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getRestriction).mock.calls[0][1]).toBe(m);
    expect(vi.mocked(getRestriction).mock.calls[0][2]).toBeInstanceOf(Date);
  });

  it('renders nothing for an unrestricted member', async () => {
    await render_();
    expect(screen.queryByTestId('notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('list')).toBeInTheDocument();
  });

  it('guards with the viewing gate, which admits a restricted member', async () => {
    await render_();
    expect(requireMemberView).toHaveBeenCalledWith('demo', '/bookings');
  });
});
