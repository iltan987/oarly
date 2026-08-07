'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
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
  waitlistCapacity: number | null;
};
type Labels = {
  save: string; bookingOpen: string; bookingOpenAlways: string; bookingOpenLead: string; leadDays: string;
  selfCancel: string; cancelCutoff: string; noshow: string; noshowOff: string; noshow2d: string; noshow1w: string;
  noshow2w: string; noshow1m: string; noshowNever: string; multisport: string; multisportEqual: string;
  multisportPriority: string; multisportHint: string; openOnHolidays: string; waitlistCapacity: string;
  waitlistCapacityHint: string; errorInvalidLead: string; errorInvalidInput: string; saved: string;
};

const initial: PoliciesState = { status: 'idle' };

/**
 * `page.tsx` stamps `club.updatedAt` on every write, and this component used to be
 * keyed on it directly — which fully unmounts/remounts the form (and any effect
 * inside it) the instant a save succeeds, before a toast effect can fire. This
 * outer component is kept stable across saves: it owns `useActionState` and the
 * toast effect, and passes `updatedAt` down only as a `key` on the inner fields,
 * so the fields still reset to the freshly saved server values without destroying
 * the component that reports the result.
 */
export function PoliciesForm({ slug, updatedAt, settings, labels }: { slug: string; updatedAt: number; settings: Settings; labels: Labels }) {
  const [state, formAction] = useActionState(savePoliciesAction.bind(null, slug), initial);

  // Identity guard: `state` only changes reference when the action actually
  // dispatches, but guard against re-firing on unrelated re-renders anyway
  // (mirrors profile-form.tsx's rmHandled ref for the same reason).
  const handled = useRef<PoliciesState>(initial);
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state.status === 'ok') toast.success(labels.saved);
    else if (state.status === 'error') toast.error(state.cause === 'invalid_lead' ? labels.errorInvalidLead : labels.errorInvalidInput);
  }, [state, labels.saved, labels.errorInvalidLead, labels.errorInvalidInput]);

  return <PoliciesFields key={updatedAt} settings={settings} labels={labels} state={state} formAction={formAction} />;
}

function PoliciesFields({ settings, labels, state, formAction }: {
  settings: Settings;
  labels: Labels;
  state: PoliciesState;
  formAction: (formData: FormData) => void;
}) {
  const [bookingOpenMode, setBookingOpenMode] = useState(settings.bookingOpenMode);
  const [noshowPenalty, setNoshowPenalty] = useState(settings.noshowPenalty);
  const [multisportMode, setMultisportMode] = useState(settings.multisportMode);

  // Base UI's <Select.Value> renders the raw item VALUE unless the root is given
  // an `items` map — without it the trigger reads "always" instead of the label,
  // even though the popup items are labelled correctly.
  const bookingOpenItems = { always: labels.bookingOpenAlways, lead: labels.bookingOpenLead };
  const noshowItems = {
    off: labels.noshowOff, '2d': labels.noshow2d, '1w': labels.noshow1w,
    '2w': labels.noshow2w, '1m': labels.noshow1m, never: labels.noshowNever,
  };
  const multisportItems = { equal: labels.multisportEqual, priority: labels.multisportPriority };

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <input type="hidden" name="bookingOpenMode" value={bookingOpenMode} />
      <input type="hidden" name="noshowPenalty" value={noshowPenalty} />
      <input type="hidden" name="multisportMode" value={multisportMode} />
      <Field>
        <FieldLabel htmlFor="bookingOpenMode">{labels.bookingOpen}</FieldLabel>
        <Select items={bookingOpenItems} value={bookingOpenMode} onValueChange={(v) => setBookingOpenMode(v as Settings['bookingOpenMode'])}>
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
        <FieldLabel htmlFor="waitlistCapacity">{labels.waitlistCapacity}</FieldLabel>
        <Input id="waitlistCapacity" name="waitlistCapacity" type="number" min={0} max={999} defaultValue={settings.waitlistCapacity ?? ''} />
        <p className="text-xs text-muted-foreground">{labels.waitlistCapacityHint}</p>
      </Field>
      <Field>
        <FieldLabel htmlFor="noshowPenalty">{labels.noshow}</FieldLabel>
        <Select items={noshowItems} value={noshowPenalty} onValueChange={(v) => setNoshowPenalty(v as Settings['noshowPenalty'])}>
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
        <Select items={multisportItems} value={multisportMode} onValueChange={(v) => setMultisportMode(v as Settings['multisportMode'])}>
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
      {state.status === 'error' && (
        <p className="text-sm text-destructive">{state.cause === 'invalid_lead' ? labels.errorInvalidLead : labels.errorInvalidInput}</p>
      )}
      <PendingButton className="self-start">{labels.save}</PendingButton>
    </form>
  );
}
