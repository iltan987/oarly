'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
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
    if (error) {
      // A correct password on an unverified account fails with EMAIL_NOT_VERIFIED, not
      // INVALID_EMAIL_OR_PASSWORD — reporting it as bad credentials sends the user off
      // hunting for a password problem that doesn't exist. `sendOnSignIn` (src/auth.ts)
      // has already re-sent the link by the time we get here, so point them at it.
      if (error.code === 'EMAIL_NOT_VERIFIED') {
        toast.info(t('errorEmailNotVerified'));
        router.push('/verify-email');
        return;
      }
      // The per-account rate limit (src/lib/auth-rate-limit.ts) throws a plain
      // TOO_MANY_REQUESTS APIError with no machine-readable `code`, so it must be told
      // apart by HTTP status, not `error.code`. Falling through to errorCredentials here
      // would tell a locked-out member their password is wrong, sending them off to reset
      // a password that was never the problem — and leaving them with no idea that simply
      // waiting is the remedy. (Retrying does NOT deepen the lockout: both backends use a
      // FIXED window whose TTL is set on the first increment, so a rejected retry extends
      // nothing. The harm is the wrong diagnosis, not a growing penalty.)
      // `@better-fetch/fetch` discards the Response object and flattens `status` onto the
      // parsed error body, so `error.status` (not a header) is what's readable here.
      if (error.status === 429) {
        toast.error(t('errorTooManyRequests'));
        return;
      }
      toast.error(t('errorCredentials'));
      return;
    }
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
      <div className="mt-4 text-sm text-muted-foreground">
        <Link href="/forgot-password" className="hover:underline">{t('forgotLink')}</Link>
      </div>
      {/*
        The mirror of the block `sign-up-form.tsx` ends with, in the same position, the
        same `text-sm text-muted-foreground` prose and the same underlined link — because
        the two pages are each other's only way out and a member arrives at whichever one
        the link they were sent happens to point at.

        This route DID already link to /sign-up: a bare "Kayıt ol" sitting opposite
        "Şifremi unuttum" in a `justify-between` row. Two same-weight secondary links side
        by side, neither saying what it is FOR — and the one that matters to somebody who
        has just been invited to a club and has no account is the one with no context at
        all. `auth.noAccount` ("Hesabın yok mu?") is the question that was written for it
        and never rendered; its twin `auth.haveAccount` has been rendering on the sign-up
        page since that page existed.
      */}
      <div className="mt-2 text-sm text-muted-foreground">
        {t('noAccount')} <Link href="/sign-up" className="underline">{t('toSignUp')}</Link>
      </div>
    </div>
  );
}
