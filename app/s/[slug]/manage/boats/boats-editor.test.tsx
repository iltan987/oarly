// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { type BoatSaveResult, createBoatAction, updateBoatAction } from './actions';
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

describe('BoatsEditor refusal', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /**
   * A refused save must not wipe the row the owner just filled in.
   *
   * React 19 resets an uncontrolled form after ANY completed form action, refusal included
   * (react-dom 19.2.8, `startHostTransition` -> `requestFormReset`), and `boatSchema`'s
   * `minAttendance <= seats` refinement is reachable by ORDINARY use — a min attendance of 5
   * on a 4-seat boat is a plain mistake. Before the echo, that mistake cost the name, the
   * seat count and the min attendance all at once.
   *
   * `submitAndSettle` rather than `waitFor(value)`: the field already holds the typed text
   * the moment it is typed, so waiting on the value passes before the action is even called
   * and would go green with the fix removed.
   */
  async function submitAndSettle() {
    await act(async () => {
      const form = screen.getByRole('button', { name: 'Save' }).closest('form');
      if (!form) throw new Error('form not found');
      fireEvent.submit(form);
    });
  }

  /** A refusal that echoes what was submitted, exactly as the real actions do. */
  function refuseEchoingSubmission(action: typeof createBoatAction | typeof updateBoatAction) {
    vi.mocked(action).mockImplementation(async (_slug, _prev, formData): Promise<BoatSaveResult> => ({
      ok: false,
      values: {
        name: String(formData.get('name') ?? ''),
        seats: String(formData.get('seats') ?? ''),
        minAttendance: String(formData.get('minAttendance') ?? ''),
      },
    }));
  }

  it('keeps the typed name, seats and min attendance after a refused add', async () => {
    refuseEchoingSubmission(createBoatAction);
    render(<BoatsEditor slug="club" boats={[]} levels={[]} labels={labels} multisportEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Add boat' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sarı Tekne' } });
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Min attendance'), { target: { value: '5' } });
    await submitAndSettle();

    expect(screen.getByLabelText('Name')).toHaveValue('Sarı Tekne');
    expect(screen.getByLabelText('Seats')).toHaveValue(4);
    expect(screen.getByLabelText('Min attendance')).toHaveValue(5);
  });

  it('keeps the edit in progress after a refused update, rather than reverting to the stored boat', async () => {
    refuseEchoingSubmission(updateBoatAction);
    render(<BoatsEditor slug="club" boats={[boat]} levels={[]} labels={labels} multisportEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Quad (renamed)' } });
    fireEvent.change(screen.getByLabelText('Min attendance'), { target: { value: '9' } });
    await submitAndSettle();

    expect(screen.getByLabelText('Name')).toHaveValue('Quad (renamed)');
    expect(screen.getByLabelText('Min attendance')).toHaveValue(9);
  });

  // The form stays open on a refusal (it only closes via onSuccess), and it must stay the
  // SAME form: remounting it would preserve the values too, but throw focus to <body>.
  it('keeps the same form node on a refusal, so focus is not thrown away', async () => {
    refuseEchoingSubmission(createBoatAction);
    render(<BoatsEditor slug="club" boats={[]} levels={[]} labels={labels} multisportEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Add boat' }));

    const field = screen.getByLabelText('Name');
    const before = field.closest('form');
    fireEvent.change(field, { target: { value: 'Sarı Tekne' } });
    await submitAndSettle();

    expect(screen.getByLabelText('Name')).toBe(field);
    expect(screen.getByLabelText('Name').closest('form')).toBe(before);
  });
});
