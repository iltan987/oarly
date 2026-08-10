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
 */
const GENDER_LABEL_KEYS: Record<(typeof GENDER_OPTIONS)[number], string> = {
  female: 'genderFemale',
  male: 'genderMale',
  other: 'genderOther',
  prefer_not_to_say: 'genderPreferNotToSay',
};

const PAYMENT_LABEL_KEYS: Record<(typeof PAYMENT_TYPES)[number], string> = {
  regular: 'paymentRegular',
  multisport: 'paymentMultisport',
};

/**
 * The self-service profile form. Modelled on `app/s/[slug]/manage/profile/profile-form.tsx`,
 * which is its direct twin: uncontrolled inputs plus `action={formAction}`, so a submit
 * works before (and without) hydration, and the toast effect lives in this stable
 * component rather than inside the keyed `<form>` below.
 *
 * `key={profile.updatedAt.getTime()}` reproduces that file's reasoning exactly.
 * `user.updatedAt` carries `$onUpdate` (`src/db/schema/auth.ts`), so a successful save
 * revalidates this route and re-feeds the just-saved values as new `defaultValue`s on live
 * uncontrolled inputs — which Base UI warns about. Re-keying remounts them with fresh
 * defaults after each save, and ONLY then: the timestamp moves when the row is persisted,
 * never while typing. A FAILED save does not revalidate, so `updatedAt` is unchanged, the
 * form does not remount.
 *
 * What a failed save does NOT do is preserve the member's in-flight edits, and that is
 * React's doing rather than this key's: React 19 resets an uncontrolled form after ANY
 * completed form action, success or failure. Measured directly against both a native
 * `<input defaultValue>` and this repo's Base UI `Input` — both revert to their
 * `defaultValue`. It is left as-is because `action={formAction}` on uncontrolled inputs is
 * what makes this form work before hydration, and because the only refusal reachable
 * through this UI is `rate_limited`: every field here is also natively constrained
 * (`required`, `type="date"`, two closed option sets), so `invalid` needs a crafted POST.
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

  return (
    <form key={profile.updatedAt.getTime()} action={formAction} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="firstName">{t('firstName')}</FieldLabel>
          <Input id="firstName" name="firstName" autoComplete="given-name" required maxLength={80}
            defaultValue={profile.firstName} />
        </Field>
        <Field>
          <FieldLabel htmlFor="lastName">{t('lastName')}</FieldLabel>
          <Input id="lastName" name="lastName" autoComplete="family-name" required maxLength={80}
            defaultValue={profile.lastName} />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="phone">{t('phone')}</FieldLabel>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" required maxLength={40}
          defaultValue={profile.phone} />
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
      <Field>
        <FieldLabel htmlFor="birthday">{t('birthday')}</FieldLabel>
        <Input id="birthday" name="birthday" type="date" defaultValue={profile.birthday} />
        <FieldDescription>{t('birthdayDescription')}</FieldDescription>
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
      <Field>
        <FieldLabel htmlFor="gender">{t('gender')}</FieldLabel>
        <Select
          name="gender"
          defaultValue={profile.gender}
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
      <FieldSet>
        <FieldLegend variant="label">{t('paymentType')}</FieldLegend>
        <FieldDescription>{t('paymentTypeDescription')}</FieldDescription>
        <RadioGroup
          name="defaultPaymentType"
          defaultValue={profile.defaultPaymentType}
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
      </FieldSet>

      {/*
        Form-level, not per-field, and deliberately so: `AccountActionResult` carries a
        REASON and no field list, because every field here is also constrained natively
        (`required`, `type="date"`, the two closed option sets), so a server refusal means
        the payload was hand-crafted or the browser was bypassed — there is no honest way to
        attribute it to one input. Inventing a field name would point the member at a field
        that may be perfectly fine.
      */}
      {invalid ? <FieldError>{t('errorInvalid')}</FieldError> : null}

      <PendingButton className="self-start">{t('save')}</PendingButton>
    </form>
  );
}
