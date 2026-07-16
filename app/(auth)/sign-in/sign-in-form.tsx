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
import { signInSchema } from '@/lib/schemas';

type Values = z.infer<typeof signInSchema>;

export function SignInForm({ title, redirectTo }: { title: string; redirectTo: string }) {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: Values) {
    setPending(true);
    const { error } = await authClient.signIn.email({ email: values.email, password: values.password });
    setPending(false);
    if (error) { toast.error(t('errorCredentials')); return; }
    window.location.assign(redirectTo); // validated on the server in the page
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
          <Button type="submit" disabled={pending} className="w-full">{t('submitSignIn')}</Button>
        </FieldGroup>
      </form>
      <Button
        variant="outline"
        className="mt-3 w-full"
        onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: redirectTo })}
      >
        {t('google')}
      </Button>
      <div className="mt-4 flex justify-between text-sm text-muted-foreground">
        <Link href="/forgot-password" className="hover:underline">{t('forgotLink')}</Link>
        <Link href="/sign-up" className="hover:underline">{t('toSignUp')}</Link>
      </div>
    </div>
  );
}
