'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { addSocial, removeSocial, updateClubProfile } from '@/lib/club-profile';
import { requireOwner } from '@/lib/membership';
import { clubProfileSchema, socialSchema } from '@/lib/schemas';

function refresh(slug: string) {
  revalidatePath(`/s/${slug}/manage/profile`);
  revalidatePath(`/s/${slug}/manage`);
  revalidatePath(`/s/${slug}`); // public club page + metadata
}

export async function saveProfileAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/profile');
  const parsed = clubProfileSchema.safeParse({
    name: String(formData.get('name') ?? '').trim(),
    tagline: String(formData.get('tagline') ?? '').trim() || undefined,
    description: String(formData.get('description') ?? '').trim() || undefined,
    phone: String(formData.get('phone') ?? '').trim() || undefined,
    brandAccent: String(formData.get('brandAccent') ?? '').trim() || undefined,
    headingFont: formData.get('headingFont') ?? 'default',
    logoUrl: String(formData.get('logoUrl') ?? '').trim() || undefined,
  });
  if (!parsed.success) return;
  const d = parsed.data;
  await updateClubProfile(db, club.id, {
    name: d.name,
    tagline: d.tagline ?? null,
    description: d.description ?? null,
    phone: d.phone ?? null,
    brandAccent: d.brandAccent ?? null,
    headingFont: d.headingFont,
    logoUrl: d.logoUrl ? d.logoUrl : null,
  });
  refresh(slug);
}

export async function addSocialAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/profile');
  const parsed = socialSchema.safeParse({
    platform: String(formData.get('platform') ?? '').trim(),
    handle: String(formData.get('handle') ?? '').trim(),
  });
  if (!parsed.success) return;
  await addSocial(db, { clubId: club.id, ...parsed.data });
  refresh(slug);
}

export async function removeSocialAction(slug: string, formData: FormData) {
  const { club } = await requireOwner(slug, '/manage/profile');
  await removeSocial(db, { clubId: club.id, socialId: String(formData.get('socialId')) });
  refresh(slug);
}
