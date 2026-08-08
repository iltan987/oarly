// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import tr from '../../../messages/tr.json';

// Keys are asserted on directly rather than resolved through the real catalogs — this
// test is about which control renders and when it submits, not about copy. The
// catalogs are checked separately below.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('./actions', () => ({ setPlatformAdminAction: vi.fn() }));

import { toast } from 'sonner';

import { setPlatformAdminAction } from './actions';
import { AdminToggle } from './admin-toggle';

describe('AdminToggle', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not submit until the confirmation dialog is confirmed', async () => {
    vi.mocked(setPlatformAdminAction).mockResolvedValue({ ok: true, isAdmin: true });
    render(<AdminToggle userId="u1" userName="Ada" isAdmin={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'usersGrant' }));
    expect(setPlatformAdminAction).not.toHaveBeenCalled();

    // The dialog must name the subject — a bare "Are you sure?" is what let a
    // misclick hit the wrong row before.
    expect(await screen.findByText('confirmGrantTitle:{"name":"Ada"}')).toBeInTheDocument();

    // The confirm carries its own label, distinct from the trigger's: two controls
    // with one accessible name means neither this test nor a screen-reader user can
    // tell "open the confirmation" from "do it".
    fireEvent.click(screen.getByRole('button', { name: 'confirmGrantCta' }));
    await waitFor(() => expect(setPlatformAdminAction).toHaveBeenCalled());
  });

  it('names the subject in the revoke confirmation', async () => {
    render(<AdminToggle userId="u1" userName="Ada" isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'usersRevoke' }));
    expect(await screen.findByText('confirmRevokeTitle:{"name":"Ada"}')).toBeInTheDocument();
  });

  // Both refusals are server-side guards; folding them into the generic "try again"
  // tells the operator to retry something that can never succeed.
  it.each([
    ['self_revoke', 'usersErrorSelfRevoke'],
    ['last_admin', 'usersErrorLastAdmin'],
  ] as const)('reports %s distinctly from a generic failure', async (error, message) => {
    vi.mocked(setPlatformAdminAction).mockResolvedValue({ ok: false, error });
    render(<AdminToggle userId="u1" userName="Ada" isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'usersRevoke' }));
    fireEvent.click(await screen.findByRole('button', { name: 'confirmRevokeCta' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(toast.error).not.toHaveBeenCalledWith('actionError');
  });
});

describe('admin user message catalogs', () => {
  // Turkish is the app default, so an English-only key ships as a missing-message
  // warning to every real user.
  it.each([['en', en], ['tr', tr]] as const)('%s carries the users-page keys', (_locale, messages) => {
    for (const key of [
      'usersSearch', 'usersSearchCta', 'usersEmpty', 'usersAdminBadge', 'usersGrant', 'usersRevoke',
      'usersNoMemberships', 'usersGranted', 'usersRevoked', 'usersErrorSelfRevoke', 'usersErrorLastAdmin',
      'confirmGrantTitle', 'confirmGrantBody', 'confirmGrantCta', 'confirmRevokeTitle', 'confirmRevokeBody',
      'confirmRevokeCta', 'cancel', 'paginationPrev', 'paginationNext', 'paginationRange',
    ] as const) {
      expect(messages.admin[key]).toBeTruthy();
    }
  });

  it.each([['en', en], ['tr', tr]] as const)('%s interpolates the subject name into both confirmations', (_locale, messages) => {
    expect(messages.admin.confirmGrantTitle).toContain('{name}');
    expect(messages.admin.confirmRevokeTitle).toContain('{name}');
  });
});
