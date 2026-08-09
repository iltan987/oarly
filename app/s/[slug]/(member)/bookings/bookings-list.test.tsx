// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * `t(key)` returns the key. Asserting on the KEY, not on a class or on the Turkish
 * sentence, is deliberate: `text-xs text-muted-foreground` is already carried by the boat
 * name in the same flex column, so `container.querySelector('.text-muted-foreground')`
 * would match whether or not the sub-line rendered — a test that can never fail. The four
 * cases resolve to different keys (or to nothing), so nothing here can pass for the wrong
 * one.
 */
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
  useFormatter: () => ({ dateTime: () => 'WHEN' }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => ({ cancelBookingAction: vi.fn() }));

import { type BookingRow, BookingsList } from './bookings-list';

const START = '2026-08-13T04:00:00.000Z';

function row(over: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 'b1',
    boatName: 'Quad',
    startAt: START,
    endAt: '2026-08-13T05:00:00.000Z',
    status: 'cancelled',
    cancelledReason: null,
    queuePosition: null,
    canCancel: false,
    ...over,
  };
}

/** Cancelled rows are never "upcoming" on the real page, so they arrive in `past`. */
function renderPast(...rows: BookingRow[]) {
  return render(<BookingsList slug="demo" upcoming={[]} past={rows} timeZone="Europe/Istanbul" />);
}

describe('the cancellation sub-line', () => {
  it('says the ban took the seat when the reason is penalty', () => {
    renderPast(row({ cancelledReason: 'penalty' }));
    expect(screen.getByText('cancelledBy.penalty')).toBeInTheDocument();
    expect(screen.queryByText('cancelledBy.owner')).not.toBeInTheDocument();
  });

  it('says the club took the seat when the reason is owner', () => {
    renderPast(row({ cancelledReason: 'owner' }));
    expect(screen.getByText('cancelledBy.owner')).toBeInTheDocument();
    expect(screen.queryByText('cancelledBy.penalty')).not.toBeInTheDocument();
  });

  /**
   * The member did this themselves and was told so at the time; repeating it is noise.
   * The assertion is written as "neither sub-line", not "not the member one", because
   * there is no `cancelledBy.member` key to name — a regression here would most likely
   * arrive as a fallback that reuses one of the other two.
   */
  it('says nothing when the member cancelled it themselves', () => {
    renderPast(row({ cancelledReason: 'member' }));
    expect(screen.queryByText('cancelledBy.penalty')).not.toBeInTheDocument();
    expect(screen.queryByText('cancelledBy.owner')).not.toBeInTheDocument();
  });

  /**
   * Null is every row cancelled before the column existed. We do not know who ended those,
   * and the rows most in need of explaining — historical owner removals and penalty
   * cascades — are exactly the ones a default would mislabel. Rendering the same as
   * 'member' is the point, not an oversight.
   */
  it('says nothing when there is no recorded reason', () => {
    renderPast(row({ cancelledReason: null }));
    expect(screen.queryByText('cancelledBy.penalty')).not.toBeInTheDocument();
    expect(screen.queryByText('cancelledBy.owner')).not.toBeInTheDocument();
  });

  /**
   * The pill is the STATUS and stays the same for all four. Asserted separately because
   * "the sub-line appeared" and "the pill still reads cancelled" are two claims, and an
   * implementation that moved the story into the pill would satisfy the first alone.
   */
  it('leaves the pill reading `cancelled` whatever the reason', () => {
    renderPast(row({ id: 'a', cancelledReason: 'penalty' }), row({ id: 'b', cancelledReason: 'member' }));
    expect(screen.getAllByText('cancelled')).toHaveLength(2);
  });

  /**
   * `cancelledReason` is write-once and never cleared, but a row that is not cancelled
   * carries NULL rather than a stale value — so the guard that matters is on `status`.
   * This is the case an implementation keyed only off `cancelledReason` would get wrong
   * if the column ever did outlive the cancellation.
   */
  it('says nothing on a row that is not cancelled at all', () => {
    renderPast(row({ status: 'no_show', cancelledReason: 'penalty' }));
    expect(screen.getByText('noShow')).toBeInTheDocument();
    expect(screen.queryByText('cancelledBy.penalty')).not.toBeInTheDocument();
  });
});
