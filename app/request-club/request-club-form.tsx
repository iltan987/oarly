'use client';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { PendingButton } from '@/components/pending-button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { requestClubAction, type RequestClubState } from './actions';

export function RequestClubForm() {
  const t = useTranslations('requestClub');
  const [state, action] = useActionState<RequestClubState, FormData>(requestClubAction, {});
  const e = state.errors ?? {};
  /*
   * These inputs have no `defaultValue` of their own, so React 19's post-action form reset
   * did not revert them — it WIPED them to `''`, the value attribute an input without one
   * has. `slug_taken` is the ordinary outcome of picking a club name someone already has,
   * and it names only the slug, so the club name disappeared with nothing said about it.
   *
   * Seeding from the echoed submission fixes that without a remount: React writes the new
   * `defaultValue` to the value attribute during the mutation phase, and the reset at the end
   * of the same commit restores it. See `app/s/[slug]/manage/action-result.ts` for the shape
   * and the measurement.
   */
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
        {e.form && <FieldError>{e.form}</FieldError>}
        <PendingButton>{t('submit')}</PendingButton>
      </FieldGroup>
    </form>
  );
}
