// @vitest-environment jsdom
/**
 * The `handled` ref in `ScheduleEditor` and `DateOverrideControls` — the one that compares
 * a `useActionState` result by identity before toasting it.
 *
 * This file deliberately does NOT mock `next-intl`. The sibling files do, and a mocked
 * translator cannot express the mechanism that makes the ref load-bearing:
 *
 *   `app/layout.tsx:25` renders the SERVER variant of `NextIntlClientProvider`, which
 *   resolves `messages` on the server and hands them across the RSC boundary as a prop.
 *   `use-intl` memoises its translator on that object's identity
 *   (`use-intl/dist/esm/development/react.js`, `useTranslationsImpl`). Every RSC payload
 *   deserialises a FRESH messages object, so after any revalidation `t` is a new function
 *   — and every effect with `t` in its deps re-runs, with a `state` that has not changed.
 *
 * Without the ref, that re-run re-toasts a refusal the owner has already read and
 * dismissed, attached to an action they did not just take. Re-rendering the real provider
 * with a structurally identical but freshly allocated messages object is exactly that
 * event, which is why the harness below clones instead of reusing.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import tr from '../../../../../messages/tr.json';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => ({ deleteWindowAction: vi.fn(), saveWindowAction: vi.fn() }));
vi.mock('./preview/actions', () => ({ setOverrideAction: vi.fn(), clearOverrideAction: vi.fn() }));

import { toast } from 'sonner';

import { deleteWindowAction } from './actions';
import { setOverrideAction } from './preview/actions';
import { DateOverrideControls } from './preview/date-override-controls';
import { ScheduleEditor } from './schedule-editor';

/** The generic refusal both components report, resolved through the real catalog. */
const ACTION_ERROR = tr.manage.actionError;

/**
 * A fresh deep copy per render, standing in for what an RSC payload delivers: the same
 * catalog by value, a different object by identity. Reusing one object here would make
 * `use-intl`'s memo hit and this whole file would prove nothing.
 */
function Intl({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="tr" timeZone="Europe/Istanbul" messages={structuredClone(tr)}>
      {children}
    </NextIntlClientProvider>
  );
}

const boats = [{ id: 'b1', name: 'Dört Tek' }];
const windows = [
  { id: 'w1', weekday: 1, startTime: '08:00:00', endTime: '10:00:00', defaultSessionMinutes: 60, boats: [{ boatTypeId: 'b1', boatName: 'Dört Tek', quantity: 1 }] },
];
const weekdayNames = { 0: 'Paz', 1: 'Pzt', 2: 'Sal', 3: 'Çar', 4: 'Per', 5: 'Cum', 6: 'Cmt' };
const labels = {
  addWindow: 'Aralık ekle', noWindows: 'Aralık yok', edit: 'Düzenle', delete: 'Sil',
  minutesShort: 'dk', needBoats: 'Tekne gerek', startTime: 'Başlangıç', endTime: 'Bitiş',
  sessionMinutes: 'Seans', boats: 'Tekneler', addBoat: 'Tekne ekle', removeBoat: 'Kaldır',
  save: 'Kaydet', cancel: 'İptal', errors: {},
};

beforeEach(() => { vi.clearAllMocks(); });

describe('DateOverrideControls re-toasting', () => {
  it('reports a refusal once across revalidations that hand it a fresh messages object', async () => {
    vi.mocked(setOverrideAction).mockImplementation(async () => ({ ok: false }));
    const ui = <DateOverrideControls slug="club" dateISO="2026-08-11" overridden={false} />;
    const { rerender } = render(<Intl>{ui}</Intl>);

    fireEvent.submit(screen.getByRole('button', { name: tr.manage.schedulePreview.close }).closest('form')!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ACTION_ERROR));
    expect(toast.error).toHaveBeenCalledTimes(1);

    // Two more RSC payloads land — a sibling day is closed, the route revalidates. The
    // action state has NOT changed; only the translator's identity has.
    rerender(<Intl>{ui}</Intl>);
    rerender(<Intl>{ui}</Intl>);

    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  // The counterfactual for the assertion above: it must be able to count past one, or it
  // would pass on a component that never toasted a second time for any reason.
  it('reports a genuinely new refusal as its own toast', async () => {
    vi.mocked(setOverrideAction).mockImplementation(async () => ({ ok: false }));
    const ui = <DateOverrideControls slug="club" dateISO="2026-08-11" overridden={false} />;
    render(<Intl>{ui}</Intl>);

    const form = screen.getByRole('button', { name: tr.manage.schedulePreview.close }).closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    fireEvent.submit(form);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
  });
});

describe('ScheduleEditor re-toasting', () => {
  it('reports a refused delete once across revalidations that hand it a fresh messages object', async () => {
    vi.mocked(deleteWindowAction).mockImplementation(async () => ({ ok: false }));
    const ui = <ScheduleEditor slug="club" windows={windows} boats={boats} weekdayNames={weekdayNames} labels={labels} />;
    const { rerender } = render(<Intl>{ui}</Intl>);

    fireEvent.submit(screen.getByRole('button', { name: labels.delete }).closest('form')!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ACTION_ERROR));
    expect(toast.error).toHaveBeenCalledTimes(1);

    rerender(<Intl>{ui}</Intl>);
    rerender(<Intl>{ui}</Intl>);

    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
