'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, type Resolver, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { authClient } from '@/auth-client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { signUpSchema } from '@/lib/schemas';

// Form-input type: `consent` is a boolean the resolver forces to `true`
// (the schema's `z.literal(true)` would otherwise force the input type to
// the literal `true`, which conflicts with defaulting the checkbox to unchecked).
type Values = { firstName: string; lastName: string; phone: string; email: string; password: string; consent: boolean };

export function SignUpForm({ title }: { title: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const { register, handleSubmit, control, formState: { errors } } = useForm<Values>({
    // `signUpSchema.consent` is `z.literal(true)`, so zodResolver's inferred
    // input/output type pins `consent` to the literal `true` — incompatible
    // with defaulting the checkbox to unchecked (`false`). Cast: the runtime
    // behavior is unaffected (zod still rejects `consent: false`).
    resolver: zodResolver(signUpSchema) as Resolver<Values, unknown, Values>,
    defaultValues: { firstName: '', lastName: '', phone: '', email: '', password: '', consent: false },
  });

  async function onSubmit(v: Values) {
    setPending(true);
    const { error } = await authClient.signUp.email({
      email: v.email,
      password: v.password,
      name: `${v.firstName} ${v.lastName}`.trim(),
      firstName: v.firstName,
      lastName: v.lastName,
      phone: v.phone,
    });
    setPending(false);
    if (error) { toast.error(t('errorGeneric')); return; }
    router.push('/verify-email');
  }

  return (
    <div className="w-full">
      <h1 className="mb-4 font-heading text-2xl font-bold">{title}</h1>
      <form onSubmit={handleSubmit(onSubmit)}>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field data-invalid={!!errors.firstName}>
              <FieldLabel htmlFor="firstName">{t('firstName')}</FieldLabel>
              <Input id="firstName" autoComplete="given-name" aria-invalid={!!errors.firstName} {...register('firstName')} />
              {errors.firstName && <FieldError>{t('errorRequired')}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.lastName}>
              <FieldLabel htmlFor="lastName">{t('lastName')}</FieldLabel>
              <Input id="lastName" autoComplete="family-name" aria-invalid={!!errors.lastName} {...register('lastName')} />
              {errors.lastName && <FieldError>{t('errorRequired')}</FieldError>}
            </Field>
          </div>
          <Field data-invalid={!!errors.phone}>
            <FieldLabel htmlFor="phone">{t('phone')}</FieldLabel>
            <Input id="phone" type="tel" autoComplete="tel" aria-invalid={!!errors.phone} {...register('phone')} />
            {errors.phone && <FieldError>{t('errorRequired')}</FieldError>}
          </Field>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
            {errors.email && <FieldError>{t('errorEmail')}</FieldError>}
          </Field>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
            <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register('password')} />
            {errors.password && <FieldError>{t('errorPassword')}</FieldError>}
          </Field>
          <Field orientation="horizontal" data-invalid={!!errors.consent}>
            <Controller
              control={control}
              name="consent"
              render={({ field }) => (
                <Checkbox
                  id="consent"
                  checked={field.value === true}
                  onCheckedChange={(v) => field.onChange(v === true)}
                />
              )}
            />
            <FieldLabel htmlFor="consent" className="font-normal">
              {t('kvkkConsent')}{' '}
              <Link href="/privacy" className="underline" target="_blank">{t('privacyLink')}</Link>
            </FieldLabel>
          </Field>
          {errors.consent && <FieldError>{t('errorConsent')}</FieldError>}
          <Button type="submit" disabled={pending} className="w-full">{t('submitSignUp')}</Button>
        </FieldGroup>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">{t('kvkkNotice')}</p>
      <div className="mt-4 text-sm text-muted-foreground">
        {t('haveAccount')} <Link href="/sign-in" className="underline">{t('toSignIn')}</Link>
      </div>
    </div>
  );
}
