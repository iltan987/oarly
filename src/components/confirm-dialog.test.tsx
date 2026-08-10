// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './confirm-dialog';

/**
 * Every label is a REQUIRED prop with no default, so "a missing label is a type error" is
 * enforced by `tsc`, not by a runtime assertion — there is nothing to render if a caller
 * omits one. What this file can assert is the consequence: the four strings a caller hands
 * over are the four strings that appear, and the two footer controls do not collapse into
 * one accessible name.
 */

function Harness({
  action = vi.fn(),
  onSubmit,
  hidden,
  children,
  dismissLabel = 'Keep my seat',
  confirmLabel = 'Give up my seat',
  startOpen = true,
}: {
  action?: (formData: FormData) => void;
  onSubmit?: () => void;
  hidden?: Record<string, string>;
  children?: React.ReactNode;
  dismissLabel?: string;
  confirmLabel?: string;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>reopen</button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Give up your seat?"
        description="Your seat goes to the first person waiting."
        confirmLabel={confirmLabel}
        dismissLabel={dismissLabel}
        destructive
        action={action}
        onSubmit={onSubmit}
        hidden={hidden}
      >
        {children}
      </ConfirmDialog>
    </>
  );
}

describe('ConfirmDialog', () => {
  it('renders the caller\'s title, description and both labels', () => {
    render(<Harness />);

    expect(screen.getByText('Give up your seat?')).toBeInTheDocument();
    expect(screen.getByText('Your seat goes to the first person waiting.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep my seat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Give up my seat' })).toBeInTheDocument();
  });

  /**
   * The rule from `decision-buttons.tsx:80-81`, asserted as the property rather than as
   * two literal strings: whatever the two labels are, they must not resolve to the same
   * accessible name. Written by NAME LOOKUP, not by comparing the props — passing the same
   * label twice makes `getAllByRole` return two nodes, and that is the failure.
   */
  it('gives the dismiss and confirm controls distinct accessible names', () => {
    render(<Harness />);

    const dismiss = screen.getByRole('button', { name: 'Keep my seat' });
    const confirm = screen.getByRole('button', { name: 'Give up my seat' });
    expect(dismiss).not.toBe(confirm);
    // …and neither name is ambiguous within the dialog: two controls answering to one
    // name is the degenerate "Cancel / Cancel" this component exists to prevent.
    expect(screen.getAllByRole('button', { name: 'Keep my seat' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Give up my seat' })).toHaveLength(1);
  });

  it('renders nothing at all while closed', () => {
    render(<Harness startOpen={false} />);

    expect(screen.queryByText('Give up your seat?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Give up my seat' })).not.toBeInTheDocument();
  });

  /**
   * The mount-only-while-open rule, stated as the thing a member can actually observe: a
   * value typed into an extra field must not survive a close and reopen.
   *
   * **This test does not kill the `{open && …}` gate, and no test in jsdom can.** Base UI's
   * `Dialog.Portal` is `keepMounted={false}`, so it discards the subtree on close by
   * itself; run against a build with the gate deleted, every test in this file still
   * passes — checked, not assumed, including a synchronous check immediately after the
   * close (jsdom runs no animations, so there is no exit window in which the un-gated
   * form would linger). It is kept because it pins the OBSERVABLE contract callers rely
   * on — fresh children on every open — rather than the mechanism that currently
   * delivers it, and it is what would fail if `DialogPortal` ever gained `keepMounted`.
   */
  it('gives the children a fresh mount on every open', async () => {
    render(<Harness><input name="note" defaultValue="" aria-label="note" /></Harness>);

    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'typed into an abandoned dialog' } });
    expect(screen.getByLabelText('note')).toHaveValue('typed into an abandoned dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Keep my seat' }));
    await waitFor(() => expect(screen.queryByLabelText('note')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'reopen' }));
    await waitFor(() => expect(screen.getByLabelText('note')).toBeInTheDocument());
    expect(screen.getByLabelText('note')).toHaveValue('');
  });

  it('submits the hidden fields and the children as one FormData, after running onSubmit', async () => {
    const action = vi.fn();
    const onSubmit = vi.fn(() => {
      // The bridge documented in `bookings-roster.tsx:43-53` runs on the submitting
      // frame — before the action, not after it resolves.
      expect(action).not.toHaveBeenCalled();
    });
    render(
      <Harness action={action} onSubmit={onSubmit} hidden={{ bookingId: 'b1' }}>
        <input name="note" defaultValue="because" aria-label="note" />
      </Harness>,
    );

    const form = screen.getByRole('button', { name: 'Give up my seat' }).closest('form');
    if (!form) throw new Error('confirm form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const data = action.mock.calls[0][0];
    expect(data.get('bookingId')).toBe('b1');
    expect(data.get('note')).toBe('because');
  });

  it('does not dispatch the action when the dismiss control is used', () => {
    const action = vi.fn();
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole('button', { name: 'Keep my seat' }));

    expect(action).not.toHaveBeenCalled();
  });
});
