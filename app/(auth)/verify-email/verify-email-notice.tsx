'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { authClient } from '@/auth-client';
import { forgotPasswordSchema } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldError, FieldGroup } from '@/components/ui/field';

type Values = z.infer<typeof forgotPasswordSchema>;

export function VerifyEmailNotice({ title, body }: { title: string; body: string }) {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: Values) {
    setPending(true);
    const { error } = await authClient.sendVerificationEmail({ email: values.email, callbackURL: '/sign-in' });
    setPending(false);
    if (error) { toast.error(t('errorGeneric')); return; }
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
          <Button type="submit" variant="outline" disabled={pending} className="w-full">{t('resend')}</Button>
        </FieldGroup>
      </form>
      <div className="mt-4 text-sm text-muted-foreground">
        <Link href="/sign-in" className="hover:underline">{t('toSignIn')}</Link>
      </div>
    </div>
  );
}
