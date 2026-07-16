'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { setClubStatus } from '@/lib/clubs-admin';
import { requireAdmin } from '@/lib/session';

export async function setClubStatusAction(formData: FormData) {
  const admin = await requireAdmin();
  const clubId = String(formData.get('clubId'));
  const status = String(formData.get('status')) === 'active' ? 'active' : 'suspended';
  await setClubStatus(db, { clubId, status, actorId: admin.id });
  revalidatePath('/admin');
  revalidatePath('/admin/requests');
}
