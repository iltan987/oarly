'use client';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { createBoatAction, setBoatActiveAction, updateBoatAction } from './actions';

type Level = { id: string; name: string };
type Boat = { id: string; name: string; seats: number; minSkillLevelId: string | null; allowedPayment: 'regular_only' | 'multisport_only' | 'both'; minAttendance: number | null; active: boolean };
type Labels = {
  name: string; seats: string; minSkill: string; noMinSkill: string; payment: string;
  paymentRegular: string; paymentMultisport: string; paymentBoth: string; minAttendance: string;
  add: string; edit: string; save: string; cancel: string; deactivate: string; activate: string;
  inactive: string; empty: string; needSkillLevels: string;
};

const selectClass = 'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs';

function BoatFields({ boat, levels, labels }: { boat?: Boat; levels: Level[]; labels: Labels }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel htmlFor="name">{labels.name}</FieldLabel>
        <Input id="name" name="name" defaultValue={boat?.name} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="seats">{labels.seats}</FieldLabel>
        <Input id="seats" name="seats" type="number" min={1} max={16} defaultValue={boat?.seats ?? 1} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="minSkillLevelId">{labels.minSkill}</FieldLabel>
        <select id="minSkillLevelId" name="minSkillLevelId" defaultValue={boat?.minSkillLevelId ?? ''} className={selectClass}>
          <option value="">{labels.noMinSkill}</option>
          {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="allowedPayment">{labels.payment}</FieldLabel>
        <select id="allowedPayment" name="allowedPayment" defaultValue={boat?.allowedPayment ?? 'both'} className={selectClass}>
          <option value="both">{labels.paymentBoth}</option>
          <option value="regular_only">{labels.paymentRegular}</option>
          <option value="multisport_only">{labels.paymentMultisport}</option>
        </select>
      </Field>
      <Field className="col-span-2">
        <FieldLabel htmlFor="minAttendance">{labels.minAttendance}</FieldLabel>
        <Input id="minAttendance" name="minAttendance" type="number" min={1} defaultValue={boat?.minAttendance ?? ''} />
      </Field>
    </div>
  );
}

export function BoatsEditor({ slug, boats, levels, labels }: { slug: string; boats: Boat[]; levels: Level[]; labels: Labels }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {levels.length === 0 && <p className="text-xs text-muted-foreground">{labels.needSkillLevels}</p>}
      {boats.length === 0 && !adding ? <p className="text-sm text-muted-foreground">{labels.empty}</p> : (
        <ul className="flex flex-col gap-2">
          {boats.map((b) => (
            <li key={b.id} className="rounded-lg border p-3">
              {editing === b.id ? (
                <form action={updateBoatAction.bind(null, slug)} className="flex flex-col gap-3" onSubmit={() => setEditing(null)}>
                  <input type="hidden" name="boatId" value={b.id} />
                  <BoatFields boat={b} levels={levels} labels={labels} />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">{labels.save}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{labels.cancel}</Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{b.name} {!b.active && <span className="text-xs text-muted-foreground">({labels.inactive})</span>}</div>
                    <div className="text-sm text-muted-foreground">{labels.seats}: {b.seats}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(b.id)}>{labels.edit}</Button>
                    <form action={setBoatActiveAction.bind(null, slug)}>
                      <input type="hidden" name="boatId" value={b.id} />
                      <input type="hidden" name="active" value={b.active ? 'false' : 'true'} />
                      <Button type="submit" size="sm" variant="ghost">{b.active ? labels.deactivate : labels.activate}</Button>
                    </form>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form action={createBoatAction.bind(null, slug)} className="flex flex-col gap-3 rounded-lg border p-3" onSubmit={() => setAdding(false)}>
          <BoatFields levels={levels} labels={labels} />
          <div className="flex gap-2">
            <Button type="submit" size="sm">{labels.save}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>{labels.cancel}</Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" onClick={() => setAdding(true)}>{labels.add}</Button>
      )}
    </div>
  );
}
