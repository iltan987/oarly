/**
 * `deleteWindowAction`'s result contract. The malformed-id half of it is covered for
 * the whole manage tree in `../uuid-guard.test.ts`; what is only expressible here is
 * the ALREADY-DELETED path — `deleteWindow` returns false when no row matched, which a
 * `void` return could not report and so left the owner watching a row that stayed put
 * with no explanation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const lib = vi.hoisted(() => ({
  deleteWindow: vi.fn(async () => true),
  createWindow: vi.fn(),
  updateWindow: vi.fn(),
}));

vi.mock('@/lib/membership', () => ({
  requireOwner: async () => ({ club: { id: 'club-1' }, user: { id: 'u1' } }),
}));
vi.mock('@/lib/schedule', () => ({
  createWindow: lib.createWindow, updateWindow: lib.updateWindow, deleteWindow: lib.deleteWindow,
}));

import { revalidatePath } from 'next/cache';

import { deleteWindowAction } from './actions';

const UUID = '4d4b7b0f-1f6c-4d7e-9b1a-2f2c9b8a1234';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  lib.deleteWindow.mockResolvedValue(true);
});

describe('deleteWindowAction', () => {
  it('returns { ok: true } and revalidates when a row was deleted', async () => {
    expect(await deleteWindowAction('club', null, fd({ windowId: UUID }))).toEqual({ ok: true });
    expect(lib.deleteWindow).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/s/club/manage/schedule');
  });

  it('returns { ok: false } for a malformed windowId, without querying', async () => {
    expect(await deleteWindowAction('club', null, fd({ windowId: 'not-a-uuid' }))).toEqual({ ok: false });
    expect(lib.deleteWindow).not.toHaveBeenCalled();
  });

  // The case the task exists for. A second delete of the same window — another tab got
  // there first — matches no row, so `deleteWindow` returns false and NOTHING happened:
  // no delete, no audit row. Reporting `{ ok: true }` here would tell the owner a
  // deletion they did not perform had succeeded.
  it('returns { ok: false } when the window was already gone', async () => {
    lib.deleteWindow.mockResolvedValue(false);
    expect(await deleteWindowAction('club', null, fd({ windowId: UUID }))).toEqual({ ok: false });
  });

  // A refusal that leaves the phantom row on screen is an unrecoverable loop: the toast
  // says "try again", the retry deletes the same missing row, and the same toast comes
  // back forever. The refresh is what makes the retry the copy asks for possible, so it
  // must happen on this failure even though nothing was written.
  it('still revalidates when the window was already gone, so the phantom row leaves', async () => {
    lib.deleteWindow.mockResolvedValue(false);
    await deleteWindowAction('club', null, fd({ windowId: UUID }));
    expect(revalidatePath).toHaveBeenCalledWith('/s/club/manage/schedule');
  });

  // But the malformed-id refusal must NOT refresh — nothing on screen is stale there,
  // and a route refresh alongside that toast would imply something changed.
  it('does not revalidate when the id was refused', async () => {
    await deleteWindowAction('club', null, fd({ windowId: 'not-a-uuid' }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
