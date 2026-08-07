// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('./actions', () => ({
  savePoliciesAction: vi.fn(),
}));

import { toast } from 'sonner';

import { savePoliciesAction } from './actions';
import { PoliciesForm } from './policies-form';

const settings = {
  bookingOpenMode: 'always' as const,
  bookingOpenLeadDays: null,
  selfCancelEnabled: true,
  cancelCutoffHours: null,
  noshowPenalty: 'off' as const,
  multisportMode: 'equal' as const,
  openOnHolidays: false,
  waitlistCapacity: null,
};

const labels = {
  save: 'Save', bookingOpen: 'Booking opens', bookingOpenAlways: 'Always open', bookingOpenLead: 'Lead days',
  leadDays: 'Lead days', selfCancel: 'Allow self-cancel', cancelCutoff: 'Cutoff', noshow: 'No-show penalty',
  noshowOff: 'Off', noshow2d: '2 days', noshow1w: '1 week', noshow2w: '2 weeks', noshow1m: '1 month',
  noshowNever: 'Never', multisport: 'MultiSport mode', multisportEqual: 'Equal', multisportPriority: 'Priority',
  multisportHint: 'hint', openOnHolidays: 'Open on holidays', waitlistCapacity: 'Waitlist capacity',
  waitlistCapacityHint: 'hint', errorInvalidLead: 'Enter a valid lead.', errorInvalidInput: 'Check the fields.',
  saved: 'Policies saved.',
};

function submit() {
  const form = document.querySelector('form');
  if (!form) throw new Error('form not found');
  fireEvent.submit(form);
}

describe('PoliciesForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The remount hazard, reproduced with its real timing: `page.tsx` keys the form on
   * `club.updatedAt`, which `$onUpdate` bumps on every write, so the new key arrives
   * WHILE the save is still in flight — the RSC payload and the action's resolution
   * land together. Bumping the `updatedAt` prop after the toast has already fired
   * proves nothing; the whole hazard is that the remount happens first.
   *
   * So: hold the action unresolved, remount the keyed fields, and only then resolve.
   * Move `useActionState` and this toast effect back inside `PoliciesFields` (the
   * original bug) and the remount destroys the hook that is awaiting the result —
   * `toast.success` never fires and this test fails.
   */
  it('reports a save whose revalidation remounts the fields mid-flight', async () => {
    let resolve: ((r: { status: 'ok' }) => void) | undefined;
    vi.mocked(savePoliciesAction).mockImplementation(
      () => new Promise((r) => { resolve = r; }),
    );

    const { rerender } = render(
      <PoliciesForm slug="test-club" updatedAt={1} settings={settings} labels={labels} />,
    );

    submit();
    await waitFor(() => expect(savePoliciesAction).toHaveBeenCalledTimes(1));

    // The revalidated server render arrives before the action settles: new `updatedAt`,
    // new `key`, inner fields unmounted and remounted — mid-flight.
    rerender(<PoliciesForm slug="test-club" updatedAt={2} settings={settings} labels={labels} />);

    resolve?.({ status: 'ok' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith(labels.saved);

    // …and a further remount must not replay it.
    rerender(<PoliciesForm slug="test-club" updatedAt={3} settings={settings} labels={labels} />);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('shows the field-level error for a Zod failure and the lead-day error for the domain failure', async () => {
    vi.mocked(savePoliciesAction).mockResolvedValueOnce({ status: 'error', cause: 'invalid_input' });

    const { unmount } = render(<PoliciesForm slug="test-club" updatedAt={1} settings={settings} labels={labels} />);
    submit();

    await waitFor(() => expect(screen.getByText(labels.errorInvalidInput)).toBeInTheDocument());
    expect(toast.error).toHaveBeenCalledWith(labels.errorInvalidInput);
    unmount();

    // The other cause must produce the OTHER message. Without this case the test
    // passes with both branches hardcoded to errorInvalidInput — which is the
    // "one message for both causes" defect spec 5.1 exists to correct.
    vi.mocked(savePoliciesAction).mockResolvedValueOnce({ status: 'error', cause: 'invalid_lead' });

    render(<PoliciesForm slug="test-club" updatedAt={1} settings={settings} labels={labels} />);
    submit();

    await waitFor(() => expect(screen.getByText(labels.errorInvalidLead)).toBeInTheDocument());
    expect(toast.error).toHaveBeenCalledWith(labels.errorInvalidLead);
    expect(screen.queryByText(labels.errorInvalidInput)).not.toBeInTheDocument();
  });
});
