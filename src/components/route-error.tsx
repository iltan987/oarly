'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

export function RouteError({ reset }: { reset: () => void }) {
  const t = useTranslations('booking');
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">{t('loadError')}</p>
      <Button onClick={reset} variant="outline" size="sm">{t('retry')}</Button>
    </div>
  );
}
