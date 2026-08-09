import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: async () => ({ id: 'admin-1' }) }));

const { setClubStatus } = vi.hoisted(() => ({
  setClubStatus: vi.fn(async () => ({ ok: true as const, status: 'suspended' as const })),
}));
vi.mock('@/lib/clubs-admin', () => ({ setClubStatus }));

import { setClubStatusAction } from './actions';

const UUID = '4d4b7b0f-1f6c-4d7e-9b1a-2f2c9b8a1234';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('setClubStatusAction', () => {
  /**
   * `clubs.id` is a `uuid` column, and this action is reachable by a direct POST from
   * anyone with a session — layouts do not govern server actions. Its sibling
   * `requests/actions.ts` already refused a malformed id before the query; this one
   * relied on the catch, which fires only after the statement has aborted a
   * transaction and logged a server error for a request that was never answerable.
   */
  it.each(['abc', '1', "'; DROP TABLE clubs; --", '4d4b7b0f-1f6c-4d7e-9b1a-2f2c9b8a123', ''])(
    'refuses clubId=%j without reaching the database',
    async (clubId) => {
      const res = await setClubStatusAction(null, fd({ clubId, status: 'suspend' }));
      expect(res).toEqual({ ok: false, error: 'failed' });
      expect(setClubStatus).not.toHaveBeenCalled();
    },
  );

  it('still drives a well-formed request through', async () => {
    const res = await setClubStatusAction(null, fd({ clubId: UUID, status: 'suspend' }));
    expect(setClubStatus).toHaveBeenCalledWith({}, { clubId: UUID, status: 'suspended', actorId: 'admin-1' });
    expect(res).toEqual({ ok: true, status: 'suspended' });
  });

  // `invalid_status` is a server-side refusal the operator cannot act on, so it
  // reaches them as the generic failure rather than as the `not_decided` message,
  // which says something specific and untrue about the club's current state.
  it('reports an invalid_status refusal generically, not as not_decided', async () => {
    setClubStatus.mockResolvedValue({ ok: false, error: 'invalid_status' } as never);
    const res = await setClubStatusAction(null, fd({ clubId: UUID, status: 'suspend' }));
    expect(res).toEqual({ ok: false, error: 'failed' });
  });
});
