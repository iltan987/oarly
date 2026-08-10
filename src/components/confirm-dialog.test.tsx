// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './confirm-dialog';

/**
 * React entangles in-flight async actions on a module-global lane, so a promise left
 * unresolved when a test ends blocks state updates in every LATER test in this file — and
 * it survives React Testing Library's per-test unmount, turning one real failure into a
 * cascade of unrelated ones. Tests that defer an action push their resolver here as well
 * as calling it themselves; resolving twice is a no-op, so the net is free.
 */
const pendingResolvers: Array<() => void> = [];

afterEach(() => {
  pendingResolvers.splice(0).forEach((r) => r());
});

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
  action?: (formData: FormData) => void | Promise<void>;
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

  /**
   * `DialogContent`'s X button's ONLY accessible name is a hardcoded English "Close"
   * (`ui/dialog.tsx:75`), in a directory that is CLI-owned and cannot be hand-translated.
   * On a Turkish-default app that is the one English word in the flow, and it is on the
   * dialog that can cost a member their seat. `showCloseButton={false}` is the fix that
   * needs no `ui/` edit — asserted by NAME, so it fails the moment the control returns.
   */
  it('ships no English "Close" control into a translated dialog', () => {
    render(<Harness />);

    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    // Nothing else on the dialog carries the word either — the sr-only span is inside the
    // button, so a name query alone would miss a stray copy of it elsewhere.
    expect(screen.queryByText('Close')).not.toBeInTheDocument();
    // …and the two translated controls are still both there, so "no Close button" is not
    // being satisfied by a dialog that rendered no footer at all.
    expect(screen.getByRole('button', { name: 'Keep my seat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Give up my seat' })).toBeInTheDocument();
  });

  /**
   * `DialogFooter` is `flex-col-reverse` below `sm:`, so the FIRST DOM child renders at the
   * bottom of the stacked mobile layout and the last renders on top. The destructive button
   * must therefore come first in the DOM, or a phone puts it directly under the body text —
   * the first control the eye and thumb reach after reading what is about to happen.
   *
   * jsdom computes no layout, so this asserts the two halves that decide it: document order,
   * and the `sm:order-*` classes that put the row back into dismiss-left / confirm-right at
   * desktop widths. The rendered stack itself was checked in Chrome at 320px.
   */
  it('puts the destructive control first in the DOM, so the stacked mobile footer offers the safe one first', () => {
    render(<Harness />);

    const confirm = screen.getByRole('button', { name: 'Give up my seat' });
    const dismiss = screen.getByRole('button', { name: 'Keep my seat' });
    expect(confirm.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The desktop half. Without these the swap above would also reverse the horizontal row.
    expect(confirm).toHaveClass('sm:order-2');
    expect(dismiss).toHaveClass('sm:order-1');
  });

  /**
   * The body sentence is the whole justification for the extra tap, and a bare `<p>`
   * registers no id — the popup's `aria-describedby` comes back `undefined` and a screen
   * reader announces the title alone. Asserted by FOLLOWING the reference to the element it
   * names, not by checking the attribute exists: an id pointing at nothing would satisfy the
   * weaker assertion and read the same as no description at all.
   */
  it('wires the description into the popup\'s accessible description', () => {
    render(<Harness />);

    const popup = document.querySelector('[data-slot="dialog-content"]');
    expect(popup).not.toBeNull();
    const describedBy = popup!.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('Your seat goes to the first person waiting.');
  });

  /**
   * "Keep my seat" is a promise, and once the confirm is dispatched it is already false —
   * the seat is going. A control that offers to undo what it cannot must not be clickable.
   *
   * The deferred action is drained by the module-level `afterEach`: an unresolved promise
   * left behind blocks React's shared transition lane and turns one real failure into
   * several bogus ones in later tests.
   */
  it('disables the dismiss control once the confirm is in flight', async () => {
    let resolve: (() => void) | undefined;
    const action = vi.fn(() => new Promise<void>((r) => { resolve = r; pendingResolvers.push(r); }));
    render(<Harness action={action} />);

    const form = screen.getByRole('button', { name: 'Give up my seat' }).closest('form');
    if (!form) throw new Error('confirm form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep my seat' })).toBeDisabled());

    resolve?.();
  });

  it('does not dispatch the action when the dismiss control is used', () => {
    const action = vi.fn();
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole('button', { name: 'Keep my seat' }));

    expect(action).not.toHaveBeenCalled();
  });
});
