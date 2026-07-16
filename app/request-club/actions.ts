'use server';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { requestClub } from '@/lib/club-request';
import { clubRequestSchema } from '@/lib/schemas';
import { requireUser } from '@/lib/session';

export type RequestClubState = { errors?: Record<string, string> };

export async function requestClubAction(_prev: RequestClubState, formData: FormData): Promise<RequestClubState> {
  const owner = await requireUser('/request-club');
  const t = await getTranslations('admin');

  const parsed = clubRequestSchema.safeParse({
    name: String(formData.get('name') ?? '').trim(),
    slug: String(formData.get('slug') ?? '').trim().toLowerCase(),
  });
  if (!parsed.success) {
    const f = parsed.error.flatten().fieldErrors;
    return { errors: {
      ...(f.name ? { name: t('errorNameInvalid') } : {}),
      ...(f.slug ? { slug: t('errorSlugInvalid') } : {}),
    } };
  }

  const res = await requestClub(db, { ...parsed.data, ownerId: owner.id });
  if (!res.ok) {
    const map: Record<string, [string, string]> = {
      slug_invalid: ['slug', t('errorSlugInvalid')],
      slug_reserved: ['slug', t('errorSlugReserved')],
      slug_taken: ['slug', t('errorSlugTaken')],
    };
    const [field, message] = map[res.error];
    return { errors: { [field]: message } };
  }

  redirect('/request-club?submitted=1');
}
