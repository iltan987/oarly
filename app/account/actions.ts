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
export type AccountActionResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'rate_limited'; values: AccountFormValues; fields?: readonly string[] };

/**
 * The six fields the form submits, exactly as they were submitted — untrimmed, so a refused
 * save hands the member back the characters they have in front of them.
 *
 * `values` is what stops a refusal from discarding those characters. React 19 resets an
 * uncontrolled form after ANY completed form action: `<form action>` schedules the reset
 * before the action even runs (react-dom 19.2.8, `startHostTransition` ->
 * `requestFormReset`) and it lands as a native `.reset()` on the form node. Measured in a
 * browser on this exact form — a whitespace-only `firstName` passes `required`, this action
 * trims it to `''`, `accountProfileSchema` refuses it, and the field snapped back to the
 * stored name on the same DOM node with a `reset` event fired. Handing the values back makes
 * them the inputs' new `defaultValue`, which React writes to the value attribute before that
 * reset runs, so the reset restores them instead.
 *
 * Returned from the SERVER, not snapshotted in the client, so the pre-hydration path — where
 * the refusal is a full-page POST and the form is re-rendered server-side from this result —
 * preserves the edits too.
 *
 * `fields` carries the zod issue paths for an `invalid` refusal, so the form can say WHICH
 * field is at fault. It matters most for a member whose stored `firstName`/`lastName`/`phone`
 * predates the length bounds added to `signUpSchema`: `maxLength` does not truncate an
 * already-too-long value, so every save from that account is refused until they shorten it,
 * and a form-level "check the fields" would never tell them which one.
 */
export type AccountFormValues = {
  firstName: string;
  lastName: string;
  phone: string;
  birthday: string;
  gender: string;
  defaultPaymentType: string;
};

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

  // Read once, up here, so BOTH refusals below can hand the values back — including the
  // rate-limited one, which never reaches the parse.
  const submitted: AccountFormValues = {
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    birthday: String(formData.get('birthday') ?? ''),
    gender: String(formData.get('gender') ?? ''),
    defaultPaymentType: String(formData.get('defaultPaymentType') ?? ''),
  };
  const refuse = (reason: 'invalid' | 'rate_limited', fields?: readonly string[]): AccountActionResult =>
    fields === undefined
      ? { ok: false, reason, values: submitted }
      : { ok: false, reason, values: submitted, fields };

  // Per-ACCOUNT, and above the parse for the reason `bookSeatAction` documents: an
  // exhausted caller must not cost us a validation pass or a DB round trip.
  const verdict = await enforceRateLimit([
    { key: `account:acct:${user.id}`, rule: RATE_LIMITS.accountUpdatePerAccount },
  ]);
  if (verdict.limited) return refuse('rate_limited');

  const parsed = accountProfileSchema.safeParse({
    firstName: submitted.firstName.trim(),
    lastName: submitted.lastName.trim(),
    phone: submitted.phone.trim(),
    birthday: submitted.birthday.trim(),
    gender: submitted.gender.trim(),
    defaultPaymentType: submitted.defaultPaymentType.trim(),
  });
  if (!parsed.success) {
    // `issue.path[0]` is the field name for every rule in this schema — they are all
    // top-level scalars, none nested — so this is the exact set of inputs to mark.
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    return refuse('invalid', fields);
  }

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
