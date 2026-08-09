'use server';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { enforceRateLimit } from '@/lib/rate-limit-guard';
import { accountProfileSchema } from '@/lib/schemas';
import { requireUser } from '@/lib/session';
import { updateUserProfile } from '@/lib/user-profile';

/**
 * Local to this route rather than in a shared `action-result.ts`.
 * `app/s/[slug]/manage/action-result.ts` states its own reason for existing — keeping four
 * sibling action modules from drifting apart — and there is exactly one consumer here.
 *
 * `rate_limited` is a distinct reason, not folded into `invalid`: the two need different
 * copy. "Check the fields" is actively misleading advice to someone whose fields are fine
 * and who simply has to wait.
 */
export type AccountActionResult = { ok: true } | { ok: false; reason: 'invalid' | 'rate_limited' };

export async function saveAccountAction(
  _prev: AccountActionResult | null,
  formData: FormData,
): Promise<AccountActionResult> {
  /*
   * THE authorization story, in full: the row written is chosen by `user.id` from the
   * SESSION. Nothing in `formData` selects a row, and nothing here ever reads an id out of
   * it. A server action is reachable by a direct POST with any body the caller likes, so
   * an id taken from the form would be a plain IDOR — anyone could rewrite anyone's name,
   * phone and birthday. `app/account/actions.test.ts` submits someone else's id and pins
   * that it changes nothing.
   */
  const user = await requireUser('/account');

  // Per-ACCOUNT, and above the parse for the reason `bookSeatAction` documents: an
  // exhausted caller must not cost us a validation pass or a DB round trip.
  const verdict = await enforceRateLimit([
    { key: `account:acct:${user.id}`, rule: RATE_LIMITS.accountUpdatePerAccount },
  ]);
  if (verdict.limited) return { ok: false, reason: 'rate_limited' };

  const parsed = accountProfileSchema.safeParse({
    firstName: String(formData.get('firstName') ?? '').trim(),
    lastName: String(formData.get('lastName') ?? '').trim(),
    phone: String(formData.get('phone') ?? '').trim(),
    birthday: String(formData.get('birthday') ?? '').trim(),
    gender: String(formData.get('gender') ?? '').trim(),
    defaultPaymentType: String(formData.get('defaultPaymentType') ?? '').trim(),
  });
  if (!parsed.success) return { ok: false, reason: 'invalid' };

  const d = parsed.data;
  await updateUserProfile(db, user.id, {
    firstName: d.firstName,
    lastName: d.lastName,
    phone: d.phone,
    // '' -> NULL, not '' -> ''. `birthday` is a `date` column ('' is not a date) and
    // `gender` must keep "never answered" (NULL) distinct from `prefer_not_to_say`.
    birthday: d.birthday === '' ? null : d.birthday,
    gender: d.gender === '' ? null : d.gender,
    defaultPaymentType: d.defaultPaymentType,
  });

  /*
   * Both, and the second one is the load-bearing half. `user.name` drives the avatar
   * initials and the identity line in the header, which `AppShell` renders on EVERY route
   * — so revalidating only `/account` would leave the old initials on every other page
   * until something else happened to bust them. `src/i18n/set-locale.ts` revalidates the
   * root layout for the same reason.
   *
   * This is enough to refresh the header because `src/auth.ts` sets no
   * `session.cookieCache`, so `getSession()` reads the user row per request. Enabling
   * cookie caching later would stale the header's name and initials for the cookie's
   * lifetime with no visible failure anywhere — a revalidation cannot rebuild a value the
   * server takes from a signed cookie instead of the database.
   */
  revalidatePath('/account');
  revalidatePath('/', 'layout');
  return { ok: true };
}
