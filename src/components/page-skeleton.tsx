import { Skeleton } from '@/components/ui/skeleton';

export function PageSkeleton() {
  // Mirrors the member layout (MemberHeader identity row + nav underline, then a
  // title, then content cards) so the swap to real content shifts as little as
  // possible. The top region is deterministic and matched closely; the card
  // silhouettes are a moderate height that sits between the Book day cards and
  // the smaller My Bookings rows, since both screens share this one skeleton.
  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-field" />
            <Skeleton className="h-5 w-32 rounded" />
          </div>
          <div className="flex gap-1">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>
        </div>
        <div className="flex gap-4 border-b pb-2">
          <Skeleton className="h-5 w-12 rounded" />
          <Skeleton className="h-5 w-24 rounded" />
        </div>
      </div>
      <Skeleton className="mb-4 h-7 w-44 rounded" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
    </div>
  );
}
