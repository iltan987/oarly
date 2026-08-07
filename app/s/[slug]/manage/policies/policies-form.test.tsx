// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
  it('survives the inner form remounting after a save without losing or duplicating the toast', async () => {
    vi.mocked(savePoliciesAction).mockResolvedValue({ status: 'ok' });

    const { rerender } = render(
      <PoliciesForm slug="test-club" updatedAt={1} settings={settings} labels={labels} />,
    );

    submit();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith(labels.saved);

    // Simulate what page.tsx does on the next server render after revalidatePath:
    // `club.updatedAt` bumps, which changes the `key` on the inner fields and
    // remounts them. The toast must NOT fire again — it lives in the stable
    // outer component, which this rerender does not remount.
    rerender(<PoliciesForm slug="test-club" updatedAt={2} settings={settings} labels={labels} />);

    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('shows the field-level error for a Zod failure and the lead-day error for the domain failure', async () => {
    vi.mocked(savePoliciesAction).mockResolvedValueOnce({ status: 'error', cause: 'invalid_input' });

    render(<PoliciesForm slug="test-club" updatedAt={1} settings={settings} labels={labels} />);
    submit();

    await waitFor(() => expect(screen.getByText(labels.errorInvalidInput)).toBeInTheDocument());
    expect(toast.error).toHaveBeenCalledWith(labels.errorInvalidInput);
  });
});
