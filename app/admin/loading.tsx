import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
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
  );
}
