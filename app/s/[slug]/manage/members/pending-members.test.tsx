// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import trMessages from '../../../../../messages/tr.json';

// Keys are asserted on directly (with interpolated values appended) rather than resolved
// through the real catalogs — this file is about wiring, not copy. The copy is guarded in
// `src/i18n/tr-restriction-vocabulary.test.ts` and by the catalog check at the bottom.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('./actions', () => ({
  approveMemberAction: vi.fn(),
  rejectMemberAction: vi.fn(),
}));

import { toast } from 'sonner';

import { approveMemberAction, rejectMemberAction } from './actions';
import { PendingMembers } from './pending-members';

// React entangles in-flight async actions on a module-global lane, so a promise left
// unresolved when a test ends blocks state updates in every LATER test in this file — and
// it survives Testing Library's per-test unmount. Tests that defer a resolution push their
// resolver here so an assertion throwing early cannot hang the rest of the file.
const pendingResolvers: Array<() => void> = [];
afterEach(() => { pendingResolvers.splice(0).forEach((r) => r()); });

// Real uuids: `memberships.id` is a `uuid` column, so `m1` is a value production cannot
// serve — and the id is what the action is asserted on below.
function mkRow(name: string) {
  const id = randomUUID();
  return { membershipId: id, name, email: `${name.toLowerCase()}@example.com` };
}

const ROWS = [mkRow('Ayşe Bekleyen'), mkRow('Burak Bekleyen')];

function renderQueue(rows = ROWS) {
  render(<PendingMembers slug="demo" rows={rows} />);
}

function submitRejectDialog() {
  const cta = screen.getByRole('button', { name: 'confirmRejectCta' });
  const form = cta.closest('form');
  if (!form) throw new Error('confirm form not found');
  fireEvent.submit(form);
}

describe('PendingMembers reject gate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /**
   * THE assertion of this file, and the one a confirmation test usually leaves out.
   *
   * A test that only checks "confirming dispatches the action" passes with the gate
   * deleted outright — wire Reject straight to a submit and it still goes green. So the
   * first thing asserted is that the row's own Reject does NOT reach the server: it opens
   * a question naming the person, and nothing else happens.
   */
  it('clicking Reject asks about that person and dispatches nothing', () => {
    renderQueue();
    fireEvent.click(screen.getAllByRole('button', { name: 'reject' })[0]);

    expect(rejectMemberAction).not.toHaveBeenCalled();
    // Named, not "are you sure?": the queue is dense and the row under the pointer is not
    // always the row that was meant.
    expect(screen.getByText(/confirmRejectTitle/)).toHaveTextContent('Ayşe Bekleyen');
  });

  // Same pair as the roster's, pinned for the same reason: `Card`'s `overflow-hidden`
  // means an over-wide name is clipped rather than scrolled, so no `scrollWidth` check
  // anywhere can notice these going missing.
  it('lets a long request name shrink and wrap rather than force the row wider', () => {
    const long = 'Boğaziçi Üniversitesi Kürek ve Yelken İhtisas Kulübü Üyesiıı';
    renderQueue([{ membershipId: randomUUID(), name: long, email: 'uzun@example.com' }]);

    const name = screen.getByText(long);
    expect(name.parentElement).toHaveClass('min-w-0');
    expect(name).toHaveClass('break-words');
    expect(screen.getByText('uzun@example.com')).toHaveClass('break-words');
  });

  it('confirming dispatches the reject action for the row that was clicked', async () => {
    vi.mocked(rejectMemberAction).mockResolvedValue({ ok: true });
    renderQueue();

    fireEvent.click(screen.getAllByRole('button', { name: 'reject' })[1]);
    submitRejectDialog();

    await waitFor(() => expect(rejectMemberAction).toHaveBeenCalledTimes(1));
    const call = vi.mocked(rejectMemberAction).mock.calls[0];
    expect(call[0]).toBe('demo');
    expect((call[2] as FormData).get('membershipId')).toBe(ROWS[1].membershipId);
  });

  // Dismissing must leave the request exactly where it was. The dialog's own dismiss is
  // `ConfirmDialog`'s; what is asserted here is that closing it dispatches nothing.
  it('dismissing the question leaves the request untouched', async () => {
    renderQueue();
    fireEvent.click(screen.getAllByRole('button', { name: 'reject' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'confirmRejectKeep' }));

    await waitFor(() => expect(screen.queryByText(/confirmRejectTitle/)).toBeNull());
    expect(rejectMemberAction).not.toHaveBeenCalled();
  });

  /**
   * The other half of the codebase's asymmetry (`club-status-button.tsx:13-30`): the
   * restorative direction does not confirm. An extra click on a control whose only effect
   * is to admit somebody to the club is friction with nothing behind it, and after a
   * season sign-up it is the bulk operation.
   */
  it('approves in one click, with no question in between', async () => {
    vi.mocked(approveMemberAction).mockResolvedValue({ ok: true });
    renderQueue();

    const form = screen.getAllByRole('button', { name: 'approve' })[0].closest('form');
    if (!form) throw new Error('approve form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(approveMemberAction).toHaveBeenCalledTimes(1));
    expect((vi.mocked(approveMemberAction).mock.calls[0][2] as FormData).get('membershipId'))
      .toBe(ROWS[0].membershipId);
    expect(screen.queryByText(/confirmRejectTitle/)).toBeNull();
  });
});

describe('PendingMembers in-flight feedback', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /**
   * The portal trap, asserted rather than described.
   *
   * The row dims through `has-data-pending:opacity-40`, a `:has()` selector that finds
   * `PendingButton`'s `data-pending`. Base UI renders the confirm form OUTSIDE the row's
   * subtree, so for a reject that selector sees nothing and the row would stop dimming —
   * with the dialog already closed, that leaves the whole round trip with no feedback
   * anywhere on the page. `ConfirmDialog`'s `onSubmit` sets the id this asserts on.
   */
  it('dims the row for the whole reject round trip and clears the dim when it resolves', async () => {
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(rejectMemberAction).mockImplementation(
      () => new Promise((r) => { resolve = r; pendingResolvers.push(() => r({ ok: true })); }),
    );
    renderQueue();

    fireEvent.click(screen.getAllByRole('button', { name: 'reject' })[0]);
    submitRejectDialog();

    await waitFor(() => expect(rejectMemberAction).toHaveBeenCalledTimes(1));
    const row = screen.getByText('Ayşe Bekleyen').parentElement?.parentElement;
    expect(row).toHaveClass('opacity-40');
    // …and only that row. A shared pending flag would grey the whole queue out.
    expect(screen.getByText('Burak Bekleyen').parentElement?.parentElement).not.toHaveClass('opacity-40');
    // The trigger is disabled for the same window: a dialog dismissed mid-round-trip
    // would otherwise let the owner open a second question about a decision already
    // taken. The OTHER row's trigger stays live — one reject must not freeze the queue.
    const triggers = screen.getAllByRole('button', { name: 'reject' });
    expect(triggers[0]).toBeDisabled();
    expect(triggers[1]).not.toBeDisabled();

    resolve?.({ ok: true });
    await waitFor(() => expect(row).not.toHaveClass('opacity-40'));
  });

  // The CSS bridge is still on the row, and it is what dims an in-row APPROVE — whose
  // submit is not portalled and therefore IS visible to `:has()`.
  it('keeps the has-data-pending bridge on the row for the in-row approve', async () => {
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(approveMemberAction).mockImplementation(
      () => new Promise((r) => { resolve = r; pendingResolvers.push(() => r({ ok: true })); }),
    );
    renderQueue();

    const row = screen.getByText('Ayşe Bekleyen').parentElement?.parentElement;
    expect(row).toHaveClass('has-data-pending:opacity-40');

    // Captured BEFORE the submit: `PendingButton` renders a spinner alongside its label
    // while pending, which changes that button's accessible name — so a second
    // `getAllByRole` after the dispatch would silently return one element and make the
    // assertion below read `undefined`.
    const [first, second] = screen.getAllByRole('button', { name: 'approve' });
    fireEvent.submit(first.closest('form')!);
    await waitFor(() => expect(first).toHaveAttribute('data-pending'));

    // One row's form is one `useFormStatus` scope: hoisting the dispatcher must not grey
    // out every other row's Approve.
    expect(second).not.toBeDisabled();
    expect(second).not.toHaveAttribute('data-pending');

    resolve?.({ ok: true });
  });

  // A successful decision revalidates and unmounts the row, so a row-local toast effect
  // is dropped before it runs. Both `useActionState`s are hoisted for this.
  it('reports a rejection and an approval on the surviving parent', async () => {
    vi.mocked(rejectMemberAction).mockResolvedValue({ ok: true });
    renderQueue();
    fireEvent.click(screen.getAllByRole('button', { name: 'reject' })[0]);
    submitRejectDialog();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('memberRejected'));

    vi.mocked(approveMemberAction).mockResolvedValue({ ok: true });
    fireEvent.submit(screen.getAllByRole('button', { name: 'approve' })[1].closest('form')!);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('memberApproved'));
  });

  it('reports a failed rejection as an error and clears the dim', async () => {
    vi.mocked(rejectMemberAction).mockResolvedValue({ ok: false });
    renderQueue();
    fireEvent.click(screen.getAllByRole('button', { name: 'reject' })[0]);
    submitRejectDialog();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('actionError'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText('Ayşe Bekleyen').parentElement?.parentElement).not.toHaveClass('opacity-40');
  });
});

describe('the reject confirmation copy', () => {
  const manage = trMessages.manage as unknown as Record<string, string>;

  /**
   * Component tests in this repo mock next-intl and assert on KEY NAMES, so not one of
   * them can see a word of this copy. Three controls appear in the flow — the row's
   * trigger, the dialog's dismiss and the dialog's confirm — and no two of them may read
   * alike: `Reddet` / `Reddet` is how the second decision stops being one
   * (`decision-buttons.tsx:80-81`).
   */
  it('gives the trigger, the dismiss and the confirm three different words', () => {
    expect(manage.confirmRejectCta).not.toBe(manage.reject);
    expect(manage.confirmRejectKeep).not.toBe(manage.reject);
    expect(manage.confirmRejectKeep).not.toBe(manage.confirmRejectCta);
    // And not the app-wide "Vazgeç" either, which is the /book dialog's dismiss.
    expect(manage.confirmRejectKeep).not.toBe(manage.cancel);
  });

  // The body is the entire justification for the extra tap. Reduced to "Emin misin?" it
  // adds friction and tells the owner nothing they did not already know — and what they
  // do NOT know is that this is one-way.
  it('says that the rejection cannot be undone', () => {
    expect(manage.confirmRejectBody).toMatch(/geri alma|geri alınamaz/i);
    expect(manage.confirmRejectTitle).toContain('{name}');
  });
});
