'use client';

import { RouteError } from '@/components/route-error';

/**
 * Sign-in, sign-up, verify-email, forgot-password and reset-password. A throw in any of
 * the five blanked the tab mid-sign-up before this.
 *
 * It renders INSIDE `(auth)/layout.tsx` — `error.tsx` is nested within its own segment's
 * layout, it just cannot catch it — so the `AppShell` header, brand and footer stay put
 * and only the form column is replaced.
 */
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError retry={retry} />;
}
