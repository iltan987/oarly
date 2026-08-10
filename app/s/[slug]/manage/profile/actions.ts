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
 * `headingFont` and `logoUrl` are deliberately absent: both are hidden inputs whose value
 * comes from React state (`ProfileForm`'s `headingFont`, `LogoUpload`'s `url`), and a form
 * reset does not touch React state — React re-syncs a controlled input's value on the next
 * render. Echoing them would only give them a second, staler source of truth.
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
 * schedules the reset before the action even runs (`startHostTransition` ->
 * `requestFormReset`, react-dom 19.2.8), so a refusal wiped the owner's edits back to the
 * stored text. Measured in Chrome: same `<form>` DOM node, a native `reset` event, and a
 * 2001-character description replaced by the stored one.
 *
 * Returning the refused values is what lets `profile-form.tsx` hand them back to the inputs
 * as their new `defaultValue`: React writes that to the value attribute before the reset
 * runs in the same commit, so the reset restores what the owner typed instead of what is
 * stored. No remount is needed and none is used — see that file's comment for why
 * remounting would be worse.
 *
 * Returned FROM THE SERVER rather than snapshotted in the client so it also works on the
 * pre-hydration path, where the refusal arrives as a full-page POST and the form is
 * rendered on the server from this result.
 *
 * Size: the echo is bounded by Next's server-action `bodySizeLimit` (1 MB by default),
 * which already capped the request this echoes.
 */
export type ProfileSaveResult =
  | { ok: true }
  | { ok: false; values: ProfileFormValues };

export async function saveProfileAction(slug: string, _prev: ProfileSaveResult | null, formData: FormData): Promise<ProfileSaveResult> {
  const { club, user } = await requireOwner(slug, '/manage/profile');
  const submitted: ProfileFormValues = {
    name: String(formData.get('name') ?? ''),
    tagline: String(formData.get('tagline') ?? ''),
    description: String(formData.get('description') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    brandAccent: String(formData.get('brandAccent') ?? ''),
  };
  const refuse = (): ProfileSaveResult => ({ ok: false, values: submitted });

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
