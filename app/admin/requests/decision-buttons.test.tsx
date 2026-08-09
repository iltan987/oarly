// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import tr from '../../../messages/tr.json';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Mocked, not stubbed away: importing the real module pulls `@/lib/session` ->
// `src/auth.ts`, which reads server-only env at module load and takes the whole file
// down with zero tests run — a "failure" that would look like a killed mutation while
// proving nothing.
vi.mock('./actions', () => ({ decideClubRequestAction: vi.fn() }));

import { decideClubRequestAction } from './actions';
import { DecisionButtons } from './decision-buttons';

// A real uuid, because `clubs.id` is a `uuid` column and the page only ever renders
// ids it read back out of it. A fixture like `c1` is a value the production page
// cannot serve, so a suite built on one validates a fiction.
const clubId = randomUUID();

describe('DecisionButtons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A VALID state, not an unset `vi.fn()` returning `undefined`. If the action is
    // ever called when it should not be, the failure has to be the
    // `not.toHaveBeenCalled()` assertion below — an undefined action result instead
    // crashes the component on `state.ok`, which kills the mutation for a reason that
    // says nothing about the confirmation being gone.
    vi.mocked(decideClubRequestAction).mockResolvedValue({ ok: true, decision: 'approve' });
  });

  it('names the club in the approve confirmation and does not submit before it', async () => {
    render(<DecisionButtons clubId={clubId} clubName="Boğaziçi" />);
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    expect(decideClubRequestAction).not.toHaveBeenCalled();
    expect(await screen.findByText('confirmApproveTitle:{"club":"Boğaziçi"}')).toBeInTheDocument();
  });

  it('names the club in the reject confirmation and requires a note', async () => {
    render(<DecisionButtons clubId={clubId} clubName="Boğaziçi" />);
    fireEvent.click(screen.getByRole('button', { name: 'reject' }));
    expect(decideClubRequestAction).not.toHaveBeenCalled();
    expect(await screen.findByText('confirmRejectTitle:{"club":"Boğaziçi"}')).toBeInTheDocument();
    // `rejected` is terminal — `setClubStatus` refuses it, so there is no un-reject
    // path at any layer — and the note is what the requester's email says. The field
    // is `required`, so an empty reject cannot even be submitted.
    expect(screen.getByLabelText('rejectNote')).toBeRequired();
  });

  // Approving is optional-note, and marking it `required` too would be a silent
  // usability regression that no other assertion here would catch.
  it('does not require a note to approve', async () => {
    render(<DecisionButtons clubId={clubId} clubName="Boğaziçi" />);
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    expect(await screen.findByLabelText('approveNote')).not.toBeRequired();
  });

  // The decision travels to the server action in the form, and approve/reject differ
  // ONLY by this field: getting it wrong would silently reject everything an admin
  // meant to approve, with a correct-looking confirmation dialog above it.
  it.each([
    ['approve', 'confirmApproveCta'],
    ['reject', 'confirmRejectCta'],
  ] as const)('submits decision=%s with the club id', async (decision, cta) => {
    const { container } = render(<DecisionButtons clubId={clubId} clubName="Boğaziçi" />);
    fireEvent.click(screen.getByRole('button', { name: decision }));
    await screen.findByRole('button', { name: cta });

    expect(container.ownerDocument.querySelector<HTMLInputElement>('input[name="decision"]')?.value).toBe(decision);
    expect(container.ownerDocument.querySelector<HTMLInputElement>('input[name="clubId"]')?.value).toBe(clubId);
  });

  // The confirm carries its own label rather than repeating the trigger's: two controls
  // sharing one accessible name is how an "are you sure?" stops being a second
  // decision, and it is what would make every `getByRole('button', { name: 'reject' })`
  // above ambiguous about which half it matched.
  it('gives the confirm button a name of its own, not the trigger\'s', async () => {
    render(<DecisionButtons clubId={clubId} clubName="Boğaziçi" />);
    fireEvent.click(screen.getByRole('button', { name: 'reject' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'confirmRejectCta' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'reject' })).toBeNull();
  });
});

describe('decision message catalogs', () => {
  // Turkish is the app default, so an English-only key ships as a missing-message
  // warning to every real user — and the mock above would never notice.
  const keys = [
    'approve', 'reject', 'approveNote', 'rejectNote',
    'confirmApproveTitle', 'confirmApproveBody', 'confirmApproveCta',
    'confirmRejectTitle', 'confirmRejectBody', 'confirmRejectCta',
    'approved', 'rejected', 'errorNoteRequired', 'errorNotPending',
    'requestBy', 'requestByUnknown', 'clubsSearch', 'clubsSearchCta', 'clubsMemberCount',
  ] as const;

  it.each([['en', en], ['tr', tr]] as const)('%s carries the decision keys', (_locale, messages) => {
    // Collected rather than asserted one at a time, so a failure names every key that
    // is missing instead of only the first.
    expect(keys.filter((key) => !messages.admin[key])).toEqual([]);
  });
});
