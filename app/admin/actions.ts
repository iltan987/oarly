'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { setClubStatus } from '@/lib/clubs-admin';
import { requireAdmin } from '@/lib/session';

export type SetClubStatusState = { ok: boolean; status?: 'active' | 'suspended' };

export async function setClubStatusAction(
  _prev: SetClubStatusState | null,
  formData: FormData,
): Promise<SetClubStatusState> {
  const admin = await requireAdmin();
  const clubId = String(formData.get('clubId'));
  const status = String(formData.get('status')) === 'active' ? 'active' : 'suspended';
  try {
    await setClubStatus(db, { clubId, status, actorId: admin.id });
  } catch {
    return { ok: false };
  }
  revalidatePath('/admin');
  revalidatePath('/admin/requests');
  return { ok: true, status };
}
