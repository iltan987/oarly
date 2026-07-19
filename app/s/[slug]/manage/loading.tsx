import { Skeleton } from '@/components/ui/skeleton';

// Content-only: the manage title + section nav persist in layout.tsx above this,
// so this fallback only mirrors the card/list region that swaps on tab switch.
// It renders instantly on navigation so moving between manage tabs no longer
// blocks on the server with no feedback.
export default function Loading() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 rounded-card" />
      ))}
    </div>
  );
}
