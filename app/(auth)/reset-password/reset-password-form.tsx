'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';

import { authClient } from '@/auth-client';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { resetPasswordSchema } from '@/lib/schemas';

type Values = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordForm({ title, token }: { title: string; token: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: '' },
  });

  async function onSubmit(values: Values) {
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword: values.newPassword, token });
    setPending(false);
    if (error) { toast.error(t('errorGeneric')); return; }
    toast.success(t('resetDone'));
    router.push('/sign-in');
  }

  return (
    <div className="w-full">
      <h1 className="mb-4 font-heading text-2xl font-bold">{title}</h1>
      <form onSubmit={handleSubmit(onSubmit)}>
        <FieldGroup>
          <Field data-invalid={!!errors.newPassword}>
            <FieldLabel htmlFor="newPassword">{t('password')}</FieldLabel>
            <Input id="newPassword" type="password" autoComplete="new-password" aria-invalid={!!errors.newPassword} {...register('newPassword')} />
            {errors.newPassword && <FieldError>{t('errorPassword')}</FieldError>}
          </Field>
          <Button type="submit" disabled={pending} className="w-full">{t('resetSubmit')}</Button>
        </FieldGroup>
      </form>
    </div>
  );
}
