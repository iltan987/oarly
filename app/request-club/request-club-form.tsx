'use client';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { requestClubAction, type RequestClubState } from './actions';

export function RequestClubForm() {
  const t = useTranslations('requestClub');
  const [state, action, pending] = useActionState<RequestClubState, FormData>(requestClubAction, {});
  const e = state.errors ?? {};
  return (
    <form action={action} className="max-w-md">
      <FieldGroup>
        <Field data-invalid={!!e.name}>
          <FieldLabel htmlFor="name">{t('name')}</FieldLabel>
          <Input id="name" name="name" aria-invalid={!!e.name} required />
          {e.name && <FieldError>{e.name}</FieldError>}
        </Field>
        <Field data-invalid={!!e.slug}>
          <FieldLabel htmlFor="slug">{t('slug')}</FieldLabel>
          <Input id="slug" name="slug" aria-invalid={!!e.slug} required />
          {e.slug && <FieldError>{e.slug}</FieldError>}
        </Field>
        <Button type="submit" disabled={pending}>{t('submit')}</Button>
      </FieldGroup>
    </form>
  );
}
