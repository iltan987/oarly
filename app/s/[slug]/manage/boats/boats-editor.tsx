'use client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useOptimistic, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { ManageActionResult } from '../action-result';
import { createBoatAction, setBoatActiveAction, updateBoatAction } from './actions';

type BoatAction = (slug: string, prev: ManageActionResult | null, formData: FormData) => Promise<ManageActionResult>;
type Level = { id: string; name: string };
type Boat = { id: string; name: string; seats: number; minSkillLevelId: string | null; allowedPayment: 'regular_only' | 'multisport_only' | 'both'; minAttendance: number | null; active: boolean };
type Labels = {
  name: string; seats: string; minSkill: string; noMinSkill: string; payment: string;
  paymentRegular: string; paymentMultisport: string; paymentBoth: string; minAttendance: string;
  add: string; edit: string; save: string; cancel: string; deactivate: string; activate: string;
  inactive: string; empty: string; needSkillLevels: string;
};

const NONE_VALUE = 'none';

function BoatFields({ boat, levels, labels, formId, multisportEnabled }: { boat?: Boat; levels: Level[]; labels: Labels; formId: string; multisportEnabled: boolean }) {
  const [minSkillLevelId, setMinSkillLevelId] = useState(boat?.minSkillLevelId ?? NONE_VALUE);
  const [allowedPayment, setAllowedPayment] = useState(boat?.allowedPayment ?? 'both');

  // Base UI's <Select.Value> renders the raw item VALUE unless the root is given
  // an `items` map — without it the trigger shows a uuid / "both" instead of the label.
  const skillItems = { [NONE_VALUE]: labels.noMinSkill, ...Object.fromEntries(levels.map((l) => [l.id, l.name])) };
  const paymentItems = {
    both: labels.paymentBoth, regular_only: labels.paymentRegular, multisport_only: labels.paymentMultisport,
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      {/*
        shadcn/Base UI Select is controlled UI and does not serialize to
        FormData on its own — these hidden inputs are the source of truth for
        the submitted values. Base UI Select can't use an empty-string item
        value, so "no minimum" is represented as the "none" sentinel here and
        mapped back to '' for the server action.
      */}
      <input type="hidden" name="minSkillLevelId" value={minSkillLevelId === NONE_VALUE ? '' : minSkillLevelId} />
      {/*
        `regular_only` is the only possibility once the club has no MultiSport
        contract, so a club that just disabled it and then edits a boat here
        should not silently keep a stale `multisport_only`/`both` value —
        force it, matching the write-time invariant `updateSchedulingSettings`
        already repairs for existing boats.
      */}
      <input type="hidden" name="allowedPayment" value={multisportEnabled ? allowedPayment : 'regular_only'} />
      <Field>
        <FieldLabel htmlFor={`name-${formId}`}>{labels.name}</FieldLabel>
        <Input id={`name-${formId}`} name="name" defaultValue={boat?.name} required />
      </Field>
      <Field>
        <FieldLabel htmlFor={`seats-${formId}`}>{labels.seats}</FieldLabel>
        <Input id={`seats-${formId}`} name="seats" type="number" min={1} max={16} defaultValue={boat?.seats ?? 1} required />
      </Field>
      <Field>
        <FieldLabel htmlFor={`minSkillLevelId-${formId}`}>{labels.minSkill}</FieldLabel>
        <Select items={skillItems} value={minSkillLevelId} onValueChange={(v) => setMinSkillLevelId(v as string)}>
          <SelectTrigger id={`minSkillLevelId-${formId}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>{labels.noMinSkill}</SelectItem>
            {levels.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      {multisportEnabled && (
        <Field>
          <FieldLabel htmlFor={`allowedPayment-${formId}`}>{labels.payment}</FieldLabel>
          <Select items={paymentItems} value={allowedPayment} onValueChange={(v) => setAllowedPayment(v as Boat['allowedPayment'])}>
            <SelectTrigger id={`allowedPayment-${formId}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">{labels.paymentBoth}</SelectItem>
              <SelectItem value="regular_only">{labels.paymentRegular}</SelectItem>
              <SelectItem value="multisport_only">{labels.paymentMultisport}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field className="col-span-2">
        <FieldLabel htmlFor={`minAttendance-${formId}`}>{labels.minAttendance}</FieldLabel>
        <Input id={`minAttendance-${formId}`} name="minAttendance" type="number" min={1} defaultValue={boat?.minAttendance ?? ''} />
      </Field>
    </div>
  );
}

// One boat add/edit form. Closes (via onSuccess) only after the server action
// reports ok, and toasts success/failure — so a rejected save (validation,
// skill-not-in-club, missing row) no longer looks like it worked.
function BoatForm({ slug, boat, levels, labels, action, className, multisportEnabled, onSuccess, onCancel }: {
  slug: string; boat?: Boat; levels: Level[]; labels: Labels; action: BoatAction;
  className: string; multisportEnabled: boolean; onSuccess: () => void; onCancel: () => void;
}) {
  const t = useTranslations('manage');
  const [state, formAction] = useActionState<ManageActionResult | null, FormData>(action.bind(null, slug), null);
  // Gate on the state object's identity (useActionState returns a fresh object
  // per submission) so the toast/close fires once per result and not again when
  // an unrelated re-render changes the `onSuccess`/`t` identities.
  const handledRef = useRef<ManageActionResult | null>(null);

  useEffect(() => {
    if (state === null || state === handledRef.current) return;
    handledRef.current = state;
    if (state.ok) {
      toast.success(t('boats.saved'));
      onSuccess();
    } else {
      toast.error(t('actionError'));
    }
  }, [state, t, onSuccess]);

  return (
    <form action={formAction} className={className}>
      {boat && <input type="hidden" name="boatId" value={boat.id} />}
      <BoatFields boat={boat} levels={levels} labels={labels} formId={boat?.id ?? 'new'} multisportEnabled={multisportEnabled} />
      <div className="flex gap-2">
        <PendingButton size="sm">{labels.save}</PendingButton>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{labels.cancel}</Button>
      </div>
    </form>
  );
}

function BoatActiveButton({ slug, boatId, active, label, onToggle }: {
  slug: string; boatId: string; active: boolean; label: string;
  onToggle: (boatId: string) => void;
}) {
  const t = useTranslations('manage');

  // A plain async function passed as the <form>'s `action` runs inside React's
  // implicit form-action transition, so `onToggle` — a `useOptimistic`
  // dispatch owned by the parent editor — is safe to call here on the current
  // frame. `active` (and therefore the hidden input and label above) is
  // already the OPTIMISTIC value threaded down from `optimisticBoats`, so a
  // second click before the first toggle resolves composes correctly.
  async function handleSubmit(formData: FormData) {
    onToggle(boatId);
    const result = await setBoatActiveAction(slug, null, formData);
    if (result.ok) toast.success(t('boats.saved'));
    else toast.error(t('actionError'));
  }

  return (
    <form action={handleSubmit}>
      <input type="hidden" name="boatId" value={boatId} />
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      <PendingButton size="sm" variant="ghost">{label}</PendingButton>
    </form>
  );
}

export function BoatsEditor({ slug, boats, levels, labels, multisportEnabled }: { slug: string; boats: Boat[]; levels: Level[]; labels: Labels; multisportEnabled: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // The active/inactive flag is a value swap — the row's height never changes
  // and nothing else moves — so it is safe to flip on the current frame. Owned
  // here so the "(inactive)" label next to the boat name and the toggle
  // button's own label stay in sync.
  const [optimisticBoats, toggleBoatActive] = useOptimistic(
    boats,
    (current: Boat[], boatId: string) => current.map((b) => (b.id === boatId ? { ...b, active: !b.active } : b)),
  );

  return (
    <div className="flex flex-col gap-3">
      {levels.length === 0 && <p className="text-xs text-muted-foreground">{labels.needSkillLevels}</p>}
      {optimisticBoats.length === 0 && !adding ? <p className="text-sm text-muted-foreground">{labels.empty}</p> : (
        <ul className="flex flex-col gap-2">
          {optimisticBoats.map((b) => (
            <li key={b.id} className="rounded-lg border p-3">
              {editing === b.id ? (
                <BoatForm
                  slug={slug} boat={b} levels={levels} labels={labels}
                  action={updateBoatAction} className="flex flex-col gap-3" multisportEnabled={multisportEnabled}
                  onSuccess={() => setEditing(null)} onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{b.name} {!b.active && <span className="text-xs text-muted-foreground">({labels.inactive})</span>}</div>
                    <div className="text-sm text-muted-foreground">{labels.seats}: {b.seats}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(b.id)}>{labels.edit}</Button>
                    <BoatActiveButton slug={slug} boatId={b.id} active={b.active} label={b.active ? labels.deactivate : labels.activate} onToggle={toggleBoatActive} />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <BoatForm
          slug={slug} levels={levels} labels={labels}
          action={createBoatAction} className="flex flex-col gap-3 rounded-lg border p-3" multisportEnabled={multisportEnabled}
          onSuccess={() => setAdding(false)} onCancel={() => setAdding(false)}
        />
      ) : (
        <Button type="button" variant="outline" onClick={() => setAdding(true)}>{labels.add}</Button>
      )}
    </div>
  );
}
