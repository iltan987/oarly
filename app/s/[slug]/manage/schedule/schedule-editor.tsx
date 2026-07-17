'use client';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { deleteWindowAction } from './actions';
import { WindowForm } from './window-form';

type Boat = { id: string; name: string };
type WindowRow = { id: string; weekday: number; startTime: string; endTime: string; defaultSessionMinutes: number; boats: { boatTypeId: string; boatName: string; quantity: number }[] };
type Labels = {
  addWindow: string; noWindows: string; edit: string; delete: string; minutesShort: string; needBoats: string;
  startTime: string; endTime: string; sessionMinutes: string; boats: string; addBoat: string; removeBoat: string;
  save: string; cancel: string; errors: Record<string, string>;
};

// Storage weekday is 0=Sunday..6=Saturday; display Monday-first.
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function ScheduleEditor({ slug, windows, boats, weekdayNames, labels }: {
  slug: string; windows: WindowRow[]; boats: Boat[]; weekdayNames: Record<number, string>; labels: Labels;
}) {
  const [addingDay, setAddingDay] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (boats.length === 0) return <p className="text-sm text-muted-foreground">{labels.needBoats}</p>;

  return (
    <div className="flex flex-col gap-5">
      {DISPLAY_ORDER.map((wd) => {
        const dayWindows = windows.filter((w) => w.weekday === wd);
        return (
          <section key={wd} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-semibold">{weekdayNames[wd]}</h3>
              <Button type="button" variant="outline" size="sm" onClick={() => { setAddingDay(wd); setEditingId(null); }}>{labels.addWindow}</Button>
            </div>
            {dayWindows.length === 0 && addingDay !== wd && <p className="text-sm text-muted-foreground">{labels.noWindows}</p>}
            {dayWindows.length > 0 && (
              <ul className="flex flex-col gap-2">
                {dayWindows.map((w) => (
                  <li key={w.id} className="rounded-lg border p-3">
                    {editingId === w.id ? (
                      <WindowForm slug={slug} weekday={wd} window={w} boats={boats} labels={labels} onClose={() => setEditingId(null)} />
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm">
                          {w.startTime.slice(0, 5)}–{w.endTime.slice(0, 5)} · {w.defaultSessionMinutes} {labels.minutesShort} · {w.boats.map((b) => `${b.boatName} ×${b.quantity}`).join(', ')}
                        </span>
                        <div className="flex items-center gap-2">
                          <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingId(w.id); setAddingDay(null); }}>{labels.edit}</Button>
                          <form action={deleteWindowAction.bind(null, slug)}>
                            <input type="hidden" name="windowId" value={w.id} />
                            <Button type="submit" size="sm" variant="ghost">{labels.delete}</Button>
                          </form>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {addingDay === wd && <WindowForm slug={slug} weekday={wd} boats={boats} labels={labels} onClose={() => setAddingDay(null)} />}
          </section>
        );
      })}
    </div>
  );
}
