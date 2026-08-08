'use client';

import { useTranslations } from 'next-intl';

import { PendingButton } from '@/components/pending-button';

import { clearOverrideAction, setOverrideAction } from './actions';

export function DateOverrideControls({ slug, dateISO, overridden }: { slug: string; dateISO: string; overridden: boolean }) {
  const t = useTranslations('manage.schedulePreview');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={setOverrideAction.bind(null, slug)}>
        <input type="hidden" name="dateISO" value={dateISO} />
        <input type="hidden" name="isOpen" value="closed" />
        <PendingButton variant="outline" size="sm">{t('close')}</PendingButton>
      </form>
      <form action={setOverrideAction.bind(null, slug)}>
        <input type="hidden" name="dateISO" value={dateISO} />
        <input type="hidden" name="isOpen" value="open" />
        <PendingButton variant="outline" size="sm">{t('forceOpen')}</PendingButton>
      </form>
      {overridden && (
        <form action={clearOverrideAction.bind(null, slug)}>
          <input type="hidden" name="dateISO" value={dateISO} />
          <PendingButton variant="ghost" size="sm">{t('reset')}</PendingButton>
        </form>
      )}
    </div>
  );
}
