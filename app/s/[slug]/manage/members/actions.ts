'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { assignSkillLevel, setMembershipStatus } from '@/lib/members-admin';
import { requireOwner } from '@/lib/membership';
import { isUuid } from '@/lib/uuid';

import type { ManageActionResult } from '../action-result';

export async function approveMemberAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club, user } = await requireOwner(slug);
  const membershipId = String(formData.get('membershipId'));
  if (!isUuid(membershipId)) return { ok: false };
  const ok = await setMembershipStatus(db, { membershipId, clubId: club.id, status: 'approved', actorId: user.id });
  revalidatePath(`/s/${slug}/manage/members`);
  return { ok };
}

export async function rejectMemberAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club, user } = await requireOwner(slug);
  const membershipId = String(formData.get('membershipId'));
  if (!isUuid(membershipId)) return { ok: false };
  const ok = await setMembershipStatus(db, { membershipId, clubId: club.id, status: 'rejected', actorId: user.id });
  revalidatePath(`/s/${slug}/manage/members`);
  return { ok };
}

export async function assignSkillAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club, user } = await requireOwner(slug);
  const membershipId = String(formData.get('membershipId'));
  const raw = String(formData.get('skillLevelId') ?? '');
  // Empty is a legitimate value here — it clears the level. Anything else must be
  // uuid-shaped, since both ids are bound into `uuid` columns.
  if (!isUuid(membershipId) || (raw !== '' && !isUuid(raw))) return { ok: false };
  const ok = await assignSkillLevel(db, { membershipId, clubId: club.id, skillLevelId: raw || null, actorId: user.id });
  revalidatePath(`/s/${slug}/manage/members`);
  return { ok };
}
