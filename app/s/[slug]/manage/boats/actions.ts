'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { createBoat, setBoatActive, updateBoat } from '@/lib/boats';
import { requireOwner } from '@/lib/membership';
import { boatSchema } from '@/lib/schemas';

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/boats`);
  revalidatePath(`/s/${slug}/manage`);
}

function parseBoat(formData: FormData) {
  return boatSchema.safeParse({
    name: String(formData.get('name') ?? '').trim(),
    seats: formData.get('seats'),
    minSkillLevelId: (String(formData.get('minSkillLevelId') ?? '') || null),
    allowedPayment: formData.get('allowedPayment'),
    minAttendance: (String(formData.get('minAttendance') ?? '') || null),
  });
}

export async function createBoatAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/boats');
  const parsed = parseBoat(formData);
  if (!parsed.success) return;
  await createBoat(db, club.id, parsed.data);
  refresh(slug);
}

export async function updateBoatAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/boats');
  const parsed = parseBoat(formData);
  if (!parsed.success) return;
  await updateBoat(db, { clubId: club.id, boatId: String(formData.get('boatId')), ...parsed.data });
  refresh(slug);
}

export async function setBoatActiveAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/boats');
  await setBoatActive(db, { clubId: club.id, boatId: String(formData.get('boatId')), active: formData.get('active') === 'true' });
  refresh(slug);
}
