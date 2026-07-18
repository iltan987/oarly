'use client';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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

export function PoliciesForm({ slug, settings, labels }: { slug: string; settings: Settings; labels: Labels }) {
  const [state, formAction] = useActionState(savePoliciesAction.bind(null, slug), initial);
  const [bookingOpenMode, setBookingOpenMode] = useState(settings.bookingOpenMode);
  const [noshowPenalty, setNoshowPenalty] = useState(settings.noshowPenalty);
  const [multisportMode, setMultisportMode] = useState(settings.multisportMode);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <input type="hidden" name="bookingOpenMode" value={bookingOpenMode} />
      <input type="hidden" name="noshowPenalty" value={noshowPenalty} />
      <input type="hidden" name="multisportMode" value={multisportMode} />
      <Field>
        <FieldLabel htmlFor="bookingOpenMode">{labels.bookingOpen}</FieldLabel>
        <Select value={bookingOpenMode} onValueChange={(v) => setBookingOpenMode(v as Settings['bookingOpenMode'])}>
          <SelectTrigger id="bookingOpenMode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="always">{labels.bookingOpenAlways}</SelectItem>
            <SelectItem value="lead">{labels.bookingOpenLead}</SelectItem>
          </SelectContent>
        </Select>
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
        <Select value={noshowPenalty} onValueChange={(v) => setNoshowPenalty(v as Settings['noshowPenalty'])}>
          <SelectTrigger id="noshowPenalty">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{labels.noshowOff}</SelectItem>
            <SelectItem value="2d">{labels.noshow2d}</SelectItem>
            <SelectItem value="1w">{labels.noshow1w}</SelectItem>
            <SelectItem value="2w">{labels.noshow2w}</SelectItem>
            <SelectItem value="1m">{labels.noshow1m}</SelectItem>
            <SelectItem value="never">{labels.noshowNever}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="multisportMode">{labels.multisport}</FieldLabel>
        <Select value={multisportMode} onValueChange={(v) => setMultisportMode(v as Settings['multisportMode'])}>
          <SelectTrigger id="multisportMode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="equal">{labels.multisportEqual}</SelectItem>
            <SelectItem value="priority">{labels.multisportPriority}</SelectItem>
          </SelectContent>
        </Select>
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
