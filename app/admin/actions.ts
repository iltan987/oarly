'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { setClubStatus } from '@/lib/clubs-admin';
import { requireAdmin } from '@/lib/session';

export type SetClubStatusState = { ok: boolean; status?: 'active' | 'suspended'; error?: 'not_decided' | 'failed' };

export async function setClubStatusAction(
  _prev: SetClubStatusState | null,
  formData: FormData,
): Promise<SetClubStatusState> {
  const admin = await requireAdmin();
  const clubId = String(formData.get('clubId'));
  const status = String(formData.get('status')) === 'active' ? 'active' : 'suspended';
  let res;
  try {
    res = await setClubStatus(db, { clubId, status, actorId: admin.id });
  } catch {
    return { ok: false, error: 'failed' };
  }
  // `not_decided` reaches the user verbatim rather than as a generic failure: it
  // means the row is `pending` or `rejected`, which the clubs list no longer offers
  // a control for, so seeing it means the page is stale — a retry will not help.
  if (!res.ok) return { ok: false, error: res.error === 'not_decided' ? 'not_decided' : 'failed' };
  // `/admin/requests` is deliberately not revalidated: this action can no longer
  // move a club into or out of the requests queue.
  revalidatePath('/admin');
  revalidatePath(`/admin/clubs/${clubId}`);
  return { ok: true, status: res.status };
}
