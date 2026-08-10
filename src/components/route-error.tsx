'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

/**
 * The fallback every `error.tsx` in the app renders — apex, `(auth)`, `/request-club`,
 * the tenant, the member area, `/manage` and `/admin`.
 *
 * The copy reads from `common`, NOT `booking`. It sat in `booking` while already serving
 * `/admin` and `/manage`, which meant a string on the club-admin console was filed under
 * the member booking flow; `common` is where this repo keeps cross-surface strings.
 * `route-error.test.tsx` pins the namespace, because a wrong namespace is not a crash —
 * next-intl renders the key path as literal text and the page merely looks broken.
 *
 * `app/global-error.tsx` is the one boundary that CANNOT render this: it replaces the
 * root layout, so `NextIntlClientProvider` is not mounted and `useTranslations` throws.
 */
export function RouteError({ reset }: { reset: () => void }) {
  const t = useTranslations('common');
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">{t('loadError')}</p>
      <Button onClick={reset} variant="outline" size="sm">{t('retry')}</Button>
    </div>
  );
}
