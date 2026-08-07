// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The translation keys are asserted on directly (with interpolated values appended)
// rather than resolved through real message files — this test is about wiring, not copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('./actions', () => ({
  ownerAddBookingAction: vi.fn(),
  ownerRemoveBookingAction: vi.fn(),
}));

vi.mock('./attendance-actions', () => ({
  markNoShowAction: vi.fn(),
  undoNoShowAction: vi.fn(),
}));

import { ownerRemoveBookingAction } from './actions';
import { undoNoShowAction } from './attendance-actions';
import { BookingsRoster, type RosterSessionWithPenalty } from './bookings-roster';

function makeSession(overrides: Partial<RosterSessionWithPenalty> = {}): RosterSessionWithPenalty {
  return {
    sessionId: 's1',
    windowId: 'w1',
    startAt: new Date('2020-01-01T00:00:00Z'),
    endAt: new Date('2020-01-01T01:00:00Z'),
    boatTypeId: 'bt1',
    boatName: 'Test boat',
    capacity: 4,
    status: 'open',
    seated: [
      { bookingId: 'b1', name: 'Alice', paymentType: 'regular', queuePosition: null, status: 'booked' },
      { bookingId: 'b2', name: 'Bob', paymentType: 'regular', queuePosition: null, status: 'booked' },
    ],
    waitlisted: [],
    freeSeats: 0,
    waitlistCapacity: null,
    banEndsAt: null,
    banPermanent: false,
    banLapsed: false,
    ...overrides,
  };
}

function submitRemoveDialog() {
  const cta = screen.getByRole('button', { name: /confirmRemoveCta/ });
  const form = cta.closest('form');
  if (!form) throw new Error('confirm form not found');
  fireEvent.submit(form);
}

describe('BookingsRoster remove flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clicking Remove opens a confirmation naming the member and does not dispatch the action', () => {
    render(<BookingsRoster slug="club" sessions={[makeSession()]} timezone="UTC" />);

    const removeButtons = screen.getAllByRole('button', { name: 'remove' });
    fireEvent.click(removeButtons[0]);

    expect(screen.getByText(/confirmRemoveTitle/)).toHaveTextContent('Alice');
    expect(ownerRemoveBookingAction).not.toHaveBeenCalled();
  });

  it('confirming dispatches the remove action with the correct bookingId', async () => {
    vi.mocked(ownerRemoveBookingAction).mockResolvedValue({ ok: true });
    render(<BookingsRoster slug="club" sessions={[makeSession()]} timezone="UTC" />);

    fireEvent.click(screen.getAllByRole('button', { name: 'remove' })[0]);
    submitRemoveDialog();

    await waitFor(() => expect(ownerRemoveBookingAction).toHaveBeenCalledTimes(1));
    const call = vi.mocked(ownerRemoveBookingAction).mock.calls[0];
    expect(call[0]).toBe('club');
    expect((call[2] as FormData).get('bookingId')).toBe('b1');
  });

  // The shared-pending regression this whole task exists to fix: removing one
  // member must not grey out (or otherwise disable) another member's Remove control.
  it('keeps another row\'s Remove control enabled while one removal is in flight', async () => {
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(ownerRemoveBookingAction).mockImplementation(
      () => new Promise((r) => { resolve = r; }),
    );

    render(<BookingsRoster slug="club" sessions={[makeSession()]} timezone="UTC" />);

    fireEvent.click(screen.getAllByRole('button', { name: 'remove' })[0]);
    submitRemoveDialog();

    // The dialog's own submit closed and unmounted, but the action is still in flight.
    await waitFor(() => expect(ownerRemoveBookingAction).toHaveBeenCalledTimes(1));

    const rowButtons = screen.getAllByRole('button', { name: 'remove' });
    expect(rowButtons).toHaveLength(2);
    expect(rowButtons[1]).not.toBeDisabled();

    resolve?.({ ok: true });
  });

  // Base UI's Dialog portals the confirm form out of the row's DOM subtree, so this
  // CSS trick only applies to in-row (non-portalled) submits like undo-absent.
  it('carries has-data-pending:opacity-40 on the seated row so an in-flight undo dims it', async () => {
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(undoNoShowAction).mockImplementation(
      () => new Promise((r) => { resolve = r; }),
    );

    const session = makeSession({
      seated: [{ bookingId: 'b1', name: 'Alice', paymentType: 'regular', queuePosition: null, status: 'no_show' }],
    });
    render(<BookingsRoster slug="club" sessions={[session]} timezone="UTC" />);

    const row = screen.getByText('Alice').closest('li');
    expect(row).not.toBeNull();
    expect(row).toHaveClass('has-data-pending:opacity-40');

    const undoButton = screen.getByRole('button', { name: 'undoAbsent' });
    const form = undoButton.closest('form');
    if (!form) throw new Error('undo form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(undoButton).toHaveAttribute('data-pending'));

    resolve?.({ ok: true });
  });
});
