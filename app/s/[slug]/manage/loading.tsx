import { Skeleton } from '@/components/ui/skeleton';

// Content-only: the manage title and the section nav persist in layout.tsx above this,
// so this fallback only mirrors the card/list region that swaps on tab switch. That
// contract survived the console restructure — the nav moved from a strip above the
// content into ConsoleShell's sidebar, but it is still rendered by the LAYOUT, so it
// still sits above this Suspense boundary and still must not be drawn here.
//
// It renders instantly on navigation so moving between manage destinations no longer
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
