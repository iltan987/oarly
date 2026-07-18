'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';

import { authClient } from '@/auth-client';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { signInSchema } from '@/lib/schemas';

type Values = z.infer<typeof signInSchema>;

export function SignInForm({
  title,
  redirectTo,
  signedOut,
  errorCode,
}: {
  title: string;
  redirectTo: string;
  signedOut?: boolean;
  errorCode?: string;
}) {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    if (signedOut) {
      toast.success(t('signedOutToast'));
    } else if (errorCode === 'account_not_linked') {
      toast.error(t('errorAccountNotLinked'));
    } else if (errorCode) {
      toast.error(t('googleError'));
    }
    if (window.history?.replaceState && window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(values: Values) {
    setPending(true);
    const { error } = await authClient.signIn.email({ email: values.email, password: values.password });
    setPending(false);
    if (error) { toast.error(t('errorCredentials')); return; }
    window.location.assign(redirectTo); // validated on the server in the page
  }

  async function onGoogleClick() {
    setGooglePending(true);
    const { error } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: redirectTo,
      errorCallbackURL: '/sign-in',
    });
    if (error) {
      toast.error(t('googleError'));
      setGooglePending(false);
    }
    // on success the browser navigates away, so leaving it pending is fine
  }

  return (
    <div className="w-full">
      <h1 className="mb-4 font-heading text-2xl font-bold">{title}</h1>
      <form onSubmit={handleSubmit(onSubmit)}>
        <FieldGroup>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
            {errors.email && <FieldError>{t('errorEmail')}</FieldError>}
          </Field>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
            <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register('password')} />
            {errors.password && <FieldError>{t('errorRequired')}</FieldError>}
          </Field>
          <Button type="submit" disabled={pending} className="w-full">
            {pending && <Spinner />}
            {t('submitSignIn')}
          </Button>
        </FieldGroup>
      </form>
      <Button
        variant="outline"
        className="mt-3 w-full"
        disabled={googlePending}
        onClick={onGoogleClick}
      >
        {googlePending && <Spinner />}
        {t('google')}
      </Button>
      <div className="mt-4 flex justify-between text-sm text-muted-foreground">
        <Link href="/forgot-password" className="hover:underline">{t('forgotLink')}</Link>
        <Link href="/sign-up" className="hover:underline">{t('toSignUp')}</Link>
      </div>
    </div>
  );
}
