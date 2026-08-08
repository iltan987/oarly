'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { decideClubRequest } from '@/lib/clubs-admin';
import { notifyClubDecision } from '@/lib/notify';
import { requireAdmin } from '@/lib/session';
import { isUuid } from '@/lib/uuid';

export type DecideState =
  | { ok: true; decision: 'approve' | 'reject' }
  | { ok: false; error: 'note_required' | 'not_pending' | 'failed' };

/**
 * Approve or reject a club REQUEST.
 *
 * Goes through `decideClubRequest`, never `setClubStatus`: approving a new club and
 * reinstating a suspended one are different acts and must leave different rows in the
 * audit log (`club.approve` vs `club.activate`, spec §5.3). `setClubStatus` refuses a
 * `pending` club outright, so this is the only path by which a request can be decided
 * at all.
 */
export async function decideClubRequestAction(
  _prev: DecideState | null,
  formData: FormData,
): Promise<DecideState> {
  // Re-checked here, not inherited from the layout: layouts do not govern server
  // actions, so this is reachable by a direct POST from anyone with a session.
  const admin = await requireAdmin();
  const clubId = String(formData.get('clubId'));
  // `clubs.id` is a `uuid` column, so a hand-crafted POST carrying `clubId=abc` reaches
  // Postgres as `invalid input syntax for type uuid` (22P02). The `catch` below would
  // swallow it, but only after the statement has already aborted a transaction and
  // logged a server error for a request that was never answerable — the shape check is
  // cheaper and says what actually happened.
  if (!isUuid(clubId)) return { ok: false, error: 'failed' };
  const decision = formData.get('decision') === 'approve' ? 'approve' : 'reject';
  // A rejection needs a real reason. `decideClubRequest` enforces this itself — the
  // column is nullable, because an approval has no note, so no schema constraint can —
  // and the dialog marks the field `required`. This is the middle layer: the action is
  // reachable by a direct POST that honours neither.
  const note = String(formData.get('note') ?? '');

  let res;
  try {
    res = await decideClubRequest(db, { clubId, decision, note, actorId: admin.id });
  } catch {
    return { ok: false, error: 'failed' };
  }
  if (!res.ok) {
    // `not_found` means the page is stale rather than that the operator did something
    // meaningful, so it reaches them as the generic failure. `not_pending` and
    // `note_required` are refusals with a reason worth reading.
    return { ok: false, error: res.error === 'not_found' ? 'failed' : res.error };
  }

  // AFTER the transaction has committed, and best-effort: `notifyClubDecision` swallows
  // its own errors, so a mail outage cannot undo a decision (spec §5.4).
  await notifyClubDecision(db, {
    clubId,
    decision: res.status === 'active' ? 'approved' : 'rejected',
    note: note.trim() || null,
  });

  revalidatePath('/admin/requests');
  revalidatePath('/admin');
  revalidatePath(`/admin/clubs/${clubId}`);
  return { ok: true, decision };
}
