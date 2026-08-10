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
/*
  The stub EXPOSES `restricted`. A stub that ignores its props cannot see the page failing
  to thread it — and a `restricted` that never arrives is exactly the seam this page owns:
  `BookingsList` decides whether to offer a "book a session" button, and only the page knows
  whether this member may book at all.
*/
vi.mock('./bookings-list', () => ({
  BookingsList: ({ restricted }: { restricted: boolean }) => <div data-testid="list" data-restricted={String(restricted)} />,
}));
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
  /**
   * The seam this page owns, and the bug it had: `/bookings` showed a paused member the
   * restriction card AND, three lines below it, a primary button to `/book` where every
   * session renders `Kilitli` — Task 6's dead end, restored by Task 8's empty state.
   *
   * `BookingsList` can only avoid that if the page tells it. Asserted on the RESTRICTED
   * case first: `restricted={false}` is the failing-open default a forgotten prop produces,
   * so a test that only checks the healthy member passes with the bug in place.
   *
   * Both states are checked because they are one predicate — `state !== 'none'` — and a
   * suspension is a restriction as much as a pause is.
   */
  it.each(['paused', 'suspended'] as const)('tells the list a %s member must not be offered a way to book', async (state) => {
    getRestriction.mockResolvedValue({ state, endsAt: new Date('2026-08-17T04:00:00.000Z'), cause: null });

    await render_();

    expect(screen.getByTestId('list')).toHaveAttribute('data-restricted', 'true');
  });

  it('tells the list an unrestricted member may be offered one', async () => {
    getRestriction.mockResolvedValue({ state: 'none' });

    await render_();

    expect(screen.getByTestId('list')).toHaveAttribute('data-restricted', 'false');
  });

  /**
   * The card and the empty state read from ONE `getRestriction` result. Two reads of a
   * time-sensitive state inside one render can disagree across the instant a pause lapses,
   * and the page would then show "Duraklatıldı" above an offer to book, or the reverse.
   */
  it('reads the restriction once and uses it for both the notice and the list', async () => {
    getRestriction.mockResolvedValue({ state: 'paused', endsAt: new Date('2026-08-17T04:00:00.000Z'), cause: null });

    await render_();

    expect(getRestriction).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('notice')).toHaveAttribute('data-state', 'paused');
    expect(screen.getByTestId('list')).toHaveAttribute('data-restricted', 'true');
  });

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
