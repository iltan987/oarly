'use client';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { addSkillLevelAction, deleteSkillLevelAction, renameSkillLevelAction, reorderSkillLevelAction } from './actions';

type Level = { id: string; name: string; refs: { members: number; boats: number } };
type Labels = {
  addPlaceholder: string; add: string; moveUp: string; moveDown: string;
  rename: string; save: string; cancel: string; delete: string; deleteConfirmYes: string; empty: string;
};

export function SkillLevelsEditor({ slug, levels, labels, confirms }: {
  slug: string; levels: Level[]; labels: Labels; confirms: Record<string, string>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {levels.length === 0 ? <p className="text-sm text-muted-foreground">{labels.empty}</p> : (
        <ul className="divide-y rounded-lg border">
          {levels.map((lvl, i) => (
            <li key={lvl.id} className="flex items-center justify-between gap-2 p-3">
              {editing === lvl.id ? (
                <form action={renameSkillLevelAction.bind(null, slug)} className="flex flex-1 items-center gap-2" onSubmit={() => setEditing(null)}>
                  <input type="hidden" name="skillLevelId" value={lvl.id} />
                  <Field className="flex-1">
                    <FieldLabel htmlFor={`name-${lvl.id}`} className="sr-only">{labels.rename}</FieldLabel>
                    <Input id={`name-${lvl.id}`} name="name" defaultValue={lvl.name} autoFocus />
                  </Field>
                  <Button type="submit" size="sm">{labels.save}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{labels.cancel}</Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 font-medium">{lvl.name}</span>
                  <div className="flex items-center gap-1">
                    <ArrowForm slug={slug} id={lvl.id} direction="up" disabled={i === 0} label={labels.moveUp}>↑</ArrowForm>
                    <ArrowForm slug={slug} id={lvl.id} direction="down" disabled={i === levels.length - 1} label={labels.moveDown}>↓</ArrowForm>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(lvl.id)}>{labels.rename}</Button>
                    {confirming === lvl.id ? (
                      <form action={deleteSkillLevelAction.bind(null, slug)} className="flex items-center gap-1" onSubmit={() => setConfirming(null)}>
                        <input type="hidden" name="skillLevelId" value={lvl.id} />
                        <span className="max-w-xs text-xs text-muted-foreground">{confirms[lvl.id]}</span>
                        <Button type="submit" size="sm" variant="destructive">{labels.deleteConfirmYes}</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>{labels.cancel}</Button>
                      </form>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(lvl.id)}>{labels.delete}</Button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form action={addSkillLevelAction.bind(null, slug)} className="flex items-end gap-2">
        <Field className="flex-1">
          <FieldLabel htmlFor="new-level" className="sr-only">{labels.add}</FieldLabel>
          <Input id="new-level" name="name" placeholder={labels.addPlaceholder} required />
        </Field>
        <Button type="submit">{labels.add}</Button>
      </form>
    </div>
  );
}

function ArrowForm({ slug, id, direction, disabled, label, children }: {
  slug: string; id: string; direction: 'up' | 'down'; disabled: boolean; label: string; children: React.ReactNode;
}) {
  return (
    <form action={reorderSkillLevelAction.bind(null, slug)}>
      <input type="hidden" name="skillLevelId" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <Button type="submit" size="icon" variant="ghost" aria-label={label} disabled={disabled}>{children}</Button>
    </form>
  );
}
