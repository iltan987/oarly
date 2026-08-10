'use client';

import { RouteError } from '@/components/route-error';

/**
 * The app-wide net, and the only boundary in this repo that sits ABOVE the tenant layout.
 *
 * `error.tsx` wraps its segment's children — `loading.tsx`, `not-found.tsx`, `page.tsx`
 * and every NESTED `layout.tsx` — but NOT the `layout.tsx` in its own segment
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`).
 * Two consequences, and both are the reason this file exists:
 *
 *  - `app/s/[slug]/layout.tsx` calls `requireClub`. That layout is a NESTED layout from
 *    here, so a throw inside it lands here. No `error.tsx` anywhere under `/s/[slug]` can
 *    catch it, because from their position it is the layout above them.
 *  - A throw in `app/layout.tsx` itself — `getLocale()`, `ThemeProvider`,
 *    `NextIntlClientProvider` — does NOT land here. That is `app/global-error.tsx`.
 *
 * This also covers the apex home's club/membership reads, and `/request-club`'s and
 * `/privacy`'s render. It renders inside `app/layout.tsx`, so `NextIntlClientProvider` is
 * mounted and `RouteError` can translate.
 *
 * `redirect()` and `notFound()` pass straight through: they are thrown as framework
 * control-flow errors that Next re-throws rather than showing a boundary for, which is
 * what keeps `requireClub`'s 404 and `requireOwner`'s sign-in redirect working with this
 * file in place. Verified by URL against a running server, not by reading this comment —
 * see this task's report.
 */
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError retry={retry} />;
}
