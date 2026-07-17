'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { skillLevelNameSchema } from '@/lib/schemas';
import { createSkillLevel, deleteSkillLevel, renameSkillLevel, reorderSkillLevel } from '@/lib/skill-levels';

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/skill-levels`);
  revalidatePath(`/s/${slug}/manage`);
}

export async function addSkillLevelAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/skill-levels');
  const parsed = skillLevelNameSchema.safeParse({ name: String(formData.get('name') ?? '').trim() });
  if (!parsed.success) return;
  await createSkillLevel(db, { clubId: club.id, name: parsed.data.name });
  refresh(slug);
}

export async function renameSkillLevelAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/skill-levels');
  const parsed = skillLevelNameSchema.safeParse({ name: String(formData.get('name') ?? '').trim() });
  if (!parsed.success) return;
  await renameSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')), name: parsed.data.name });
  refresh(slug);
}

export async function reorderSkillLevelAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/skill-levels');
  const direction = formData.get('direction') === 'up' ? 'up' : 'down';
  await reorderSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')), direction });
  refresh(slug);
}

export async function deleteSkillLevelAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/skill-levels');
  await deleteSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')) });
  refresh(slug);
}
