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
            <div className="size-8 animate-pulse rounded-field bg-muted" />
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
          </div>
          <div className="flex gap-1">
            <div className="size-8 animate-pulse rounded-md bg-muted" />
            <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
        <div className="flex gap-4 border-b pb-2">
          <div className="h-5 w-12 animate-pulse rounded bg-muted" />
          <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="mb-4 h-7 w-44 animate-pulse rounded bg-muted" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-card bg-muted" />
        ))}
      </div>
    </div>
  );
}
