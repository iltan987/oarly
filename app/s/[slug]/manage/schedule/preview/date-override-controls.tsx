'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

import { clearOverrideAction, setOverrideAction } from './actions';

export function DateOverrideControls({ slug, dateISO, overridden }: { slug: string; dateISO: string; overridden: boolean }) {
  const t = useTranslations('manage.schedulePreview');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={setOverrideAction.bind(null, slug)}>
        <input type="hidden" name="dateISO" value={dateISO} />
        <input type="hidden" name="isOpen" value="closed" />
        <Button type="submit" variant="outline" size="sm">{t('close')}</Button>
      </form>
      <form action={setOverrideAction.bind(null, slug)}>
        <input type="hidden" name="dateISO" value={dateISO} />
        <input type="hidden" name="isOpen" value="open" />
        <Button type="submit" variant="outline" size="sm">{t('forceOpen')}</Button>
      </form>
      {overridden && (
        <form action={clearOverrideAction.bind(null, slug)}>
          <input type="hidden" name="dateISO" value={dateISO} />
          <Button type="submit" variant="ghost" size="sm">{t('reset')}</Button>
        </form>
      )}
    </div>
  );
}
