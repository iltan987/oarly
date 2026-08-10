'use client';

import { RouteError } from '@/components/route-error';

/**
 * `/request-club` runs `requireUser()` and renders a form. It has no `layout.tsx` of its
 * own, so this renders directly inside the root layout and replaces the whole page.
 *
 * `requireUser()`'s redirect for a signed-out visitor is framework control flow, not an
 * error, and passes through this boundary untouched.
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError reset={reset} />;
}
