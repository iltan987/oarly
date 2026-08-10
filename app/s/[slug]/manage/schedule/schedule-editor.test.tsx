// @vitest-environment jsdom
/**
 * The delete row's result contract, seen from the UI: a refused delete — a malformed id,
 * or a window another tab already removed — must say so. Before `deleteWindowAction`
 * returned `ManageActionResult` there was nothing to say it with.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same-identity-per-namespace translator, mirroring `use-intl`'s `useMemo`'d one — see
// the note in `preview/date-override-controls.test.tsx`.
const intl = vi.hoisted(() => {
  const byNamespace = new Map<string, (key: string) => string>();
  return {
    useTranslations: (ns: string) => {
      let t = byNamespace.get(ns);
      if (!t) { t = (key: string) => `${ns}.${key}`; byNamespace.set(ns, t); }
      return t;
    },
  };
});
vi.mock('next-intl', () => ({ useTranslations: intl.useTranslations }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// `saveWindowAction` is stubbed only because `WindowForm` imports it from this module;
// no test here opens an editor.
vi.mock('./actions', () => ({ deleteWindowAction: vi.fn(), saveWindowAction: vi.fn() }));

import { toast } from 'sonner';

import { deleteWindowAction } from './actions';
import { ScheduleEditor } from './schedule-editor';

const boats = [{ id: 'b1', name: 'Quad' }];
const windows = [
  { id: 'w1', weekday: 1, startTime: '08:00:00', endTime: '10:00:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: 'b1', boatName: 'Quad', quantity: 1 }] },
  { id: 'w2', weekday: 1, startTime: '14:00:00', endTime: '16:00:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: 'b1', boatName: 'Quad', quantity: 1 }] },
];
const weekdayNames = { 0: 'Paz', 1: 'Pzt', 2: 'Sal', 3: 'Çar', 4: 'Per', 5: 'Cum', 6: 'Cmt' };
const labels = {
  addWindow: 'addWindow', noWindows: 'noWindows', edit: 'edit', delete: 'delete',
  minutesShort: 'dk', needBoats: 'needBoats', startTime: 'startTime', endTime: 'endTime',
  sessionMinutes: 'sessionMinutes', boats: 'boats', addBoat: 'addBoat', removeBoat: 'removeBoat',
  save: 'save', cancel: 'cancel', errors: {},
};

function renderEditor() {
  return render(<ScheduleEditor slug="club" windows={windows} boats={boats} weekdayNames={weekdayNames} labels={labels} />);
}

/**
 * `mockResolvedValue` would hand back ONE object to every call, and the component's
 * `handled` ref compares results by identity — so a second refusal would be mistaken for
 * the first one still sitting in state. A real server action's result is deserialised
 * fresh per invocation, which is the property the ref relies on; these helpers reproduce
 * it rather than quietly breaking it.
 */
const resolves = (result: { ok: boolean }) =>
  vi.mocked(deleteWindowAction).mockImplementation(async () => ({ ...result }) as { ok: true } | { ok: false });

beforeEach(() => {
  vi.clearAllMocks();
  resolves({ ok: true });
});

describe('ScheduleEditor delete', () => {
  it('shows an error when the delete is refused', async () => {
    resolves({ ok: false });
    renderEditor();

    fireEvent.submit(screen.getAllByRole('button', { name: 'delete' })[0].closest('form')!);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('manage.actionError'));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  // Counterfactual for the above: the toast must come from the `{ ok: false }`, not from
  // the mere act of submitting.
  it('shows nothing when the delete succeeds', async () => {
    renderEditor();

    fireEvent.submit(screen.getAllByRole('button', { name: 'delete' })[0].closest('form')!);

    await waitFor(() => expect(deleteWindowAction).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  // The hoisted state is shared by every row's form, so a second row's refusal must
  // still produce its own toast rather than being swallowed as "same result again".
  it('reports a second row\'s refusal too', async () => {
    resolves({ ok: false });
    renderEditor();

    const forms = screen.getAllByRole('button', { name: 'delete' }).map((b) => b.closest('form')!);
    fireEvent.submit(forms[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

    fireEvent.submit(forms[1]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
    expect(vi.mocked(deleteWindowAction).mock.calls.map((c) => c[2].get('windowId'))).toEqual(['w1', 'w2']);
  });

  // One hoisted `useActionState` for every row, but `PendingButton` reads `useFormStatus`
  // from its own <form> — so one delete in flight must not disable the other row's.
  it('leaves the other row\'s delete enabled while one is in flight', async () => {
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(deleteWindowAction).mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderEditor();

    const buttons = screen.getAllByRole('button', { name: 'delete' });
    fireEvent.submit(buttons[0].closest('form')!);

    await waitFor(() => expect(buttons[0]).toHaveAttribute('data-pending'));
    expect(buttons[1]).not.toBeDisabled();

    resolve?.({ ok: true });
  });
});
