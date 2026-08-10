'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { addSocial, removeSocial, updateClubProfile } from '@/lib/club-profile';
import { requireOwner } from '@/lib/membership';
import { clubProfileSchema, socialSchema } from '@/lib/schemas';
import { isUuid } from '@/lib/uuid';

import type { ManageActionResult } from '../action-result';

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/profile`);
  revalidatePath(`/s/${slug}/manage`);
  revalidatePath(`/s/${slug}`); // public club page + metadata
}

/**
 * The five fields the owner TYPES into, exactly as they were submitted — untrimmed, so a
 * refused save hands back the characters the owner actually has in front of them rather
 * than a normalised version of them.
 *
 * `headingFont` and `logoUrl` are deliberately absent: both are hidden inputs fed by
 * client state that lives OUTSIDE the remounted form (`ProfileForm`'s `headingFont` and
 * `logoUrl`), so they survive a refusal on their own and echoing them would only give
 * them a second, staler source of truth.
 */
export type ProfileFormValues = {
  name: string;
  tagline: string;
  description: string;
  phone: string;
  brandAccent: string;
};

/**
 * Wider than `ManageActionResult` on the refusal side, and that is the whole point.
 *
 * React 19 resets an uncontrolled form after ANY completed form action — `<form action>`
 * schedules the reset before the action even runs (`startHostTransition` →
 * `requestFormReset`, react-dom 19.2.8), so a refusal wipes the owner's edits back to the
 * stored text. Measured in a browser: same `<form>` DOM node, a native `reset` event, and
 * a 2001-character description replaced by the stored one.
 *
 * Returning the refused values is what lets `profile-form.tsx` re-seed the inputs with
 * them. It is returned FROM THE SERVER rather than snapshotted in the client so it also
 * works on the pre-hydration path, where the refusal arrives as a full-page POST and the
 * form is rendered on the server from this result.
 *
 * `attempt` exists because re-seeding needs a REMOUNT: the inputs are uncontrolled, and
 * feeding a live one a new `defaultValue` is exactly what Base UI warns about ("A
 * component is changing the default value state of an uncontrolled input after being
 * initialized"). `club.updatedAt` cannot move on a refusal — nothing is persisted — so
 * the form key needs a second component that does.
 *
 * Size: the echo is bounded by Next's server-action `bodySizeLimit` (1 MB by default),
 * which already capped the request this echoes.
 */
export type ProfileSaveResult =
  | { ok: true }
  | { ok: false; attempt: number; values: ProfileFormValues };

export async function saveProfileAction(slug: string, prev: ProfileSaveResult | null, formData: FormData): Promise<ProfileSaveResult> {
  const { club, user } = await requireOwner(slug, '/manage/profile');
  const submitted: ProfileFormValues = {
    name: String(formData.get('name') ?? ''),
    tagline: String(formData.get('tagline') ?? ''),
    description: String(formData.get('description') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    brandAccent: String(formData.get('brandAccent') ?? ''),
  };
  const refuse = (): ProfileSaveResult => ({
    ok: false,
    attempt: (prev !== null && !prev.ok ? prev.attempt : 0) + 1,
    values: submitted,
  });

  const parsed = clubProfileSchema.safeParse({
    name: submitted.name.trim(),
    tagline: submitted.tagline.trim() || undefined,
    description: submitted.description.trim() || undefined,
    phone: submitted.phone.trim() || undefined,
    brandAccent: submitted.brandAccent.trim() || undefined,
    headingFont: formData.get('headingFont') ?? 'default',
    logoUrl: String(formData.get('logoUrl') ?? '').trim() || undefined,
  });
  if (!parsed.success) return refuse();
  const d = parsed.data;
  const ok = await updateClubProfile(db, club.id, {
    name: d.name,
    tagline: d.tagline ?? null,
    description: d.description ?? null,
    phone: d.phone ?? null,
    brandAccent: d.brandAccent ?? null,
    headingFont: d.headingFont,
    logoUrl: d.logoUrl ? d.logoUrl : null,
  }, user.id);
  if (!ok) return refuse();
  refresh(slug);
  return { ok: true };
}

export async function addSocialAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug, '/manage/profile');
  const parsed = socialSchema.safeParse({
    platform: String(formData.get('platform') ?? '').trim(),
    handle: String(formData.get('handle') ?? '').trim(),
  });
  if (!parsed.success) return { ok: false };
  await addSocial(db, { clubId: club.id, ...parsed.data });
  refresh(slug);
  return { ok: true };
}

export async function removeSocialAction(slug: string, _prev: ManageActionResult | null, formData: FormData): Promise<ManageActionResult> {
  const { club } = await requireOwner(slug, '/manage/profile');
  const socialId = String(formData.get('socialId'));
  if (!isUuid(socialId)) return { ok: false };
  const ok = await removeSocial(db, { clubId: club.id, socialId });
  if (ok) refresh(slug);
  return { ok };
}
