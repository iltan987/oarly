// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keys are asserted on directly rather than resolved through the real message files —
// this test is about which message the branch picks, not about copy. Interpolation is
// spelled out so a confirm that fails to name its club is visible in the assertion.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('./actions', () => ({ setClubStatusAction: vi.fn() }));

import { toast } from 'sonner';

import { setClubStatusAction } from './actions';
import { ClubStatusButton } from './club-status-button';

describe('ClubStatusButton result handling', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /** Suspend now opens a confirm; submitting means submitting the dialog's form. */
  function submitSuspend() {
    render(<ClubStatusButton clubId="c1" clubName="Bebek Kürek" targetStatus="suspended" label="suspend" />);
    fireEvent.click(screen.getByRole('button', { name: 'suspend' }));
    fireEvent.submit(screen.getByRole('button', { name: 'confirmSuspendCta' }).closest('form')!);
  }

  // `not_decided` means the row is `pending` or `rejected` — the page this button lives
  // on is stale, and retrying will never work. Folding it into the generic "Try again"
  // tells the admin the opposite of the truth.
  it('reports a refused transition distinctly from a generic failure', async () => {
    vi.mocked(setClubStatusAction).mockResolvedValue({ ok: false, error: 'not_decided' });
    submitSuspend();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('errorNotDecided'));
    expect(toast.error).not.toHaveBeenCalledWith('actionError');
  });

  it('still reports an unexpected failure generically', async () => {
    vi.mocked(setClubStatusAction).mockResolvedValue({ ok: false, error: 'failed' });
    submitSuspend();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('actionError'));
  });

  it('reports success', async () => {
    vi.mocked(setClubStatusAction).mockResolvedValue({ ok: true, status: 'suspended' });
    submitSuspend();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('suspended2'));
  });
});

/**
 * Suspending 404s every `/s/[slug]/*` page and refuses every server action for every
 * member AND the owner — one click on a 25-row list takes a whole tenant offline. It
 * was the only destructive control in the console with no confirmation, on two
 * surfaces. Reinstating restores service and deliberately keeps its single click.
 */
describe('ClubStatusButton confirmation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not call the action until the suspend confirmation is submitted', () => {
    render(<ClubStatusButton clubId="c1" clubName="Bebek Kürek" targetStatus="suspended" label="suspend" />);
    // No dialog before the trigger is pressed.
    expect(screen.queryByRole('button', { name: 'confirmSuspendCta' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'suspend' }));
    expect(setClubStatusAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'confirmSuspendCta' })).toBeInTheDocument();
  });

  it('names the club in the confirmation', () => {
    render(<ClubStatusButton clubId="c1" clubName="Bebek Kürek" targetStatus="suspended" label="suspend" />);
    fireEvent.click(screen.getByRole('button', { name: 'suspend' }));
    expect(screen.getByText('confirmSuspendTitle:Bebek Kürek')).toBeInTheDocument();
  });

  it('gives the confirm its own accessible name rather than repeating the trigger', () => {
    render(<ClubStatusButton clubId="c1" clubName="Bebek Kürek" targetStatus="suspended" label="suspend" />);
    fireEvent.click(screen.getByRole('button', { name: 'suspend' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'confirmSuspendCta' })).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'suspend' })).toBeNull();
  });

  it('sends the suspend request only after the confirmation', async () => {
    vi.mocked(setClubStatusAction).mockResolvedValue({ ok: true, status: 'suspended' });
    render(<ClubStatusButton clubId="c1" clubName="Bebek Kürek" targetStatus="suspended" label="suspend" />);
    fireEvent.click(screen.getByRole('button', { name: 'suspend' }));
    fireEvent.submit(screen.getByRole('button', { name: 'confirmSuspendCta' }).closest('form')!);
    await waitFor(() => expect(setClubStatusAction).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(setClubStatusAction).mock.calls[0][1];
    expect(formData.get('clubId')).toBe('c1');
    expect(formData.get('status')).toBe('suspend');
  });

  it('leaves Activate as a single click — it restores service, it does not destroy anything', async () => {
    vi.mocked(setClubStatusAction).mockResolvedValue({ ok: true, status: 'active' });
    render(<ClubStatusButton clubId="c1" clubName="Bebek Kürek" targetStatus="active" label="activate" />);
    expect(screen.queryByRole('button', { name: 'confirmSuspendCta' })).toBeNull();
    fireEvent.submit(screen.getByRole('button', { name: 'activate' }).closest('form')!);
    await waitFor(() => expect(setClubStatusAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(setClubStatusAction).mock.calls[0][1].get('status')).toBe('active');
  });
});
