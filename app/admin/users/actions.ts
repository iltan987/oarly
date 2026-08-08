'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireAdmin } from '@/lib/session';
import { setPlatformAdmin } from '@/lib/users-admin';

export type SetPlatformAdminState =
  | { ok: true; isAdmin: boolean }
  | { ok: false; error: 'self_revoke' | 'last_admin' | 'failed' };

export async function setPlatformAdminAction(
  _prev: SetPlatformAdminState | null,
  formData: FormData,
): Promise<SetPlatformAdminState> {
  // Re-checked here, not inherited from the layout: layouts do not govern server
  // actions, so this is reachable by a direct POST from anyone with a session.
  const admin = await requireAdmin();
  const targetUserId = String(formData.get('userId'));
  const isAdmin = formData.get('isAdmin') === 'true';
  let res;
  try {
    res = await setPlatformAdmin(db, { targetUserId, isAdmin, actorId: admin.id });
  } catch {
    return { ok: false, error: 'failed' };
  }
  if (!res.ok) {
    // `not_found` means the page is stale, not that the operator did something
    // meaningful — it reaches them as the generic failure. `self_revoke` and
    // `last_admin` are refusals with a reason worth reading.
    return { ok: false, error: res.error === 'not_found' ? 'failed' : res.error };
  }
  revalidatePath('/admin/users');
  return { ok: true, isAdmin: res.isAdmin };
}
