'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { db } from '@/db';
import { requireAdmin } from '@/lib/session';
import { createClub } from '@/lib/clubs-admin';
import { createClubSchema } from '@/lib/schemas';

export type CreateClubState = { errors?: Record<string, string> };

export async function createClubAction(_prev: CreateClubState, formData: FormData): Promise<CreateClubState> {
  const admin = await requireAdmin();
  const t = await getTranslations('admin');

  const parsed = createClubSchema.safeParse({
    name: String(formData.get('name') ?? '').trim(),
    slug: String(formData.get('slug') ?? '').trim().toLowerCase(),
    ownerEmail: String(formData.get('ownerEmail') ?? '').trim(),
  });
  if (!parsed.success) {
    const f = parsed.error.flatten().fieldErrors;
    return { errors: {
      ...(f.name ? { name: t('errorNameInvalid') } : {}),
      ...(f.slug ? { slug: t('errorSlugInvalid') } : {}),
      ...(f.ownerEmail ? { ownerEmail: t('errorOwnerEmailInvalid') } : {}),
    } };
  }

  const res = await createClub(db, { ...parsed.data, createdBy: admin.id });
  if (!res.ok) {
    const map: Record<string, [string, string]> = {
      slug_invalid: ['slug', t('errorSlugInvalid')],
      slug_reserved: ['slug', t('errorSlugReserved')],
      slug_taken: ['slug', t('errorSlugTaken')],
      owner_not_found: ['ownerEmail', t('errorOwnerNotFound')],
    };
    const [field, message] = map[res.error];
    return { errors: { [field]: message } };
  }

  revalidatePath('/admin');
  redirect('/admin');
}
