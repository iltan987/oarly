'use client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import type { ManageActionResult } from '../action-result';
import { addSkillLevelAction, deleteSkillLevelAction, renameSkillLevelAction, reorderSkillLevelAction } from './actions';

type Level = { id: string; name: string; refs: { members: number; boats: number } };
type Labels = {
  addPlaceholder: string; add: string; moveUp: string; moveDown: string;
  rename: string; save: string; cancel: string; delete: string; deleteConfirmYes: string; empty: string;
};

export function SkillLevelsEditor({ slug, levels, labels, confirms }: {
  slug: string; levels: Level[]; labels: Labels; confirms: Record<string, string>;
}) {
  const t = useTranslations('manage.skillLevels');
  const tm = useTranslations('manage');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  // Delete state lives here in the stable editor, not in the per-row form: a
  // successful delete revalidates the route and removes that row, which would
  // unmount a row-local effect before its toast fires. This parent survives the
  // removal, so the toast is reliable.
  const [delState, delAction, delPending] = useActionState<ManageActionResult | null, FormData>(deleteSkillLevelAction.bind(null, slug), null);
  const delHandled = useRef<ManageActionResult | null>(null);
  useEffect(() => {
    if (delState === null || delState === delHandled.current) return;
    delHandled.current = delState;
    // On success the row is removed by revalidation, so the confirm UI unmounts
    // with it — no need to reset `confirming`. On failure the row stays and the
    // confirm stays open so the owner can retry.
    if (delState.ok) toast.success(t('deleted'));
    else toast.error(tm('actionError'));
  }, [delState, t, tm]);

  return (
    <div className="flex flex-col gap-3">
      {levels.length === 0 ? <p className="text-sm text-muted-foreground">{labels.empty}</p> : (
        <ul className="divide-y rounded-lg border">
          {levels.map((lvl, i) => (
            <li key={lvl.id} className="flex items-center justify-between gap-2 p-3">
              {editing === lvl.id ? (
                <RenameForm slug={slug} level={lvl} labels={labels} onDone={() => setEditing(null)} />
              ) : confirming === lvl.id ? (
                <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-muted-foreground">{confirms[lvl.id]}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <form action={delAction}>
                      <input type="hidden" name="skillLevelId" value={lvl.id} />
                      <Button type="submit" size="sm" variant="destructive" disabled={delPending}>{labels.deleteConfirmYes}</Button>
                    </form>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>{labels.cancel}</Button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="min-w-0 flex-1 break-words font-medium">{lvl.name}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <ArrowForm slug={slug} id={lvl.id} direction="up" disabled={i === 0} label={labels.moveUp}>↑</ArrowForm>
                    <ArrowForm slug={slug} id={lvl.id} direction="down" disabled={i === levels.length - 1} label={labels.moveDown}>↓</ArrowForm>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(lvl.id)}>{labels.rename}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(lvl.id)}>{labels.delete}</Button>
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
