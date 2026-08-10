'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GENDER_OPTIONS, PAYMENT_TYPES } from '@/lib/schemas';
import { cn } from '@/lib/utils';

import { type AccountActionResult, saveAccountAction } from './actions';

/**
 * The row as the page read it out of the database, with both nullable columns already
 * flattened to `''`. `''` is the form's representation of "not set", and the action maps
 * it back to NULL — so the round trip preserves the difference between a member who never
 * answered and one who chose `prefer_not_to_say`.
 */
export type AccountProfile = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  /** `'YYYY-MM-DD'`, or `''`. Never a `Date` — see `page.tsx`. */
  birthday: string;
  gender: string;
  defaultPaymentType: (typeof PAYMENT_TYPES)[number];
  updatedAt: Date;
};

/**
 * Message keys per option value, so the option list is driven by the schema's own
 * constants and a value added there cannot silently render without a label.
 *
 * Exported so `account-form.test.tsx` can require them to resolve in the real catalogues:
 * they are the only keys this file renders that a source scan for `t('...')` cannot see.
 */
export const GENDER_LABEL_KEYS: Record<(typeof GENDER_OPTIONS)[number], string> = {
  female: 'genderFemale',
  male: 'genderMale',
  other: 'genderOther',
  prefer_not_to_say: 'genderPreferNotToSay',
};

export const PAYMENT_LABEL_KEYS: Record<(typeof PAYMENT_TYPES)[number], string> = {
  regular: 'paymentRegular',
  multisport: 'paymentMultisport',
};

/**
 * The self-service profile form. Modelled on `app/s/[slug]/manage/profile/profile-form.tsx`,
 * which is its direct twin: uncontrolled inputs plus `action={formAction}`, so a submit
 * works before (and without) hydration, and the toast effect lives in this stable
 * component rather than inside the keyed `<form>` below.
 *
 * `key={profile.updatedAt.getTime()}` reproduces that file's reasoning, and it is about the
 * SUCCESS path only. `user.updatedAt` carries `$onUpdate` (`src/db/schema/auth.ts`), so a
 * successful save revalidates this route and re-feeds the just-saved values as new
 * `defaultValue`s on live uncontrolled inputs; re-keying remounts them with fresh defaults
 * instead, and only then — the timestamp moves when the row is persisted, never while typing.
 *
 * A REFUSED save is a different problem with a different fix. React 19 resets an uncontrolled
 * form after ANY completed form action, success or failure: `<form action>` schedules the
 * reset before the action even runs (react-dom 19.2.8, `startHostTransition` ->
 * `requestFormReset`) and it lands as a native `.reset()` on the form node. Measured in a
 * browser on this page — a whitespace-only `firstName` passes `required`, `saveAccountAction`
 * trims it to `''`, `accountProfileSchema` refuses it, and the field snapped back to the
 * stored name on the same `<form>` DOM node with a `reset` event fired on it.
 *
 * `state.values` is the whole fix: the refused values become the inputs' new `defaultValue`,
 * React writes that to the value attribute during the mutation phase, and the reset that
 * follows in the same commit restores them. The form deliberately does NOT remount on a
 * refusal — that would destroy the focused node and drop a keyboard or screen-reader user
 * back to `<body>` on every retry. The cost of not remounting is a Base UI DEV-ONLY warning
 * ("A component is changing the default value state of an uncontrolled FieldControl after
 * being initialized"), which is accepted: `@base-ui/utils/useControlled.js:25` guards the
 * check with `process.env.NODE_ENV !== 'production'` and `@base-ui/utils/error.js:9-19`
 * no-ops there, so it does not exist in a production build.
 *
 * The values come back FROM THE SERVER rather than being snapshotted here because
 * `action={formAction}` on uncontrolled inputs is what makes this form work before
 * hydration: on that path the refusal is a full-page POST and this component is rendered
 * on the server from the same result, so the edits survive there too.
 */
export function AccountForm({ profile }: { profile: AccountProfile }) {
  const t = useTranslations('account');
  const [state, formAction] = useActionState<AccountActionResult | null, FormData>(
    saveAccountAction,
    null,
  );

  /**
   * The `handled` ref is what makes this fire ONCE PER RESULT, and it is not defensive
   * padding — it is `policies-form.tsx`'s shape rather than `profile-form.tsx`'s, chosen
   * after measuring. `t` is in the dependency list (it has to be; the effect reads it), and
   * `t` is not a stable identity contract: any hook that returns a fresh closure re-runs
   * this effect on a re-render that carries the SAME result, and the member gets a second
   * toast for one save. Comparing the result object itself makes the guard independent of
   * every dependency's memoization.
   */
  const handled = useRef<AccountActionResult | null>(null);
  useEffect(() => {
    if (state === null || state === handled.current) return;
    handled.current = state;
    if (state.ok) {
      toast.success(t('saved'));
      return;
    }
    // `rate_limited` gets its OWN message. "Check the fields" is actively misleading to
    // someone whose fields are fine and who only has to wait.
    toast.error(state.reason === 'rate_limited' ? t('errorTooManyRequests') : t('errorInvalid'));
  }, [state, t]);

  const invalid = state !== null && !state.ok && state.reason === 'invalid';

  const rejected = state !== null && !state.ok ? state.values : null;

  /**
   * Which inputs the server actually objected to, from the zod issue paths. `invalid` is
   * reachable by ordinary typing (a whitespace-only name is trimmed to `''` server-side),
   * and it is reachable indefinitely for any member whose stored name or phone predates
   * `signUpSchema`'s length bounds — `maxLength` does not truncate an already-too-long
   * value, so every save is refused until they shorten it. A form-level "check the fields"
   * would never tell them which one.
   */
  const badFields = state !== null && !state.ok ? (state.fields ?? []) : [];
  const bad = (name: string) => badFields.includes(name);

  /*
   * MARKED, not excluded — every name `fields` can carry has a control here that can show it.
   * The two closed sets cannot be mistyped, so a refusal naming one means a hand-crafted
   * payload; but leaving them unmarked would put the form back in the state this change
   * removed — the summary saying "check the fields" and nothing saying which. The
   * `rejected*` guards below then fall back to the stored answer for exactly those values,
   * so the marked control shows a usable option rather than a blank.
   */

  /*
   * The two closed sets are echoed back only if the refused value is actually one of the
   * answers this form offers. They cannot be mistyped — they are a Select and a RadioGroup
   * — so a value outside the set means a hand-crafted POST, and seeding a `defaultValue`
   * from it would leave the Select blank and the RadioGroup with nothing checked, which is
   * a worse starting point for the retry than the stored answer.
   */
  const rejectedGender =
    rejected !== null && (rejected.gender === '' || (GENDER_OPTIONS as readonly string[]).includes(rejected.gender))
      ? rejected.gender
      : null;
  const rejectedPaymentType =
    rejected !== null && (PAYMENT_TYPES as readonly string[]).includes(rejected.defaultPaymentType)
      ? (rejected.defaultPaymentType as (typeof PAYMENT_TYPES)[number])
      : null;

  return (
    <form key={profile.updatedAt.getTime()} action={formAction} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={bad('firstName')}>
          <FieldLabel htmlFor="firstName">{t('firstName')}</FieldLabel>
          <Input id="firstName" name="firstName" autoComplete="given-name" required maxLength={80}
            aria-invalid={bad('firstName')} defaultValue={rejected?.firstName ?? profile.firstName} />
          {bad('firstName') && <FieldError>{t('errorFieldInvalid')}</FieldError>}
        </Field>
        <Field data-invalid={bad('lastName')}>
          <FieldLabel htmlFor="lastName">{t('lastName')}</FieldLabel>
          <Input id="lastName" name="lastName" autoComplete="family-name" required maxLength={80}
            aria-invalid={bad('lastName')} defaultValue={rejected?.lastName ?? profile.lastName} />
          {bad('lastName') && <FieldError>{t('errorFieldInvalid')}</FieldError>}
        </Field>
      </div>

      <Field data-invalid={bad('phone')}>
        <FieldLabel htmlFor="phone">{t('phone')}</FieldLabel>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" required maxLength={40}
          aria-invalid={bad('phone')} defaultValue={rejected?.phone ?? profile.phone} />
        {bad('phone') && <FieldError>{t('errorFieldInvalid')}</FieldError>}
      </Field>

      {/*
        Read-only and unnamed, so it submits nothing at all. Changing an email address needs
        re-verification through Better Auth's credential flow, and account deletion is
        KVKK-gated and deferred to a lawyer-reviewed plan — neither belongs on a form whose
        server action is a single UPDATE. `/forgot-password` is the existing, verified route
        for changing a password, so this points at it rather than growing a second one.
      */}
      <Field>
        <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
        <Input id="email" type="email" value={profile.email} disabled readOnly />
        <FieldDescription>
          {t('emailDescription')}{' '}
          {t('passwordHint')} <Link href="/forgot-password">{t('passwordLink')}</Link>.
        </FieldDescription>
      </Field>

      {/*
        `type="date"` and an empty default when the column is NULL. Every row that existed
        before this page had `birthday = NULL` — it was never collected at sign-up — so an
        empty field here is the truth, not a missing default. Submitting it empty sends ''
        and clears the column.
      */}
      <Field data-invalid={bad('birthday')}>
        <FieldLabel htmlFor="birthday">{t('birthday')}</FieldLabel>
        <Input id="birthday" name="birthday" type="date" aria-invalid={bad('birthday')}
          defaultValue={rejected?.birthday ?? profile.birthday} />
        <FieldDescription>{t('birthdayDescription')}</FieldDescription>
        {bad('birthday') && <FieldError>{t('errorFieldInvalid')}</FieldError>}
      </Field>

      {/*
        The `''` entry is a real, selectable option meaning "not set" — NOT a decorative
        placeholder, and NOT collapsed into `prefer_not_to_say`. Gender was never collected
        at sign-up, so every existing row is NULL, and inventing an answer for a
        special-category-adjacent field would be wrong under KVKK. "Never answered" and
        "declined to answer" are different facts and the schema keeps them apart, so the UI
        has to as well.

        `items` is what makes `<SelectValue />` render the LABEL rather than the raw value
        (the same note profile-form.tsx carries), and `name` is what gives the Select its
        hidden form control, so this submits without any local state.
      */}
      <Field data-invalid={bad('gender')}>
        <FieldLabel htmlFor="gender">{t('gender')}</FieldLabel>
        <Select
          name="gender"
          defaultValue={rejectedGender ?? profile.gender}
          items={[
            { value: '', label: t('genderUnset') },
            ...GENDER_OPTIONS.map((g) => ({ value: g, label: t(GENDER_LABEL_KEYS[g]) })),
          ]}
        >
          <SelectTrigger id="gender" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('genderUnset')}</SelectItem>
            {GENDER_OPTIONS.map((g) => (
              <SelectItem key={g} value={g}>{t(GENDER_LABEL_KEYS[g])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{t('genderDescription')}</FieldDescription>
        {bad('gender') && <FieldError>{t('errorFieldInvalid')}</FieldError>}
      </Field>

      {/*
        A RadioGroup and never a "not set" option: `default_payment_type` is NOT NULL with a
        `'regular'` default, so it always holds a real value and there is nothing unset to
        represent.

        The description has to be honest about a genuine wrinkle: this is a per-USER default
        whose meaning is per-CLUB. A club with `multisportEnabled = false` accepts only
        `regular` — `defaultPaymentFor` clamps it (`src/lib/member-calendar.ts`) — so at
        those clubs the preference silently does not apply. The apex page cannot know which
        clubs those are, so it says the rule without naming any.

        Each radio is wrapped in its own `<label>`, as `book-calendar.tsx` does: the whole
        row stays clickable, the native input beneath keeps the focus ring and arrow-key
        navigation, and the label drives the native input even before hydration.
      */}
      <FieldSet data-invalid={bad('defaultPaymentType')}>
        <FieldLegend variant="label">{t('paymentType')}</FieldLegend>
        <FieldDescription>{t('paymentTypeDescription')}</FieldDescription>
        <RadioGroup
          name="defaultPaymentType"
          defaultValue={rejectedPaymentType ?? profile.defaultPaymentType}
          className="grid gap-2 sm:grid-cols-2"
        >
          {PAYMENT_TYPES.map((p) => (
            <label
              key={p}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-field border border-border p-2.5',
                'text-sm font-medium transition-colors hover:bg-muted has-data-checked:border-brand',
              )}
            >
              <RadioGroupItem value={p} />
              {t(PAYMENT_LABEL_KEYS[p])}
            </label>
          ))}
        </RadioGroup>
        {bad('defaultPaymentType') && <FieldError>{t('errorFieldInvalid')}</FieldError>}
      </FieldSet>

      {/*
        Kept alongside the per-field errors above rather than replaced by them. The
        per-field markers come from `state.fields` (the zod issue paths), which is only
        populated for `invalid`; this line is what remains visible if a future refusal
        arrives without a usable path, and it is also the summary a member sees without
        having to scan the form. The earlier claim here — that a refusal "means the payload
        was hand-crafted", so no field could honestly be named — was wrong: `required` is
        satisfied by whitespace, which this action trims to `''` and the schema refuses.
      */}
      {invalid ? <FieldError>{t('errorInvalid')}</FieldError> : null}

      <PendingButton className="self-start">{t('save')}</PendingButton>
    </form>
  );
}
