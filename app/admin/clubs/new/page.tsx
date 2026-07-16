'use client';
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { createClubAction, type CreateClubState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldError, FieldGroup } from '@/components/ui/field';

export default function NewClubPage() {
  const t = useTranslations('admin');
  const [state, action, pending] = useActionState<CreateClubState, FormData>(createClubAction, {});
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
        <Field data-invalid={!!e.ownerEmail}>
          <FieldLabel htmlFor="ownerEmail">{t('ownerEmail')}</FieldLabel>
          <Input id="ownerEmail" name="ownerEmail" type="email" aria-invalid={!!e.ownerEmail} required />
          {e.ownerEmail && <FieldError>{e.ownerEmail}</FieldError>}
        </Field>
        <Button type="submit" disabled={pending}>{t('create')}</Button>
      </FieldGroup>
    </form>
  );
}
