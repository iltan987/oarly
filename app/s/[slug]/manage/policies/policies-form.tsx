'use client';
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { type PoliciesState, savePoliciesAction } from './actions';

type Settings = {
  bookingOpenMode: 'always' | 'lead';
  bookingOpenLeadDays: number | null;
  selfCancelEnabled: boolean;
  cancelCutoffHours: number | null;
  noshowPenalty: 'off' | '2d' | '1w' | '2w' | '1m' | 'never';
  multisportMode: 'equal' | 'priority';
  openOnHolidays: boolean;
};
type Labels = {
  save: string; bookingOpen: string; bookingOpenAlways: string; bookingOpenLead: string; leadDays: string;
  selfCancel: string; cancelCutoff: string; noshow: string; noshowOff: string; noshow2d: string; noshow1w: string;
  noshow2w: string; noshow1m: string; noshowNever: string; multisport: string; multisportEqual: string;
  multisportPriority: string; multisportHint: string; openOnHolidays: string; errorInvalidLead: string;
};

const initial: PoliciesState = { status: 'idle' };
const selectClass = 'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs';

export function PoliciesForm({ slug, settings, labels }: { slug: string; settings: Settings; labels: Labels }) {
  const [state, formAction] = useActionState(savePoliciesAction.bind(null, slug), initial);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="bookingOpenMode">{labels.bookingOpen}</FieldLabel>
        <select id="bookingOpenMode" name="bookingOpenMode" defaultValue={settings.bookingOpenMode} className={selectClass}>
          <option value="always">{labels.bookingOpenAlways}</option>
          <option value="lead">{labels.bookingOpenLead}</option>
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="bookingOpenLeadDays">{labels.leadDays}</FieldLabel>
        <Input id="bookingOpenLeadDays" name="bookingOpenLeadDays" type="number" min={1} max={365} defaultValue={settings.bookingOpenLeadDays ?? ''} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="selfCancelEnabled" defaultChecked={settings.selfCancelEnabled} />
        {labels.selfCancel}
      </label>
      <Field>
        <FieldLabel htmlFor="cancelCutoffHours">{labels.cancelCutoff}</FieldLabel>
        <Input id="cancelCutoffHours" name="cancelCutoffHours" type="number" min={0} max={720} defaultValue={settings.cancelCutoffHours ?? ''} />
      </Field>
      <Field>
        <FieldLabel htmlFor="noshowPenalty">{labels.noshow}</FieldLabel>
        <select id="noshowPenalty" name="noshowPenalty" defaultValue={settings.noshowPenalty} className={selectClass}>
          <option value="off">{labels.noshowOff}</option>
          <option value="2d">{labels.noshow2d}</option>
          <option value="1w">{labels.noshow1w}</option>
          <option value="2w">{labels.noshow2w}</option>
          <option value="1m">{labels.noshow1m}</option>
          <option value="never">{labels.noshowNever}</option>
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="multisportMode">{labels.multisport}</FieldLabel>
        <select id="multisportMode" name="multisportMode" defaultValue={settings.multisportMode} className={selectClass}>
          <option value="equal">{labels.multisportEqual}</option>
          <option value="priority">{labels.multisportPriority}</option>
        </select>
        <p className="text-xs text-muted-foreground">{labels.multisportHint}</p>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="openOnHolidays" defaultChecked={settings.openOnHolidays} />
        {labels.openOnHolidays}
      </label>
      {state.status === 'error' && <p className="text-sm text-destructive">{labels.errorInvalidLead}</p>}
      <Button type="submit" className="self-start">{labels.save}</Button>
    </form>
  );
}
