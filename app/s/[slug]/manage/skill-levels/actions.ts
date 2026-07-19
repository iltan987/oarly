'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { skillLevelNameSchema } from '@/lib/schemas';
import { createSkillLevel, deleteSkillLevel, renameSkillLevel, reorderSkillLevel } from '@/lib/skill-levels';

import type { ManageActionResult } from '../action-result';

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/skill-levels`);
  revalidatePath(`/s/${slug}/manage`);
}

export async function addSkillLevelAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug, '/manage/skill-levels');
  const parsed = skillLevelNameSchema.safeParse({ name: String(formData.get('name') ?? '').trim() });
  if (!parsed.success) return { ok: false };
  // createSkillLevel throws on the (club_id, rank) unique collision that a
  // concurrent create can cause — treat any failure as a surfaced error.
  try {
    await createSkillLevel(db, { clubId: club.id, name: parsed.data.name });
  } catch {
    return { ok: false };
  }
  refresh(slug);
  return { ok: true };
}

export async function renameSkillLevelAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug, '/manage/skill-levels');
  const parsed = skillLevelNameSchema.safeParse({ name: String(formData.get('name') ?? '').trim() });
  if (!parsed.success) return { ok: false };
  const ok = await renameSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')), name: parsed.data.name });
  if (ok) refresh(slug);
  return { ok };
}

export async function reorderSkillLevelAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug, '/manage/skill-levels');
  const direction = formData.get('direction') === 'up' ? 'up' : 'down';
  try {
    const ok = await reorderSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')), direction });
    if (ok) refresh(slug);
    return { ok };
  } catch {
    return { ok: false };
  }
}

export async function deleteSkillLevelAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug, '/manage/skill-levels');
  const ok = await deleteSkillLevel(db, { clubId: club.id, skillLevelId: String(formData.get('skillLevelId')) });
  if (ok) refresh(slug);
  return { ok };
}
