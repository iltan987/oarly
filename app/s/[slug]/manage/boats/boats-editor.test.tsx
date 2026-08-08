// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The translation keys are asserted on directly rather than resolved through real
// message files — this test is about wiring, not copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('./actions', () => ({
  createBoatAction: vi.fn(),
  updateBoatAction: vi.fn(),
  setBoatActiveAction: vi.fn(),
}));

import { createBoatAction, updateBoatAction } from './actions';
import { BoatsEditor } from './boats-editor';

const labels = {
  name: 'Name', seats: 'Seats', minSkill: 'Min skill', noMinSkill: 'No requirement', payment: 'Allowed payment',
  paymentRegular: 'Cash only', paymentMultisport: 'MultiSport only', paymentBoth: 'Both', minAttendance: 'Min attendance',
  add: 'Add boat', edit: 'Edit', save: 'Save', cancel: 'Cancel', deactivate: 'Deactivate', activate: 'Activate',
  inactive: 'Inactive', empty: 'No boats yet.', needSkillLevels: 'Add skill levels first.',
};

const boat = { id: 'b1', name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both' as const, minAttendance: null, active: true };

describe('BoatsEditor MultiSport toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the Allowed payment field on the add form when MultiSport is enabled', () => {
    render(<BoatsEditor slug="club" boats={[]} levels={[]} labels={labels} multisportEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Add boat' }));
    expect(screen.getByText('Allowed payment')).toBeInTheDocument();
  });

  it('hides the Allowed payment field on the add form when MultiSport is disabled, and submits regular_only', async () => {
    vi.mocked(createBoatAction).mockResolvedValue({ ok: true });
    render(<BoatsEditor slug="club" boats={[]} levels={[]} labels={labels} multisportEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add boat' }));

    expect(screen.queryByText('Allowed payment')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New boat' } });
    const form = screen.getByRole('button', { name: 'Save' }).closest('form');
    if (!form) throw new Error('form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(createBoatAction).toHaveBeenCalledTimes(1));
    const call = vi.mocked(createBoatAction).mock.calls[0];
    expect((call[2] as FormData).get('allowedPayment')).toBe('regular_only');
  });

  // The field is hidden, so the owner is never shown `allowedPayment` and never
  // agrees to change it — an unrelated edit (this one only renames the boat) must
  // therefore echo the stored value back untouched. `both` already permits cash, so
  // it strands nothing; narrowing it to `regular_only` here is pure data loss, and
  // it contradicts the disable confirmation, which promises to convert only
  // MultiSport-ONLY boats. Mutate the hidden input back to `'regular_only'` and
  // this fails.
  it('hides the field on the edit form but leaves a stored "both" boat unchanged through an unrelated edit', async () => {
    vi.mocked(updateBoatAction).mockResolvedValue({ ok: true });
    render(<BoatsEditor slug="club" boats={[boat]} levels={[]} labels={labels} multisportEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByText('Allowed payment')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Quad (renamed)' } });
    const form = screen.getByRole('button', { name: 'Save' }).closest('form');
    if (!form) throw new Error('form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(updateBoatAction).toHaveBeenCalledTimes(1));
    const submitted = vi.mocked(updateBoatAction).mock.calls[0][2] as FormData;
    expect(submitted.get('name')).toBe('Quad (renamed)');
    expect(submitted.get('allowedPayment')).toBe('both');
  });
});
