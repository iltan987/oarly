'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { createClub } from '@/lib/clubs-admin';
import { createClubSchema } from '@/lib/schemas';
import { requireAdmin } from '@/lib/session';

/**
 * `values` for the same reason `app/request-club/actions.ts` carries it, and this form is
 * the same construction: three inputs with no `defaultValue`, so React 19's post-action
 * reset WIPED all three rather than reverting them (`form.reset()` restores a control to its
 * value attribute, which without a `defaultValue` is `''`).
 *
 * Echoed rather than left-with-a-reason even though this page is admin-only, because the
 * refusals are ordinary rather than crafted — `slug_taken` for a slug already in use, and
 * `owner_not_found` for an owner who has not signed up yet or whose address was mistyped —
 * and each of them names ONE field while silently emptying the other two, one of which is an
 * email address.
 */
export type CreateClubState = {
  errors?: Record<string, string>;
  values?: { name: string; slug: string; ownerEmail: string };
};

export async function createClubAction(_prev: CreateClubState, formData: FormData): Promise<CreateClubState> {
  const admin = await requireAdmin();
  const t = await getTranslations('admin');

  // Untrimmed and un-lowercased: what the admin has in front of them, not the normalised
  // form the schema parses.
  const values = {
    name: String(formData.get('name') ?? ''),
    slug: String(formData.get('slug') ?? ''),
    ownerEmail: String(formData.get('ownerEmail') ?? ''),
  };

  const parsed = createClubSchema.safeParse({
    name: String(formData.get('name') ?? '').trim(),
    slug: String(formData.get('slug') ?? '').trim().toLowerCase(),
    ownerEmail: String(formData.get('ownerEmail') ?? '').trim(),
  });
  if (!parsed.success) {
    const f = parsed.error.flatten().fieldErrors;
    return { values, errors: {
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
    return { errors: { [field]: message }, values };
  }

  revalidatePath('/admin');
  redirect('/admin?created=1');
}
