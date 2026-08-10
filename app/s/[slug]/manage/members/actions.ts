'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import { db } from '@/db';
import { assignSkillLevel, liftPenalties, setMembershipStatus } from '@/lib/members-admin';
import { requireOwner } from '@/lib/membership';
import { notifyPenaltyLift } from '@/lib/notify';
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

/**
 * Reverse the penalties a member is serving. `liftPenalties` is the only thing in the
 * product that undoes a permanent suspension — see its doc comment for why
 * `rejectMemberAction`'s neighbour, `setMembershipStatus('approved')`, is not.
 *
 * AND TELL THEM. Imposing the suspension mailed the member (`markNoShowAction` ->
 * `notifyNoShowPenalty`); reversing it used to be silent, so somebody was told in writing
 * that their booking access was closed and would not reopen by itself, and then it
 * reopened with no signal at all — their `/book` page and the `/book` tab just came back.
 * Nothing else in this product changes a member-visible state of this weight without
 * saying so.
 *
 * Ordered like `markNoShowAction` for the reasons that action gives: the send is in
 * `after()`, so it happens once `liftPenalties` has COMMITTED and a mail failure cannot
 * roll the reinstatement back — and `notifyPenaltyLift` swallows its own errors, so a
 * dead mailer costs the member their notice, never their access.
 *
 * Gated on `lifted > 0`, which is the whole reason `liftPenalties` reports it. `ok: true`
 * alone also covers the no-op — the stale-page second click on a member who is no longer
 * suspended — and mailing on that tells somebody their restriction has just been lifted
 * when nothing happened and, quite possibly, when they were never restricted.
 */
export async function liftSuspensionAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club, user } = await requireOwner(slug);
  const membershipId = String(formData.get('membershipId'));
  if (!isUuid(membershipId)) return { ok: false };
  const result = await liftPenalties(db, { membershipId, clubId: club.id, actorId: user.id });
  revalidatePath(`/s/${slug}/manage/members`);
  if (result.ok && result.lifted > 0) {
    after(async () => { await notifyPenaltyLift(db, { membershipId }); });
  }
  return { ok: result.ok };
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
