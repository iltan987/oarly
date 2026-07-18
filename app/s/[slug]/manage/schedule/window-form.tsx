'use client';
import { useActionState, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { saveWindowAction, type WindowFormState } from './actions';

type Boat = { id: string; name: string };
type BoatRow = { boatTypeId: string; quantity: number };
type WindowData = { id: string; startTime: string; endTime: string; defaultSessionMinutes: number; boats: { boatTypeId: string; quantity: number }[] };
type Labels = {
  startTime: string; endTime: string; sessionMinutes: string; boats: string; addBoat: string;
  removeBoat: string; save: string; cancel: string; errors: Record<string, string>;
};

const initial: WindowFormState = { status: 'idle', error: null };

export function WindowForm({ slug, weekday, window, boats, labels, onClose }: {
  slug: string; weekday: number; window?: WindowData; boats: Boat[]; labels: Labels; onClose: () => void;
}) {
  const [state, formAction] = useActionState(saveWindowAction.bind(null, slug), initial);
  const [rows, setRows] = useState<BoatRow[]>(
    window?.boats.map((b) => ({ boatTypeId: b.boatTypeId, quantity: b.quantity })) ?? [{ boatTypeId: boats[0].id, quantity: 1 }],
  );
  useEffect(() => { if (state.status === 'ok') onClose(); }, [state, onClose]);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border p-3">
      {window && <input type="hidden" name="windowId" value={window.id} />}
      <input type="hidden" name="weekday" value={weekday} />
      <div className="grid grid-cols-3 gap-3">
        <Field>
          <FieldLabel htmlFor="startTime">{labels.startTime}</FieldLabel>
          <Input id="startTime" name="startTime" type="time" defaultValue={window?.startTime.slice(0, 5) ?? '08:00'} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="endTime">{labels.endTime}</FieldLabel>
          <Input id="endTime" name="endTime" type="time" defaultValue={window?.endTime.slice(0, 5) ?? '11:00'} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="defaultSessionMinutes">{labels.sessionMinutes}</FieldLabel>
          <Input id="defaultSessionMinutes" name="defaultSessionMinutes" type="number" min={5} step={5} defaultValue={window?.defaultSessionMinutes ?? 60} required />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{labels.boats}</span>
        {rows.map((row, i) => (
          <div key={i} className="flex items-end gap-2">
            {/*
              shadcn/Base UI Select is controlled UI and does not serialize to
              FormData on its own — this hidden input is the source of truth
              for the submitted value, read positionally alongside `quantity`.
            */}
            <input type="hidden" name="boatTypeId" value={row.boatTypeId} />
            <Select
              value={row.boatTypeId}
              onValueChange={(v) => setRows(rows.map((r, j) => (j === i ? { ...r, boatTypeId: v as string } : r)))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {boats.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              type="number"
              name="quantity"
              min={1}
              value={row.quantity}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, quantity: Number(e.target.value) } : r)))}
              className="w-20"
            />
            {rows.length > 1 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>{labels.removeBoat}</Button>
            )}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setRows([...rows, { boatTypeId: boats[0].id, quantity: 1 }])}>
          {labels.addBoat}
        </Button>
      </div>
      {state.status === 'error' && (
        <p className="text-sm text-destructive">{state.error ? labels.errors[state.error] : labels.errors.generic}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm">{labels.save}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>{labels.cancel}</Button>
      </div>
    </form>
  );
}
