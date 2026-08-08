// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keys are asserted on directly rather than resolved through the real message files —
// this test is about which message the branch picks, not about copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('./actions', () => ({ setClubStatusAction: vi.fn() }));

import { toast } from 'sonner';

import { setClubStatusAction } from './actions';
import { ClubStatusButton } from './club-status-button';

describe('ClubStatusButton result handling', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function submit() {
    render(<ClubStatusButton clubId="c1" targetStatus="suspended" label="suspend" />);
    fireEvent.submit(screen.getByRole('button', { name: 'suspend' }).closest('form')!);
  }

  // `not_decided` means the row is `pending` or `rejected` — the page this button lives
  // on is stale, and retrying will never work. Folding it into the generic "Try again"
  // tells the admin the opposite of the truth.
  it('reports a refused transition distinctly from a generic failure', async () => {
    vi.mocked(setClubStatusAction).mockResolvedValue({ ok: false, error: 'not_decided' });
    submit();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('errorNotDecided'));
    expect(toast.error).not.toHaveBeenCalledWith('actionError');
  });

  it('still reports an unexpected failure generically', async () => {
    vi.mocked(setClubStatusAction).mockResolvedValue({ ok: false, error: 'failed' });
    submit();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('actionError'));
  });

  it('reports success', async () => {
    vi.mocked(setClubStatusAction).mockResolvedValue({ ok: true, status: 'suspended' });
    submit();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('suspended2'));
  });
});
