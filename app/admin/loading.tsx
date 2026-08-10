import { Skeleton } from '@/components/ui/skeleton';

// Content-only, and it has to be: the console title and the section nav live in
// layout.tsx ABOVE this Suspense boundary, so they persist across a navigation and this
// fallback only mirrors the canvas. Mirroring the nav here would double it.
//
// The search row is part of that canvas. `loading.tsx` replaces the WHOLE segment, and the
// search form lives in app/admin/page.tsx — so without a row here, every search submit
// made the box the operator had just typed into vanish and reappear.
export default function Loading() {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-2">
          <Skeleton className="h-8 flex-1 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl ring-1 ring-foreground/10">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between gap-3 p-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-3 w-20 rounded" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-16 rounded-pill" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
