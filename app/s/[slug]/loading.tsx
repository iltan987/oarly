import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The tenant fallback, and the one place in this app where the fallback must draw the
 * page chrome itself.
 *
 * Every other `loading.tsx` here is content-only, because `/admin` and `/manage` and the
 * `(member)` group each render their header and nav in a `layout.tsx` ABOVE the Suspense
 * boundary, so that chrome persists and redrawing it would double it. `app/s/[slug]/
 * layout.tsx` renders only `ClubTheme` — a `<div>` carrying the accent custom property —
 * so from here DOWN, header and footer belong to the page. A content-only fallback would
 * render a bare card on an empty page and then pop a whole header and footer in around
 * it.
 *
 * So it goes through `AppShell` with skeleton slots rather than hand-rolling a header:
 * the `h-14` row, the `max-w-[90rem] px-4 sm:px-6` container and the `max-w-md` centered
 * content column then come from the same code the real page uses, and cannot drift from
 * it. The club name and logo are genuinely unknown here — resolving them is the very
 * lookup being waited on.
 *
 * Serves the club landing page and `/join`; `manage/` and `(member)/` have their own.
 *
 * NOTE on what this does and does not cover. The club lookup in `layout.tsx` is uncached
 * runtime data in a layout, and `loading.js` does not show a fallback for a layout above
 * it (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * loading.md`) — without Cache Components the response blocks until that layout resolves.
 * What streams behind this fallback is the PAGE's work: `getCurrentUser`,
 * `getMembership`, `getRestriction` (the page's own `requireClub` is free, memoized by
 * `cache()` from the layout's call). That is most of the landing page's latency, and it
 * was previously spent on a blank tab.
 */
export default function Loading() {
  return (
    <AppShell
      width="md"
      align="center"
      brand={
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton className="size-8 shrink-0 rounded-field" />
          <Skeleton className="h-5 w-32 rounded" />
        </div>
      }
      menu={<Skeleton className="size-8 rounded-full" />}
      footer={
        <footer className="mt-auto w-full">
          <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-x-6 px-4 py-6 sm:px-6">
            <Skeleton className="h-4 w-28 rounded" />
            <Skeleton className="h-4 w-40 rounded" />
          </div>
        </footer>
      }
    >
      <div className="flex flex-col items-center">
        <Card className="w-full items-center gap-6 p-8">
          <Skeleton className="size-16 rounded-card" />
          <div className="flex w-full flex-col items-center gap-2">
            <Skeleton className="h-7 w-48 rounded" />
            <Skeleton className="h-4 w-64 rounded" />
          </div>
          <div className="flex w-full flex-col items-center gap-2">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
