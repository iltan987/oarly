'use server';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { setMembershipStatus, assignSkillLevel } from '@/lib/members-admin';

export async function approveMemberAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug);
  await setMembershipStatus(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, status: 'approved' });
  revalidatePath(`/s/${slug}/manage/members`);
}

export async function rejectMemberAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug);
  await setMembershipStatus(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, status: 'rejected' });
  revalidatePath(`/s/${slug}/manage/members`);
}

export async function assignSkillAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug);
  const raw = String(formData.get('skillLevelId') ?? '');
  await assignSkillLevel(db, { membershipId: String(formData.get('membershipId')), clubId: club.id, skillLevelId: raw || null });
  revalidatePath(`/s/${slug}/manage/members`);
}
