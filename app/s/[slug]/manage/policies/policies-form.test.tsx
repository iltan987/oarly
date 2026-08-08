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

import { schedulingSettingsSchema } from '@/lib/schemas';

import { savePoliciesAction } from './actions';
import { PoliciesForm } from './policies-form';

const settings = {
  bookingOpenMode: 'always' as const,
  bookingOpenLeadDays: null,
  selfCancelEnabled: true,
  cancelCutoffHours: null,
  noshowPenalty: 'off' as const,
  multisportMode: 'equal' as const,
  multisportEnabled: true,
  openOnHolidays: false,
  waitlistCapacity: null,
};

const labels = {
  save: 'Save', bookingOpen: 'Booking opens', bookingOpenAlways: 'Always open', bookingOpenLead: 'A set number of days before',
  leadDays: 'Lead days count', selfCancel: 'Allow self-cancel', cancelCutoff: 'Cutoff', noshow: 'No-show penalty',
  noshowOff: 'Off', noshow2d: '2 days', noshow1w: '1 week', noshow2w: '2 weeks', noshow1m: '1 month',
  noshowNever: 'Never', multisport: 'MultiSport mode', multisportEqual: 'Equal', multisportPriority: 'Priority',
  multisportHint: 'hint', openOnHolidays: 'Open on holidays', waitlistCapacity: 'Waitlist capacity',
  waitlistCapacityHint: 'hint', errorInvalidLead: 'Enter a valid lead.', errorInvalidInput: 'Check the fields.',
  saved: 'Policies saved.', multisportEnabled: 'Accept MultiSport', multisportEnabledHint: 'Turn off if no contract.',
  cancel: 'Cancel', confirmDisableMultisportTitle: 'Turn off MultiSport?',
  confirmDisableMultisportBody: '2 boats will be converted.', confirmDisableMultisportCta: 'Turn off MultiSport',
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

describe('PoliciesForm MultiSport toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for confirmation before hiding the mode field, and does not act on the click alone', () => {
    render(<PoliciesForm slug="test-club" updatedAt={1} settings={settings} labels={labels} />);
    expect(screen.getByText(labels.multisport)).toBeInTheDocument();

    // Captured before the click: Base UI's Dialog marks the rest of the page
    // `aria-hidden` while open, so a role query issued AFTER it opens can no
    // longer find this element by role — the element itself is unchanged.
    const toggle = screen.getByRole('checkbox', { name: labels.multisportEnabled });
    fireEvent.click(toggle);

    expect(screen.getByText(labels.confirmDisableMultisportTitle)).toBeInTheDocument();
    // Nothing has actually changed yet — the checkbox reverts and the mode field stays.
    expect(toggle).toBeChecked();
    expect(screen.getByText(labels.multisport)).toBeInTheDocument();
  });

  it('cancelling the confirmation leaves MultiSport enabled', () => {
    render(<PoliciesForm slug="test-club" updatedAt={1} settings={settings} labels={labels} />);
    const toggle = screen.getByRole('checkbox', { name: labels.multisportEnabled });
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole('button', { name: labels.cancel }));

    expect(screen.queryByText(labels.confirmDisableMultisportTitle)).not.toBeInTheDocument();
    expect(toggle).toBeChecked();
    expect(screen.getByText(labels.multisport)).toBeInTheDocument();
  });

  // The hidden field still has to submit a valid `multisportMode` — the schema
  // requires it unconditionally, so hiding the SELECT must not remove the top-level
  // hidden input that carries its last known value (Task 7's "unmount submits
  // nothing" hazard, applied here to a non-nullable field).
  it('confirming hides the mode field but keeps submitting its last value', async () => {
    vi.mocked(savePoliciesAction).mockResolvedValueOnce({ status: 'ok' });
    render(<PoliciesForm slug="test-club" updatedAt={1} settings={settings} labels={labels} />);

    const toggle = screen.getByRole('checkbox', { name: labels.multisportEnabled });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: labels.confirmDisableMultisportCta }));

    expect(toggle).not.toBeChecked();
    expect(screen.queryByText(labels.multisport)).not.toBeInTheDocument();

    submit();
    await waitFor(() => expect(savePoliciesAction).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(savePoliciesAction).mock.calls[0][2] as FormData;
    expect(formData.get('multisportEnabled')).toBeNull();
    expect(formData.get('multisportMode')).toBe('equal');
  });

  it('re-enabling a disabled club does not ask for confirmation', () => {
    render(<PoliciesForm slug="test-club" updatedAt={1} settings={{ ...settings, multisportEnabled: false }} labels={labels} />);
    expect(screen.queryByText(labels.multisport)).not.toBeInTheDocument();

    const toggle = screen.getByRole('checkbox', { name: labels.multisportEnabled });
    fireEvent.click(toggle);

    expect(screen.queryByText(labels.confirmDisableMultisportTitle)).not.toBeInTheDocument();
    expect(toggle).toBeChecked();
    expect(screen.getByText(labels.multisport)).toBeInTheDocument();
  });
});

// Extracts the FormData the same way actions.ts's (unmocked) savePoliciesAction
// does, so the resulting object can be checked against the REAL schema — a
// mocked action's call args tell us nothing about whether the payload it would
// have received actually parses.
function parseSubmitted(formData: FormData) {
  const leadRaw = String(formData.get('bookingOpenLeadDays') ?? '').trim();
  const cutoffRaw = String(formData.get('cancelCutoffHours') ?? '').trim();
  const waitlistRaw = String(formData.get('waitlistCapacity') ?? '').trim();
  return schedulingSettingsSchema.safeParse({
    bookingOpenMode: formData.get('bookingOpenMode'),
    bookingOpenLeadDays: leadRaw === '' ? null : leadRaw,
    selfCancelEnabled: formData.get('selfCancelEnabled') === 'on',
    cancelCutoffHours: cutoffRaw === '' ? null : cutoffRaw,
    noshowPenalty: formData.get('noshowPenalty'),
    multisportMode: formData.get('multisportMode'),
    multisportEnabled: formData.get('multisportEnabled') === 'on',
    openOnHolidays: formData.get('openOnHolidays') === 'on',
    waitlistCapacity: waitlistRaw === '' ? null : waitlistRaw,
  });
}

describe('PoliciesForm nested settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the lead-days field only in lead mode', () => {
    render(<PoliciesForm slug="test-club" updatedAt={1} settings={settings} labels={labels} />);
    expect(screen.queryByText(labels.leadDays)).not.toBeInTheDocument();
  });

  it('shows the cancel-cutoff field only when self-cancel is on', () => {
    const off = render(<PoliciesForm slug="test-club" updatedAt={1} settings={{ ...settings, selfCancelEnabled: false }} labels={labels} />);
    expect(screen.queryByText(labels.cancelCutoff)).not.toBeInTheDocument();
    off.unmount();

    render(<PoliciesForm slug="test-club" updatedAt={2} settings={{ ...settings, selfCancelEnabled: true }} labels={labels} />);
    expect(screen.getByText(labels.cancelCutoff)).toBeInTheDocument();
  });

  // Task 7's actual risk: a field that unmounts submits nothing, and the schema
  // must still parse — asserted here against the REAL (unmocked) schema, not
  // assumed from the component compiling.
  it('still produces a schema-valid payload with both nested fields hidden', async () => {
    vi.mocked(savePoliciesAction).mockResolvedValueOnce({ status: 'ok' });
    render(<PoliciesForm slug="test-club" updatedAt={1} settings={{ ...settings, bookingOpenMode: 'always', selfCancelEnabled: false }} labels={labels} />);

    expect(screen.queryByText(labels.leadDays)).not.toBeInTheDocument();
    expect(screen.queryByText(labels.cancelCutoff)).not.toBeInTheDocument();

    submit();
    await waitFor(() => expect(savePoliciesAction).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(savePoliciesAction).mock.calls[0][2] as FormData;
    expect(formData.get('bookingOpenLeadDays')).toBeNull();
    // The cutoff keeps submitting even while hidden (see below) — here there is
    // nothing stored, so it submits empty, which the schema reads as "no cutoff".
    expect(formData.get('cancelCutoffHours')).toBe('');

    const parsed = parseSubmitted(formData);
    expect(parsed.success).toBe(true);
  });

  /**
   * The "a field that unmounts submits nothing" hazard actually biting, and the one
   * case where it destroys data: `updateSchedulingSettings` writes `cancelCutoffHours`
   * unconditionally (unlike `bookingOpenLeadDays`, which it normalizes to null under
   * `always` mode by design). So a club running self-cancel with a 12-hour cutoff that
   * turns self-cancel off and saves would lose the 12 — and on turning it back on the
   * field reads blank, which means "members may cancel one minute before the start".
   *
   * Asserting that the payload merely PARSES is not enough; null parses fine. This
   * asserts the stored value itself round-trips. Delete the top-level hidden input in
   * policies-form.tsx and this fails on `null`.
   */
  it('keeps submitting the stored cancel cutoff after self-cancel is switched off', async () => {
    vi.mocked(savePoliciesAction).mockResolvedValueOnce({ status: 'ok' });
    render(<PoliciesForm slug="test-club" updatedAt={1} settings={{ ...settings, selfCancelEnabled: true, cancelCutoffHours: 12 }} labels={labels} />);

    fireEvent.click(screen.getByRole('checkbox', { name: labels.selfCancel }));
    expect(screen.queryByText(labels.cancelCutoff)).not.toBeInTheDocument();

    submit();
    await waitFor(() => expect(savePoliciesAction).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(savePoliciesAction).mock.calls[0][2] as FormData;
    expect(formData.get('cancelCutoffHours')).toBe('12');

    expect(parseSubmitted(formData)).toMatchObject({
      success: true,
      data: { cancelCutoffHours: 12, selfCancelEnabled: false },
    });
  });

  // …and an edit made before switching self-cancel off is what survives, not the
  // value the page was rendered with — the hidden input carries the live state.
  it('carries an unsaved cutoff edit through the field unmounting', async () => {
    vi.mocked(savePoliciesAction).mockResolvedValueOnce({ status: 'ok' });
    render(<PoliciesForm slug="test-club" updatedAt={1} settings={{ ...settings, selfCancelEnabled: true, cancelCutoffHours: 12 }} labels={labels} />);

    fireEvent.change(screen.getByLabelText(labels.cancelCutoff), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('checkbox', { name: labels.selfCancel }));

    submit();
    await waitFor(() => expect(savePoliciesAction).toHaveBeenCalledTimes(1));
    expect((vi.mocked(savePoliciesAction).mock.calls[0][2] as FormData).get('cancelCutoffHours')).toBe('6');
  });

  // The other side: lead mode WITH the field visible must still parse, so the
  // above isn't passing merely because the schema no longer checks anything.
  it('still parses when lead mode is on and the lead-days field is visible and filled', async () => {
    vi.mocked(savePoliciesAction).mockResolvedValueOnce({ status: 'ok' });
    render(<PoliciesForm slug="test-club" updatedAt={1} settings={{ ...settings, bookingOpenMode: 'lead', bookingOpenLeadDays: 3 }} labels={labels} />);

    expect(screen.getByText(labels.leadDays)).toBeInTheDocument();

    submit();
    await waitFor(() => expect(savePoliciesAction).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(savePoliciesAction).mock.calls[0][2] as FormData;
    expect(formData.get('bookingOpenLeadDays')).toBe('3');

    const parsed = parseSubmitted(formData);
    expect(parsed.success).toBe(true);
  });
});
