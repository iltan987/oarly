// @vitest-environment jsdom
/**
 * Three forms, two action kinds. What this file pins down is that each form's dispatch
 * reaches its own action and its own toast — the failure mode of collapsing the control
 * onto a single `useActionState` is that pressing "reset" writes an override instead of
 * removing one, and reports the wrong result.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `useTranslations` is mocked to return the SAME function on every render for a given
// namespace, because that is what `use-intl` does: its translator is `useMemo`'d on
// context-stable deps (see use-intl/dist/esm/*/react.js, `useTranslationsImpl`). A mock
// that built a fresh closure per render would change the identity of an effect dep that
// production never changes, and every "did it toast twice?" assertion here would then be
// measuring the mock rather than the component.
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

vi.mock('./actions', () => ({
  setOverrideAction: vi.fn(),
  clearOverrideAction: vi.fn(),
}));

import { toast } from 'sonner';

import { clearOverrideAction, setOverrideAction } from './actions';
import { DateOverrideControls } from './date-override-controls';

const DATE = '2026-08-11';

function submit(name: string) {
  fireEvent.submit(screen.getByRole('button', { name }).closest('form')!);
}

/**
 * Fresh result object per call, not `mockResolvedValue`'s single shared one: the
 * components compare results by identity in their `handled` refs, and a real server
 * action's result is deserialised fresh on every invocation. A shared object would make
 * a second refusal look like the first one still sitting in state.
 */
function resolves(fn: typeof setOverrideAction | typeof clearOverrideAction, ok: boolean) {
  vi.mocked(fn).mockImplementation(async () => ({ ok }) as { ok: true } | { ok: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolves(setOverrideAction, true);
  resolves(clearOverrideAction, true);
});

describe('DateOverrideControls dispatch routing', () => {
  it('sends each form to its own action with its own payload', async () => {
    render(<DateOverrideControls slug="club" dateISO={DATE} overridden />);

    submit('manage.schedulePreview.close');
    await waitFor(() => expect(setOverrideAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(setOverrideAction).mock.calls[0][2].get('isOpen')).toBe('closed');

    submit('manage.schedulePreview.forceOpen');
    await waitFor(() => expect(setOverrideAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(setOverrideAction).mock.calls[1][2].get('isOpen')).toBe('open');

    // The one that a single shared `useActionState` would get wrong: reset must clear
    // the override, not write a third one.
    submit('manage.schedulePreview.reset');
    await waitFor(() => expect(clearOverrideAction).toHaveBeenCalledTimes(1));
    expect(setOverrideAction).toHaveBeenCalledTimes(2);
    expect(vi.mocked(clearOverrideAction).mock.calls[0][2].get('dateISO')).toBe(DATE);
  });
});

describe('DateOverrideControls toasts', () => {
  it('shows an error when the override is refused', async () => {
    resolves(setOverrideAction, false);
    render(<DateOverrideControls slug="club" dateISO={DATE} overridden={false} />);

    submit('manage.schedulePreview.close');

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('manage.actionError'));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  // The counterfactual for the test above: without it, that assertion would pass just as
  // well on a component that toasted on every submit regardless of the result.
  it('shows nothing when the override is accepted', async () => {
    render(<DateOverrideControls slug="club" dateISO={DATE} overridden={false} />);

    submit('manage.schedulePreview.close');

    await waitFor(() => expect(setOverrideAction).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  // Cross-talk: a refusal that belongs to `setOverrideAction` must not be reported by
  // the reset form. One shared state for all three forms fails here — reset would run
  // `setOverrideAction`, get its `{ ok: false }`, and toast it.
  it('does not report the set action\'s refusal when only reset was pressed', async () => {
    resolves(setOverrideAction, false);
    resolves(clearOverrideAction, true);
    render(<DateOverrideControls slug="club" dateISO={DATE} overridden />);

    submit('manage.schedulePreview.reset');

    await waitFor(() => expect(clearOverrideAction).toHaveBeenCalledTimes(1));
    expect(setOverrideAction).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  // And the mirror: a refused reset is reported, so the assertion above is about WHICH
  // result surfaced, not about the reset form being silent in general.
  it('reports a refused reset', async () => {
    resolves(clearOverrideAction, false);
    render(<DateOverrideControls slug="club" dateISO={DATE} overridden />);

    submit('manage.schedulePreview.reset');

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('manage.actionError'));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
