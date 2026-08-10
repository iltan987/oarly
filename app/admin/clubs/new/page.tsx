'use client';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { PendingButton } from '@/components/pending-button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { createClubAction, type CreateClubState } from './actions';

export default function NewClubPage() {
  const t = useTranslations('admin');
  const [state, action] = useActionState<CreateClubState, FormData>(createClubAction, {});
  const e = state.errors ?? {};
  // No `defaultValue` here means React 19's post-action reset WIPED these three rather than
  // reverting them; `slug_taken` and `owner_not_found` are ordinary outcomes that each name
  // one field. See `app/request-club/actions.ts` and `manage/action-result.ts`.
  const v = state.values;
  return (
    <form action={action} className="max-w-md">
      <FieldGroup>
        <Field data-invalid={!!e.name}>
          <FieldLabel htmlFor="name">{t('name')}</FieldLabel>
          <Input id="name" name="name" aria-invalid={!!e.name} defaultValue={v?.name ?? ''} required />
          {e.name && <FieldError>{e.name}</FieldError>}
        </Field>
        <Field data-invalid={!!e.slug}>
          <FieldLabel htmlFor="slug">{t('slug')}</FieldLabel>
          <Input id="slug" name="slug" aria-invalid={!!e.slug} defaultValue={v?.slug ?? ''} required />
          {e.slug && <FieldError>{e.slug}</FieldError>}
        </Field>
        <Field data-invalid={!!e.ownerEmail}>
          <FieldLabel htmlFor="ownerEmail">{t('ownerEmail')}</FieldLabel>
          <Input id="ownerEmail" name="ownerEmail" type="email" aria-invalid={!!e.ownerEmail} defaultValue={v?.ownerEmail ?? ''} required />
          {e.ownerEmail && <FieldError>{e.ownerEmail}</FieldError>}
        </Field>
        <PendingButton>{t('create')}</PendingButton>
      </FieldGroup>
    </form>
  );
}
