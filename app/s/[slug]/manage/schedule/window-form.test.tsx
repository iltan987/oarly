// @vitest-environment jsdom
/**
 * A refused window save must not throw away what the owner typed.
 *
 * This form was missed by the first sweep because the sweep enumerated by RESULT TYPE —
 * `saveWindowAction` returns `WindowFormState`, not `ManageActionResult` — and React 19's
 * post-action form reset does not care what an action returns. The shape that matters is an
 * uncontrolled `defaultValue` input inside a `<form action={…}>`, and this form has three of
 * them: startTime, endTime and defaultSessionMinutes.
 *
 * It is over the line by any reading: `end_before_start`, `uneven_tiling` and `overlap` are
 * ordinary owner mistakes — `<input type="time">` does not stop an end before a start, and an
 * 08:00–10:00 window in 45-minute sessions is 120 minutes, which 45 does not divide
 * (`src/lib/schedule.ts:59`) — the form STAYS OPEN showing the error, and all three fields
 * had already snapped back to the stored window by the time the owner read it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ saveWindowAction: vi.fn() }));

import { saveWindowAction, type WindowFormState } from './actions';
import { WindowForm } from './window-form';

const boats = [{ id: 'b1', name: 'Quad' }];
const labels = {
  startTime: 'startTime', endTime: 'endTime', sessionMinutes: 'sessionMinutes',
  boats: 'boats', addBoat: 'addBoat', removeBoat: 'removeBoat', save: 'save', cancel: 'cancel',
  errors: { uneven_tiling: 'Sessions do not tile evenly.', generic: 'generic' } as Record<string, string>,
};
const existing = {
  id: 'w1', startTime: '08:00:00', endTime: '11:00:00', defaultSessionMinutes: 60,
  boats: [{ boatTypeId: 'b1', quantity: 1 }],
};

/** A refusal that echoes what was submitted, exactly as `saveWindowAction` does. */
function refuseEchoingSubmission(error: 'uneven_tiling' | null) {
  vi.mocked(saveWindowAction).mockImplementation(async (_slug, _prev, formData): Promise<WindowFormState> => ({
    status: 'error',
    error,
    values: {
      startTime: String(formData.get('startTime') ?? ''),
      endTime: String(formData.get('endTime') ?? ''),
      defaultSessionMinutes: String(formData.get('defaultSessionMinutes') ?? ''),
    },
  }));
}

/**
 * Submit and wait for the result to be COMMITTED. An uncontrolled field already holds the
 * typed value the moment it is typed, so `waitFor(() => expect(field).toHaveValue(…))` passes
 * before the action has even been called — it would go green with the echo removed.
 */
async function submitAndSettle() {
  await act(async () => {
    const form = document.querySelector('form');
    if (!form) throw new Error('window form not found');
    fireEvent.submit(form);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveWindowAction).mockResolvedValue({ status: 'ok', error: null });
});

describe('WindowForm', () => {
  it('renders real DOM before anything else is asserted about it', () => {
    render(<WindowForm slug="demo" weekday={1} window={existing} boats={boats} labels={labels} onClose={vi.fn()} />);
    expect(screen.getByLabelText('startTime')).toHaveValue('08:00');
    expect(screen.getByLabelText('sessionMinutes')).toHaveValue(60);
  });

  it('keeps all three typed fields after a refusal, next to the error that explains it', async () => {
    refuseEchoingSubmission('uneven_tiling');
    render(<WindowForm slug="demo" weekday={1} window={existing} boats={boats} labels={labels} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('startTime'), { target: { value: '07:30' } });
    fireEvent.change(screen.getByLabelText('endTime'), { target: { value: '10:15' } });
    fireEvent.change(screen.getByLabelText('sessionMinutes'), { target: { value: '45' } });
    await submitAndSettle();

    expect(screen.getByText('Sessions do not tile evenly.')).toBeInTheDocument();
    expect(screen.getByLabelText('startTime')).toHaveValue('07:30');
    expect(screen.getByLabelText('endTime')).toHaveValue('10:15');
    expect(screen.getByLabelText('sessionMinutes')).toHaveValue(45);
  });

  // The generic branch (`error: null`, a zod failure or a malformed id) owes the same echo.
  it('keeps the fields when the refusal carries no specific error', async () => {
    refuseEchoingSubmission(null);
    render(<WindowForm slug="demo" weekday={1} boats={boats} labels={labels} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('startTime'), { target: { value: '06:00' } });
    await submitAndSettle();

    expect(screen.getByText('generic')).toBeInTheDocument();
    expect(screen.getByLabelText('startTime')).toHaveValue('06:00');
  });

  // No remount, for the reason the profile and account forms record: it would preserve the
  // values too, and cost the focused node.
  it('keeps the same form node on a refusal, so focus is not thrown away', async () => {
    refuseEchoingSubmission('uneven_tiling');
    render(<WindowForm slug="demo" weekday={1} window={existing} boats={boats} labels={labels} onClose={vi.fn()} />);

    const field = screen.getByLabelText('startTime');
    const before = field.closest('form');
    fireEvent.change(field, { target: { value: '07:30' } });
    await submitAndSettle();

    expect(screen.getByLabelText('startTime')).toBe(field);
    expect(screen.getByLabelText('startTime').closest('form')).toBe(before);
  });

  // A successful save closes the form, and must keep doing so.
  it('closes on a successful save', async () => {
    const onClose = vi.fn();
    render(<WindowForm slug="demo" weekday={1} window={existing} boats={boats} labels={labels} onClose={onClose} />);

    await submitAndSettle();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
