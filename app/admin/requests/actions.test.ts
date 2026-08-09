import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decideClubRequest, setClubStatus, notifyClubDecision, revalidatePath, requireAdmin } = vi.hoisted(() => ({
  decideClubRequest: vi.fn(),
  setClubStatus: vi.fn(),
  notifyClubDecision: vi.fn(),
  revalidatePath: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/clubs-admin', () => ({ decideClubRequest, setClubStatus }));
vi.mock('@/lib/notify', () => ({ notifyClubDecision }));
vi.mock('@/lib/session', () => ({ requireAdmin }));

import { decideClubRequestAction } from './actions';

const actorId = randomUUID();
const clubId = randomUUID();

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('decideClubRequestAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: actorId, isAdmin: true });
    decideClubRequest.mockResolvedValue({ ok: true, status: 'active', requesterId: null, clubName: 'C', clubSlug: 'c' });
  });

  // The separation the whole rebuild exists for (spec §5.3): approving a NEW club and
  // reinstating a suspended one are different acts and must leave different audit rows
  // (`club.approve` vs `club.activate`). `setClubStatus` refuses a pending club anyway,
  // so routing an approval through it would fail on every click.
  it('approves through decideClubRequest and never through setClubStatus', async () => {
    const res = await decideClubRequestAction(null, form({ clubId, decision: 'approve', note: '' }));

    expect(decideClubRequest).toHaveBeenCalledWith({}, { clubId, decision: 'approve', note: '', actorId });
    expect(setClubStatus).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, decision: 'approve' });
  });

  it('rejects through decideClubRequest, carrying the note', async () => {
    decideClubRequest.mockResolvedValue({ ok: true, status: 'rejected', requesterId: null, clubName: 'C', clubSlug: 'c' });
    const res = await decideClubRequestAction(null, form({ clubId, decision: 'reject', note: '  Duplicate  ' }));

    expect(decideClubRequest).toHaveBeenCalledWith({}, { clubId, decision: 'reject', note: '  Duplicate  ', actorId });
    expect(res).toEqual({ ok: true, decision: 'reject' });
  });

  // A server action is reachable by a direct POST, so `decision` is whatever the caller
  // sent. Anything that is not literally `approve` must fall to the SAFE side: a
  // mistaken rejection is recoverable by asking again, an unintended approval puts a
  // club live under a name nobody reviewed.
  it.each(['', 'banana', 'Approve', 'true'])('treats decision=%o as a rejection, not an approval', async (decision) => {
    decideClubRequest.mockResolvedValue({ ok: true, status: 'rejected', requesterId: null, clubName: 'C', clubSlug: 'c' });
    await decideClubRequestAction(null, form({ clubId, decision, note: 'why' }));
    expect(decideClubRequest).toHaveBeenCalledWith({}, expect.objectContaining({ decision: 'reject' }));
  });

  // `clubs.id` is a `uuid` column: a crafted `clubId=abc` reaches Postgres as
  // `invalid input syntax for type uuid` (22P02). The guard answers before a statement
  // is ever issued.
  it.each(['abc', '', 'undefined', '00000000-0000-0000-0000-00000000000'])(
    'refuses a non-uuid club id (%o) without touching the database',
    async (bad) => {
      const res = await decideClubRequestAction(null, form({ clubId: bad, decision: 'approve', note: '' }));
      expect(res).toEqual({ ok: false, error: 'failed' });
      expect(decideClubRequest).not.toHaveBeenCalled();
      expect(notifyClubDecision).not.toHaveBeenCalled();
    },
  );

  it('re-checks admin authority itself, because a layout does not govern a server action', async () => {
    requireAdmin.mockRejectedValue(new Error('not an admin'));
    await expect(decideClubRequestAction(null, form({ clubId, decision: 'approve', note: '' }))).rejects.toThrow();
    expect(decideClubRequest).not.toHaveBeenCalled();
  });

  // The mail goes out AFTER the decision has committed, with the note the requester
  // needs to read, and the outcome is taken from what the transaction actually wrote —
  // not from what the form asked for.
  it('emails the requester the committed outcome, with the note trimmed', async () => {
    decideClubRequest.mockResolvedValue({ ok: true, status: 'rejected', requesterId: null, clubName: 'C', clubSlug: 'c' });
    await decideClubRequestAction(null, form({ clubId, decision: 'reject', note: '  Duplicate club  ' }));
    expect(notifyClubDecision).toHaveBeenCalledWith({}, { clubId, decision: 'rejected', note: 'Duplicate club' });
  });

  it('sends no email and revalidates nothing when the decision is refused', async () => {
    decideClubRequest.mockResolvedValue({ ok: false, error: 'not_pending' });
    const res = await decideClubRequestAction(null, form({ clubId, decision: 'approve', note: '' }));

    expect(res).toEqual({ ok: false, error: 'not_pending' });
    expect(notifyClubDecision).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // `not_found` means the operator's page is stale, not that they did something
  // meaningful — it must not surface as its own message.
  it('reports not_found as the generic failure', async () => {
    decideClubRequest.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await decideClubRequestAction(null, form({ clubId, decision: 'approve', note: '' })))
      .toEqual({ ok: false, error: 'failed' });
  });

  it('surfaces a thrown query as a failure rather than a crash', async () => {
    decideClubRequest.mockRejectedValue(new Error('connection reset'));
    expect(await decideClubRequestAction(null, form({ clubId, decision: 'approve', note: '' })))
      .toEqual({ ok: false, error: 'failed' });
    expect(notifyClubDecision).not.toHaveBeenCalled();
  });

  // The queue, the clubs list and the club's own detail page all show this club's
  // status; leaving any of them cached shows the decision as not having happened.
  it('revalidates every page that shows the decided club', async () => {
    await decideClubRequestAction(null, form({ clubId, decision: 'approve', note: '' }));
    expect(revalidatePath.mock.calls.map(([p]) => p)).toEqual(
      expect.arrayContaining(['/admin/requests', '/admin', `/admin/clubs/${clubId}`]),
    );
  });
});
