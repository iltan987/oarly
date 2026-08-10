// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { cancelBookingAction } from './actions';
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

/** A live seat the member is allowed to cancel — the only row that renders the gate. */
function renderCancellable(over: Partial<BookingRow> = {}) {
  return render(
    <BookingsList
      slug="demo"
      upcoming={[row({ status: 'booked', cancelledReason: null, canCancel: true, ...over })]}
      past={[]}
      timeZone="Europe/Istanbul"
    />,
  );
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

/**
 * The gate on self-cancellation, and the SHAPE of these two tests is the point.
 *
 * A file containing only "confirming dispatches the action" is a no-op that reads like a
 * kill: delete the dialog, wire the row's button straight back to `formAction`, and it
 * still passes. The first test is the one that fails when the gate is gone, so it comes
 * first and it asserts the negative.
 */
describe('the cancel gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Resolved even in the tests that expect NO dispatch. `useActionState` writes whatever
    // the action returns straight into `state`, so an un-stubbed mock returning `undefined`
    // crashes the next render on `state.status` — and a gate-deleted build would then fail
    // these tests with a TypeError instead of with the assertion, which is a muddier signal
    // than "the action was called". Verified: with the gate removed, the first test fails
    // on `expect(cancelBookingAction).not.toHaveBeenCalled()`.
    vi.mocked(cancelBookingAction).mockResolvedValue({ status: 'ok', error: null });
  });

  it('does NOT cancel the booking when the row button is tapped — it only asks', () => {
    renderCancellable();

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));

    // The action must not have run…
    expect(cancelBookingAction).not.toHaveBeenCalled();
    // …and something must have been asked, or "not called" would also be satisfied by a
    // button wired to nothing at all.
    expect(screen.getByText('confirmCancelTitle')).toBeInTheDocument();
    expect(screen.getByText('confirmCancelBody')).toBeInTheDocument();
  });

  it('cancels the booking only once the dialog is confirmed', async () => {
    renderCancellable();

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    const form = screen.getByRole('button', { name: 'confirmCancelCta' }).closest('form');
    if (!form) throw new Error('confirm form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(cancelBookingAction).toHaveBeenCalledTimes(1));
    const call = vi.mocked(cancelBookingAction).mock.calls[0];
    expect(call[0]).toBe('demo');
    expect((call[2] as FormData).get('bookingId')).toBe('b1');
  });

  /**
   * "Keep my seat" must not be the trigger's word. Both controls answering to `cancel` is
   * the degenerate "Vazgeç / Vazgeç" the brief rules out, and it is a regression ONE
   * CHARACTER EDIT produces (`dismissLabel={t('cancel')}`) — so it is asserted at the call
   * site and not only inside `ConfirmDialog`.
   *
   * The negative is what kills it, and it works because Base UI marks the page behind an
   * open dialog `aria-hidden` + inert: the row's own Cancel button leaves the accessibility
   * tree while the dialog is up, so the ONLY way a control named `cancel` can be found here
   * is if the dismiss control is the one carrying that name.
   */
  it('offers a dismiss control whose name is not the trigger\'s', () => {
    renderCancellable();

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));

    expect(screen.getByRole('button', { name: 'confirmCancelKeep' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'cancel' })).not.toBeInTheDocument();
  });

  it('does not cancel when the member keeps their seat', () => {
    renderCancellable();

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'confirmCancelKeep' }));

    expect(cancelBookingAction).not.toHaveBeenCalled();
  });

  /** No trigger at all when the club has closed cancellation, so no gate to open either. */
  it('renders no cancel control when the row cannot be cancelled', () => {
    renderCancellable({ canCancel: false });

    expect(screen.queryByRole('button', { name: 'cancel' })).not.toBeInTheDocument();
    expect(screen.getByText('cancelClosed')).toBeInTheDocument();
  });
});

/**
 * Both sections used to render ONE string, `booking.none`. The regression these tests
 * exist against is a collapse back to that: the same words under both headings, or an
 * Upcoming state that offers no way out of itself.
 */
describe('the empty states', () => {
  it('offers a route to /book when there is nothing upcoming', () => {
    render(<BookingsList slug="demo" upcoming={[]} past={[row()]} timeZone="Europe/Istanbul" />);

    expect(screen.getByText('emptyUpcomingTitle')).toBeInTheDocument();
    expect(screen.getByText('emptyUpcomingBody')).toBeInTheDocument();
    // The PUBLIC tenant path. `/s/demo/book` here would be the bug this repo keeps
    // re-introducing — the slug lives in the hostname.
    expect(screen.getByRole('link', { name: 'emptyUpcomingCta' })).toHaveAttribute('href', '/book');
  });

  /**
   * And the Past section deliberately has none: there is no action that produces a past
   * booking. Asserted by counting links across a render where BOTH sections are empty —
   * with one CTA in the document, a second would make this two.
   */
  it('offers no action for an empty Past section', () => {
    render(<BookingsList slug="demo" upcoming={[]} past={[]} timeZone="Europe/Istanbul" />);

    expect(screen.getByText('emptyPastTitle')).toBeInTheDocument();
    expect(screen.getByText('emptyPastBody')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  /**
   * The two states are distinct keys, not one string rendered twice. `getByText` (not
   * `getAllByText`) is doing the work: were both sections pointed at the same key, each
   * lookup would match two nodes and throw.
   */
  it('says something different under each heading', () => {
    render(<BookingsList slug="demo" upcoming={[]} past={[]} timeZone="Europe/Istanbul" />);

    expect(screen.getByText('emptyUpcomingTitle')).toBeInTheDocument();
    expect(screen.getByText('emptyPastTitle')).toBeInTheDocument();
    expect(screen.queryByText('none')).not.toBeInTheDocument();
  });
});
