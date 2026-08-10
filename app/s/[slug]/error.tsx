'use client';

import { RouteError } from '@/components/route-error';

/**
 * The tenant-wide net: the club landing page and `/join` had no boundary at all, so a
 * failed club or membership read on either blanked the tab.
 *
 * It does NOT catch `app/s/[slug]/layout.tsx`'s `requireClub` — that is the layout in
 * this same segment, and `error.tsx` never wraps its own layout. Those throws go up to
 * `app/error.tsx`, which is why that file exists.
 *
 * `manage/` and `(member)/` keep their own boundaries below this one; this catches only
 * what they do not.
 */
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError retry={retry} />;
}
