'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';

import { authClient } from '@/auth-client';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { env } from '@/env';
import { forgotPasswordSchema } from '@/lib/schemas';

type Values = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm({ title, body }: { title: string; body: string }) {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: Values) {
    setPending(true);
    const origin = env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    const { error } = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: `${origin}/reset-password`,
    });
    setPending(false);
    if (error) {
      // Two rules can produce this 429: the per-IP cap on `/request-password-reset`
      // (RATE_LIMITS.passwordResetPerIp) and the per-EMAIL mail-bomb cap
      // (RATE_LIMITS.passwordResetPerEmail, 3/hour — the tightest limit in the app). The
      // per-email one is reachable by an ordinary user who did not spot the first mail, so
      // telling them to wait is the whole point. `@better-fetch/fetch` discards the
      // Response, so branch on `error.status`, never on a Retry-After header.
      if (error.status === 429) { toast.error(t('errorTooManyRequests')); return; }
      toast.error(t('errorGeneric'));
      return;
    }
    toast.success(t('forgotSent'));
  }

  return (
    <div className="w-full">
      <h1 className="mb-4 font-heading text-2xl font-bold">{title}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{body}</p>
      <form onSubmit={handleSubmit(onSubmit)}>
        <FieldGroup>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
            {errors.email && <FieldError>{t('errorEmail')}</FieldError>}
          </Field>
          <Button type="submit" disabled={pending} className="w-full">{t('forgotSubmit')}</Button>
        </FieldGroup>
      </form>
      <div className="mt-4 text-sm text-muted-foreground">
        <Link href="/sign-in" className="hover:underline">{t('toSignIn')}</Link>
      </div>
    </div>
  );
}
