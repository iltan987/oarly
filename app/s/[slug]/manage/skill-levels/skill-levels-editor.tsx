'use client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useOptimistic, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
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
type MoveAction = { id: string; direction: 'up' | 'down' };

// Swaps the moved level with its neighbour. Reads `current` — the OPTIMISTIC
// list, not the `levels` prop — so a second arrow click before the first
// reorder's round trip resolves composes on top of the first move instead of
// reading a stale server order.
function moveLevel(current: Level[], action: MoveAction): Level[] {
  const idx = current.findIndex((l) => l.id === action.id);
  if (idx === -1) return current;
  const swapWith = action.direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= current.length) return current;
  const next = current.slice();
  [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
  return next;
}

export function SkillLevelsEditor({ slug, levels, labels, confirms }: {
  slug: string; levels: Level[]; labels: Labels; confirms: Record<string, string>;
}) {
  const t = useTranslations('manage.skillLevels');
  const tm = useTranslations('manage');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  // Reorder is a value swap, not an add/remove — the moved row never changes
  // height and nothing above it shifts, so it is safe to apply on the current
  // frame rather than waiting a full round trip. Owned here (not in ArrowForm)
  // because the swap affects two rows' positions, not one row's own state.
  const [optimisticLevels, applyMove] = useOptimistic(levels, moveLevel);

  // Delete state lives here in the stable editor, not in the per-row form: a
  // successful delete revalidates the route and removes that row, which would
  // unmount a row-local effect before its toast fires. This parent survives the
  // removal, so the toast is reliable.
  const [delState, delAction] = useActionState<ManageActionResult | null, FormData>(deleteSkillLevelAction.bind(null, slug), null);
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
      {optimisticLevels.length === 0 ? <p className="text-sm text-muted-foreground">{labels.empty}</p> : (
        <ul className="divide-y rounded-lg border">
          {optimisticLevels.map((lvl, i) => (
            <li key={lvl.id} className="flex items-center justify-between gap-2 p-3 transition-opacity has-data-pending:opacity-40">
              {editing === lvl.id ? (
                <RenameForm slug={slug} level={lvl} labels={labels} onDone={() => setEditing(null)} />
              ) : confirming === lvl.id ? (
                <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-muted-foreground">{confirms[lvl.id]}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <form action={delAction}>
                      <input type="hidden" name="skillLevelId" value={lvl.id} />
                      <PendingButton size="sm" variant="destructive">{labels.deleteConfirmYes}</PendingButton>
                    </form>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>{labels.cancel}</Button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="min-w-0 flex-1 break-words font-medium">{lvl.name}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <ArrowForm slug={slug} id={lvl.id} direction="up" disabled={i === 0} label={labels.moveUp} onMove={applyMove}>↑</ArrowForm>
                    <ArrowForm slug={slug} id={lvl.id} direction="down" disabled={i === optimisticLevels.length - 1} label={labels.moveDown} onMove={applyMove}>↓</ArrowForm>
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
  const [state, formAction] = useActionState<ManageActionResult | null, FormData>(addSkillLevelAction.bind(null, slug), null);

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
      <PendingButton>{labels.add}</PendingButton>
    </form>
  );
}

function RenameForm({ slug, level, labels, onDone }: { slug: string; level: Level; labels: Labels; onDone: () => void }) {
  const t = useTranslations('manage.skillLevels');
  const tm = useTranslations('manage');
  const [state, formAction] = useActionState<ManageActionResult | null, FormData>(renameSkillLevelAction.bind(null, slug), null);
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
      <PendingButton size="sm">{labels.save}</PendingButton>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>{labels.cancel}</Button>
    </form>
  );
}

function ArrowForm({ slug, id, direction, disabled, label, children, onMove }: {
  slug: string; id: string; direction: 'up' | 'down'; disabled: boolean; label: string; children: React.ReactNode;
  onMove: (action: MoveAction) => void;
}) {
  const tm = useTranslations('manage');

  // A plain async function passed as the <form>'s `action` runs inside React's
  // implicit form-action transition (same mechanism `useActionState` builds on),
  // so `onMove` — a `useOptimistic` dispatch — is safe to call here on the
  // current frame, before the awaited server round trip. `PendingButton` still
  // gets its pending state from `useFormStatus`, scoped to this <form>.
  async function handleSubmit(formData: FormData) {
    onMove({ id, direction });
    const result = await reorderSkillLevelAction(slug, null, formData);
    // Reorder is a frequent nudge — surface failures only, no success toast noise.
    if (!result.ok) toast.error(tm('actionError'));
  }

  return (
    <form action={handleSubmit}>
      <input type="hidden" name="skillLevelId" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <PendingButton size="icon" variant="ghost" aria-label={label} disabled={disabled}>{children}</PendingButton>
    </form>
  );
}
