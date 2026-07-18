import { Skeleton } from '@/components/ui/skeleton';

export function PageSkeleton() {
  // Content-only: the real MemberHeader (identity row + nav) now persists in the
  // (member) group layout above this, so this skeleton just mirrors the title +
  // card region that follows it. The card silhouettes are a moderate height that
  // sits between the Book day cards and the smaller My Bookings rows, since both
  // screens share this one skeleton.
  return (
    <>
      <Skeleton className="mb-4 h-7 w-44 rounded" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
    </>
  );
}
