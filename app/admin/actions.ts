'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { setClubStatus } from '@/lib/clubs-admin';
import { requireAdmin } from '@/lib/session';
import { isUuid } from '@/lib/uuid';

export type SetClubStatusState = { ok: boolean; status?: 'active' | 'suspended'; error?: 'not_decided' | 'failed' };

export async function setClubStatusAction(
  _prev: SetClubStatusState | null,
  formData: FormData,
): Promise<SetClubStatusState> {
  const admin = await requireAdmin();
  const clubId = String(formData.get('clubId'));
  // Same guard its sibling `requests/actions.ts` has: `clubs.id` is a `uuid` column,
  // so a hand-crafted POST carrying `clubId=abc` reaches Postgres as 22P02. The catch
  // below would swallow it, but only after the statement has aborted a transaction and
  // logged a server error for a request that was never answerable.
  if (!isUuid(clubId)) return { ok: false, error: 'failed' };
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
