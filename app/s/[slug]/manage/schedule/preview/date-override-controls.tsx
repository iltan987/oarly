'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';

import type { ManageActionResult } from '../../action-result';
import { clearOverrideAction, setOverrideAction } from './actions';

/**
 * Three forms, TWO hoisted action states — one per action kind, not one per form.
 *
 * Not one per form, because the reset form only exists while `overridden` is true:
 * a successful clear revalidates the route, `overridden` flips false and that form
 * unmounts, taking a form-local effect with it before its toast could fire.
 *
 * Not one for all three either: the close and force-open forms drive
 * `setOverrideAction` while reset drives `clearOverrideAction`, and a single shared
 * state would dispatch whichever action it was bound to for all three — so pressing
 * reset would write an override instead of removing one.
 */
export function DateOverrideControls({ slug, dateISO, overridden }: { slug: string; dateISO: string; overridden: boolean }) {
  const t = useTranslations('manage.schedulePreview');
  const tm = useTranslations('manage');

  const [setState, setAction] = useActionState<ManageActionResult | null, FormData>(setOverrideAction.bind(null, slug), null);
  const [clearState, clearAction] = useActionState<ManageActionResult | null, FormData>(clearOverrideAction.bind(null, slug), null);
  // A `useActionState` result is a stable object between dispatches, so the effect
  // re-runs on every unrelated re-render — and this control is re-rendered by every
  // sibling day's revalidation. Identity is what stops one refusal being re-toasted
  // for each of those. Each resolved action returns a fresh object, so a genuinely
  // new result is never mistaken for the handled one.
  const setHandled = useRef<ManageActionResult | null>(null);
  const clearHandled = useRef<ManageActionResult | null>(null);

  useEffect(() => {
    if (setState === null || setState === setHandled.current) return;
    setHandled.current = setState;
    // Success needs no toast: the day's own row repaints as closed / open. Failure
    // is what used to be silent — the calendar simply did not change.
    if (!setState.ok) toast.error(tm('actionError'));
  }, [setState, tm]);

  useEffect(() => {
    if (clearState === null || clearState === clearHandled.current) return;
    clearHandled.current = clearState;
    if (!clearState.ok) toast.error(tm('actionError'));
  }, [clearState, tm]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={setAction}>
        <input type="hidden" name="dateISO" value={dateISO} />
        <input type="hidden" name="isOpen" value="closed" />
        <PendingButton variant="outline" size="sm">{t('close')}</PendingButton>
      </form>
      <form action={setAction}>
        <input type="hidden" name="dateISO" value={dateISO} />
        <input type="hidden" name="isOpen" value="open" />
        <PendingButton variant="outline" size="sm">{t('forceOpen')}</PendingButton>
      </form>
      {overridden && (
        <form action={clearAction}>
          <input type="hidden" name="dateISO" value={dateISO} />
          <PendingButton variant="ghost" size="sm">{t('reset')}</PendingButton>
        </form>
      )}
    </div>
  );
}
