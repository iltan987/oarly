'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { assignSkillLevel, setMembershipStatus } from '@/lib/members-admin';
import { requireOwner } from '@/lib/membership';

export type ManageActionResult = { ok: true } | { ok: false };

export async function approveMemberAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug);
  const ok = await setMembershipStatus(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, status: 'approved' });
  revalidatePath(`/s/${slug}/manage/members`);
  return { ok };
}

export async function rejectMemberAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug);
  const ok = await setMembershipStatus(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, status: 'rejected' });
  revalidatePath(`/s/${slug}/manage/members`);
  return { ok };
}

export async function assignSkillAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug);
  const raw = String(formData.get('skillLevelId') ?? '');
  const ok = await assignSkillLevel(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, skillLevelId: raw || null });
  revalidatePath(`/s/${slug}/manage/members`);
  return { ok };
}
