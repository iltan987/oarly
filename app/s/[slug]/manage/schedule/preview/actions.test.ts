/**
 * The two date-override actions' result contract.
 *
 * `2026-02-31` is the case worth naming: it matches `/^\d{4}-\d{2}-\d{2}$/`, is not a
 * date, and is exactly what an owner reaches these actions with from a hand-edited
 * request. Both guards already refused it — but while both returned `void` the refusal
 * was unreportable, so the calendar simply did not change and no toast said why.
 *
 * The library functions are asserted NOT to have been called: reaching the query at all
 * is the defect (22008 out of the action), and a test that only checked the return value
 * would pass on an action that queried first and swallowed the error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const lib = vi.hoisted(() => ({
  setDateOverride: vi.fn(async () => true),
  clearDateOverride: vi.fn(async () => true),
}));

vi.mock('@/lib/membership', () => ({
  requireOwner: async () => ({ club: { id: 'club-1' }, user: { id: 'u1' } }),
}));
vi.mock('@/lib/date-overrides', () => ({
  setDateOverride: lib.setDateOverride, clearDateOverride: lib.clearDateOverride,
}));

import { revalidatePath } from 'next/cache';

import { clearOverrideAction, setOverrideAction } from './actions';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

/** Shape-valid, not date-valid, plus the plainly malformed. */
const BAD_DATES = ['2026-02-31', '2026-13-45', '31-02-2026', 'tomorrow', ''];

beforeEach(() => { vi.clearAllMocks(); });

describe('setOverrideAction', () => {
  it('returns { ok: true } and revalidates the preview on success', async () => {
    expect(await setOverrideAction('club', null, fd({ dateISO: '2026-08-11', isOpen: 'closed' }))).toEqual({ ok: true });
    expect(lib.setDateOverride).toHaveBeenCalledWith({}, 'club-1', { dateISO: '2026-08-11', isOpen: false }, 'u1');
    expect(revalidatePath).toHaveBeenCalledWith('/s/club/manage/schedule/preview');
  });

  it('returns { ok: false } for a date the schema refuses, without querying', async () => {
    for (const bad of BAD_DATES) {
      vi.clearAllMocks();
      const result = await setOverrideAction('club', null, fd({ dateISO: bad, isOpen: 'closed' }));
      expect(result, `dateISO=${JSON.stringify(bad)}`).toEqual({ ok: false });
      expect(lib.setDateOverride).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  });
});

describe('clearOverrideAction', () => {
  it('returns { ok: true } and revalidates the preview on success', async () => {
    expect(await clearOverrideAction('club', null, fd({ dateISO: '2026-08-11' }))).toEqual({ ok: true });
    expect(lib.clearDateOverride).toHaveBeenCalledWith({}, 'club-1', '2026-08-11', 'u1');
    expect(revalidatePath).toHaveBeenCalledWith('/s/club/manage/schedule/preview');
  });

  it('returns { ok: false } for a date `isDateISO` refuses, without querying', async () => {
    for (const bad of BAD_DATES) {
      vi.clearAllMocks();
      const result = await clearOverrideAction('club', null, fd({ dateISO: bad }));
      expect(result, `dateISO=${JSON.stringify(bad)}`).toEqual({ ok: false });
      expect(lib.clearDateOverride).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  });

  // A missing field is `null`, not `''` — a separate path through `String(… ?? '')`.
  it('returns { ok: false } when dateISO is absent entirely', async () => {
    expect(await clearOverrideAction('club', null, fd({}))).toEqual({ ok: false });
    expect(lib.clearDateOverride).not.toHaveBeenCalled();
  });
});
