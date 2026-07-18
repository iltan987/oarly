export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-6 h-8 w-40 animate-pulse rounded-field bg-muted" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-card bg-muted" />
        ))}
      </div>
    </div>
  );
}
