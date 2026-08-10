'use server';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { requestClub } from '@/lib/club-request';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { enforceRateLimit } from '@/lib/rate-limit-guard';
import { clubRequestSchema } from '@/lib/schemas';
import { requireUser } from '@/lib/session';

/**
 * `values` is the SUBMITTED name and slug, echoed back on every refusal.
 *
 * These two inputs carry no `defaultValue`, and that is the WORSE half of the shape
 * `app/s/[slug]/manage/action-result.ts` describes: React 19 resets an uncontrolled form
 * after any completed form action, and `form.reset()` restores a control to its value
 * ATTRIBUTE — which, with no `defaultValue`, is `''`. So a refusal did not revert these
 * fields to something, it WIPED them.
 *
 * And the refusal is the ordinary one. `slug_taken` / `slug_reserved` is what a prospective
 * owner gets for picking a club name someone already has; the error names only the SLUG,
 * while the club name they typed vanished with no message about it at all. The rate-limited
 * refusal is form-level and names nothing. This is the first form anyone ever submits to
 * this product.
 */
export type RequestClubState = {
  errors?: Record<string, string>;
  values?: { name: string; slug: string };
};

export async function requestClubAction(_prev: RequestClubState, formData: FormData): Promise<RequestClubState> {
  const owner = await requireUser('/request-club');
  const t = await getTranslations('admin');

  // Untrimmed and un-lowercased: what the visitor has in front of them, not the normalised
  // form the schema parses.
  const values = {
    name: String(formData.get('name') ?? ''),
    slug: String(formData.get('slug') ?? ''),
  };

  const verdict = await enforceRateLimit([
    { key: `clubreq:acct:${owner.id}`, rule: RATE_LIMITS.clubRequestPerAccount },
  ]);
  if (verdict.limited) return { errors: { form: t('errorTooManyRequests') }, values };

  const parsed = clubRequestSchema.safeParse({
    name: String(formData.get('name') ?? '').trim(),
    slug: String(formData.get('slug') ?? '').trim().toLowerCase(),
  });
  if (!parsed.success) {
    const f = parsed.error.flatten().fieldErrors;
    return { values, errors: {
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
    return { errors: { [field]: message }, values };
  }

  redirect('/request-club?submitted=1');
}
