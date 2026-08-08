'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { transferOwnership } from '@/lib/clubs-admin';
import { requireAdmin } from '@/lib/session';

export type TransferOwnerState =
  | { ok: true }
  | { ok: false; error: 'target_not_member' | 'already_owner' | 'failed' };

/**
 * `clubId` is bound at the call site rather than read from the form: it is the route
 * this action belongs to, not something the submitter gets to choose. A hidden field
 * would let a crafted POST move ownership of a DIFFERENT club.
 */
export async function transferOwnershipAction(
  clubId: string,
  _prev: TransferOwnerState | null,
  formData: FormData,
): Promise<TransferOwnerState> {
  // Re-checked here, not inherited from the layout: layouts do not govern server
  // actions, so this is reachable by a direct POST from anyone with a session.
  const admin = await requireAdmin();
  const toUserId = String(formData.get('toUserId') ?? '');
  if (!toUserId) return { ok: false, error: 'failed' };

  let res;
  try {
    res = await transferOwnership(db, { clubId, toUserId, actorId: admin.id });
  } catch {
    return { ok: false, error: 'failed' };
  }
  // `club_not_found` means this page is stale, not that the operator did something
  // meaningful — it reaches them as the generic failure. The other two are refusals
  // with a reason worth reading, and neither can succeed on a retry.
  if (!res.ok) return { ok: false, error: res.error === 'club_not_found' ? 'failed' : res.error };

  revalidatePath(`/admin/clubs/${clubId}`);
  // The users page lists each user's memberships with their role, so it is stale too.
  revalidatePath('/admin/users');
  return { ok: true };
}
