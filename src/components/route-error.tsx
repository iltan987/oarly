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
 *
 * ## `retry`, never `reset` — the button is dead otherwise
 *
 * Next's boundary passes BOTH (`next/dist/client/components/error-boundary.js:113-114`),
 * and they are not variations on a theme:
 *
 *     reset = () => this.setState({ error: null })
 *     retry = () => startTransition(() => { this.context?.refresh(); this.reset() })
 *
 * `reset` only clears the boundary's own error state. Every one of these boundaries
 * guards a SERVER component's data read, and clearing client state re-renders the same
 * already-failed RSC payload — so the fallback simply reappears. `retry` calls
 * `router.refresh()` first, which is what re-runs the server render.
 *
 * Measured, not inferred: with a page that throws only while a flag file exists, deleting
 * the flag and pressing this button recovered the page with `retry` and did nothing at all
 * with `reset`. `route-error.test.tsx` passes both props and asserts the click reaches
 * `retry` and never `reset`, so a revert fails rather than shipping a dead control.
 */
export function RouteError({ retry }: { retry: () => void }) {
  const t = useTranslations('common');
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">{t('loadError')}</p>
      <Button onClick={retry} variant="outline" size="sm">{t('retry')}</Button>
    </div>
  );
}
