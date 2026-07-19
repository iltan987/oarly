'use client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { addSkillLevelAction, deleteSkillLevelAction, type ManageActionResult, renameSkillLevelAction, reorderSkillLevelAction } from './actions';

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
                <RenameForm slug={slug} level={lvl} labels={labels} onDone={() => setEditing(null)} />
              ) : (
                <>
                  <span className="flex-1 font-medium">{lvl.name}</span>
                  <div className="flex items-center gap-1">
                    <ArrowForm slug={slug} id={lvl.id} direction="up" disabled={i === 0} label={labels.moveUp}>↑</ArrowForm>
                    <ArrowForm slug={slug} id={lvl.id} direction="down" disabled={i === levels.length - 1} label={labels.moveDown}>↓</ArrowForm>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(lvl.id)}>{labels.rename}</Button>
                    {confirming === lvl.id ? (
                      <DeleteForm slug={slug} id={lvl.id} confirmText={confirms[lvl.id]} labels={labels} onDone={() => setConfirming(null)} />
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
      <AddForm slug={slug} labels={labels} />
    </div>
  );
}

function AddForm({ slug, labels }: { slug: string; labels: Labels }) {
  const t = useTranslations('manage.skillLevels');
  const tm = useTranslations('manage');
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ManageActionResult | null, FormData>(addSkillLevelAction.bind(null, slug), null);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      toast.success(t('saved'));
      formRef.current?.reset(); // clear the name input after a successful add
    } else {
      toast.error(tm('actionError'));
    }
  }, [state, t, tm]);

  return (
    <form ref={formRef} action={formAction} className="flex items-end gap-2">
      <Field className="flex-1">
        <FieldLabel htmlFor="new-level" className="sr-only">{labels.add}</FieldLabel>
        <Input id="new-level" name="name" placeholder={labels.addPlaceholder} required />
      </Field>
      <Button type="submit" disabled={pending}>{labels.add}</Button>
    </form>
  );
}

function RenameForm({ slug, level, labels, onDone }: { slug: string; level: Level; labels: Labels; onDone: () => void }) {
  const t = useTranslations('manage.skillLevels');
  const tm = useTranslations('manage');
  const [state, formAction, pending] = useActionState<ManageActionResult | null, FormData>(renameSkillLevelAction.bind(null, slug), null);
  const handledRef = useRef<ManageActionResult | null>(null);

  useEffect(() => {
    if (state === null || state === handledRef.current) return;
    handledRef.current = state;
    if (state.ok) {
      toast.success(t('saved'));
      onDone();
    } else {
      toast.error(tm('actionError'));
    }
  }, [state, t, tm, onDone]);

  return (
    <form action={formAction} className="flex flex-1 items-center gap-2">
      <input type="hidden" name="skillLevelId" value={level.id} />
      <Field className="flex-1">
        <FieldLabel htmlFor={`name-${level.id}`} className="sr-only">{labels.rename}</FieldLabel>
        <Input id={`name-${level.id}`} name="name" defaultValue={level.name} autoFocus />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>{labels.save}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>{labels.cancel}</Button>
    </form>
  );
}

function DeleteForm({ slug, id, confirmText, labels, onDone }: { slug: string; id: string; confirmText: string; labels: Labels; onDone: () => void }) {
  const t = useTranslations('manage.skillLevels');
  const tm = useTranslations('manage');
  const [state, formAction, pending] = useActionState<ManageActionResult | null, FormData>(deleteSkillLevelAction.bind(null, slug), null);
  const handledRef = useRef<ManageActionResult | null>(null);

  useEffect(() => {
    if (state === null || state === handledRef.current) return;
    handledRef.current = state;
    if (state.ok) {
      toast.success(t('deleted'));
      onDone();
    } else {
      toast.error(tm('actionError'));
    }
  }, [state, t, tm, onDone]);

  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="skillLevelId" value={id} />
      <span className="max-w-xs text-xs text-muted-foreground">{confirmText}</span>
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>{labels.deleteConfirmYes}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>{labels.cancel}</Button>
    </form>
  );
}

function ArrowForm({ slug, id, direction, disabled, label, children }: {
  slug: string; id: string; direction: 'up' | 'down'; disabled: boolean; label: string; children: React.ReactNode;
}) {
  const tm = useTranslations('manage');
  const [state, formAction, pending] = useActionState<ManageActionResult | null, FormData>(reorderSkillLevelAction.bind(null, slug), null);

  // Reorder is a frequent nudge — surface failures only, no success toast noise.
  useEffect(() => {
    if (state && !state.ok) toast.error(tm('actionError'));
  }, [state, tm]);

  return (
    <form action={formAction}>
      <input type="hidden" name="skillLevelId" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <Button type="submit" size="icon" variant="ghost" aria-label={label} disabled={disabled || pending}>{children}</Button>
    </form>
  );
}
