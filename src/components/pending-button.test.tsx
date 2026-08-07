// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useActionState } from 'react';
import { describe, expect, it } from 'vitest';

import { PendingButton } from '@/components/pending-button';

/** Two forms sharing ONE useActionState dispatch — the shape used by bookings-roster. */
function TwoRows({ release }: { release: { fn: (() => void) | null } }) {
  const [, action] = useActionState(async () => {
    await new Promise<void>((r) => { release.fn = r; });
    return null;
  }, null);
  return (
    <>
      <form action={action} data-testid="form-a"><PendingButton>Remove A</PendingButton></form>
      <form action={action} data-testid="form-b"><PendingButton>Remove B</PendingButton></form>
    </>
  );
}

describe('PendingButton', () => {
  it('disables and marks only the submitted form pending', async () => {
    const release = { fn: null as (() => void) | null };
    render(<TwoRows release={release} />);
    const a = screen.getByRole('button', { name: /Remove A/ });
    const b = screen.getByRole('button', { name: /Remove B/ });

    fireEvent.submit(screen.getByTestId('form-a'));

    await waitFor(() => expect(a).toBeDisabled());
    expect(a).toHaveAttribute('data-pending');
    // The regression that matters: row B must stay usable while row A is in flight.
    expect(b).not.toBeDisabled();
    expect(b).not.toHaveAttribute('data-pending');

    release.fn?.();
    await waitFor(() => expect(a).not.toBeDisabled());
    expect(a).not.toHaveAttribute('data-pending');
  });

  it('shows a spinner while pending and keeps the label visible', async () => {
    const release = { fn: null as (() => void) | null };
    render(<TwoRows release={release} />);
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.submit(screen.getByTestId('form-a'));

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    // Label must not be replaced — swapping it would resize the button mid-flight.
    expect(screen.getByRole('button', { name: /Remove A/ })).toBeInTheDocument();
    release.fn?.();
  });

  it('honours a caller-supplied disabled even when idle', () => {
    render(<form><PendingButton disabled>Add</PendingButton></form>);
    expect(screen.getByRole('button', { name: /Add/ })).toBeDisabled();
  });
});
