// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../../messages/en.json';
import tr from '../../../../messages/tr.json';

// Keys are asserted on directly rather than resolved through the real catalogs — this
// test is about which control renders and when it submits, not about copy. The
// catalogs are checked separately below.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => ({ transferOwnershipAction: vi.fn() }));

import { toast } from 'sonner';

import { transferOwnershipAction } from './actions';
import { TransferOwner } from './transfer-owner';

const candidates = [
  { userId: 'u1', name: 'Ada', email: 'ada@example.com' },
  { userId: 'u2', name: 'Bora', email: 'bora@example.com' },
];

describe('TransferOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transferOwnershipAction).mockResolvedValue({ ok: true });
  });

  // Ownership transfer demotes a real person and cannot be undone except by another
  // transfer. This codebase has already lost real data to a double-click on an
  // unconfirmed Remove, so the dialog must name BOTH the incoming owner and the club:
  // an admin working through a list of clubs must not be able to reassign the wrong
  // one from muscle memory.
  it('confirms with both the new owner and the club named before submitting', async () => {
    render(<TransferOwner clubId="c1" clubName="Boğaziçi" candidates={candidates} />);

    fireEvent.change(screen.getByLabelText('transferSelect'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'transferCta' }));

    expect(transferOwnershipAction).not.toHaveBeenCalled();
    expect(await screen.findByText('confirmTransferTitle:{"name":"Bora","club":"Boğaziçi"}')).toBeInTheDocument();
  });

  // The confirm carries its own label, distinct from the trigger's: two controls with
  // one accessible name means neither this test nor a screen-reader user can tell
  // "open the confirmation" from "do it".
  it('submits the selected candidate once confirmed', async () => {
    render(<TransferOwner clubId="c1" clubName="Boğaziçi" candidates={candidates} />);

    fireEvent.change(screen.getByLabelText('transferSelect'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'transferCta' }));
    fireEvent.click(await screen.findByRole('button', { name: 'confirmTransferCta' }));

    await waitFor(() => expect(transferOwnershipAction).toHaveBeenCalled());
    const formData = vi.mocked(transferOwnershipAction).mock.calls[0]?.at(-1) as FormData;
    expect(formData.get('toUserId')).toBe('u2');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('transferred'));
  });

  it('renders the empty state instead of a control when nobody is eligible', () => {
    render(<TransferOwner clubId="c1" clubName="Boğaziçi" candidates={[]} />);
    expect(screen.getByText('transferNoCandidates')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'transferCta' })).not.toBeInTheDocument();
  });

  // Both refusals come from server-side guards and can never succeed on a retry, so
  // they are reported verbatim instead of as the generic "try again".
  it.each([
    ['target_not_member', 'transferErrorNotMember'],
    ['already_owner', 'transferErrorAlreadyOwner'],
    ['failed', 'actionError'],
  ] as const)('reports %s distinctly', async (error, message) => {
    vi.mocked(transferOwnershipAction).mockResolvedValue({ ok: false, error });
    render(<TransferOwner clubId="c1" clubName="Boğaziçi" candidates={candidates} />);

    fireEvent.click(screen.getByRole('button', { name: 'transferCta' }));
    fireEvent.click(await screen.findByRole('button', { name: 'confirmTransferCta' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('club detail message catalogs', () => {
  // Turkish is the app default, so an English-only key ships as a missing-message
  // warning to every real user.
  it.each([['en', en], ['tr', tr]] as const)('%s carries the club-detail keys', (_locale, messages) => {
    for (const key of [
      'detailBack', 'detailOwners', 'detailNoOwner', 'detailMembers', 'detailMemberBreakdown',
      'detailBoats', 'detailWindows', 'detailReviewedBy', 'detailReviewNote', 'detailRecentAudit',
      'transferTitle', 'transferSelect', 'transferCta', 'transferNoCandidates',
      'confirmTransferTitle', 'confirmTransferBody', 'confirmTransferCta', 'transferred',
      'transferErrorNotMember', 'transferErrorAlreadyOwner', 'statusRejected', 'cancel',
    ] as const) {
      expect(messages.admin[key]).toBeTruthy();
    }
  });

  // The confirmation is only a second decision if it says WHICH club and WHO — a
  // catalog that drops either placeholder silently turns it back into "are you sure?".
  it.each([['en', en], ['tr', tr]] as const)('%s interpolates both the club and the new owner', (_locale, messages) => {
    expect(messages.admin.confirmTransferTitle).toContain('{name}');
    expect(messages.admin.confirmTransferTitle).toContain('{club}');
    expect(messages.admin.detailReviewedBy).toContain('{name}');
  });
});
