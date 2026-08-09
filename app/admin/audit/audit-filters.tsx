import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export async function AuditFilters({ clubId, actorUserId, actionPrefix }: {
  clubId?: string;
  actorUserId?: string;
  actionPrefix?: string;
}) {
  const t = await getTranslations('admin');
  return (
    // A plain GET form, not a server action: the filter state belongs in the URL so
    // a page of the log can be linked to and survives a refresh, and so "Older" can
    // carry the same filters forward. It also needs no JavaScript.
    //
    // The form deliberately carries no `cursor` field — changing a filter must land
    // on the newest page, since a cursor from the old result set means nothing in
    // the new one.
    <form method="get" action="/admin/audit" className="mb-6">
      <FieldGroup className="sm:flex-row sm:items-end sm:gap-3">
        <Field>
          <FieldLabel htmlFor="clubId">{t('auditFilterClub')}</FieldLabel>
          <Input id="clubId" name="clubId" defaultValue={clubId ?? ''} />
        </Field>
        <Field>
          <FieldLabel htmlFor="actorUserId">{t('auditFilterActor')}</FieldLabel>
          <Input id="actorUserId" name="actorUserId" defaultValue={actorUserId ?? ''} />
        </Field>
        <Field>
          <FieldLabel htmlFor="action">{t('auditFilterAction')}</FieldLabel>
          <Input id="action" name="action" defaultValue={actionPrefix ?? ''} placeholder="boat." />
        </Field>
        {/*
          Plain submit buttons, deliberately not `PendingButton`. `useFormStatus`
          reports pending only for a form whose action is a React function; this
          form's action is a URL, so submitting it is ordinary browser navigation
          that React never sees. A `PendingButton` here could never pend — it would
          only drag a 'use client' boundary into an otherwise static filter bar to
          render a spinner that never appears.
        */}
        <div className="flex gap-2">
          <Button type="submit" size="sm">{t('auditApply')}</Button>
          {/*
            Clear is a submit rather than a link so it works identically with the
            keyboard and needs no JS to empty the fields: the page ignores every
            other parameter when `reset=1` is present, which re-renders the inputs
            blank even though the browser still submitted their old values.
          */}
          <Button type="submit" size="sm" variant="ghost" name="reset" value="1">{t('auditClear')}</Button>
        </div>
      </FieldGroup>
    </form>
  );
}
