import type { ReactNode } from 'react';

import { LanguageToggle } from '@/components/language-toggle';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * The page-chrome control cluster, in one place.
 *
 * This pairing repeats on eleven surfaces. Owning it here is what keeps their order and
 * spacing identical, and means the next control added to the chrome lands on all of them
 * at once instead of on whichever ones someone remembered.
 *
 * Order is deliberate: the text control first, then icons, so the row reads
 * left-to-right from widest to narrowest and the icon buttons stay adjacent.
 *
 * The cluster itself (language + theme + sign-out) is always `shrink-0`: it never gets
 * smaller than its content, on any surface. What varies is the root's OWN shrink
 * behaviour, and it depends on whether a leading slot was given:
 *
 * - No leading slot (most surfaces): the root is `shrink-0` too, so the whole component
 *   is immune to compression and whatever sibling sits next to it in the caller's row
 *   (e.g. `member-header.tsx`'s `min-w-0 truncate` club name) absorbs 100% of the squeeze.
 * - A leading slot (the manage layout's account link): the root gets `min-w-0` instead,
 *   so IT can be compressed by its own parent row. That only matters if the slot itself
 *   can then shrink below the cluster's fixed width — which needs `min-w-0` on the slot's
 *   own element, not just here.
 *
 * This isn't a style preference: verified with a real Chromium render (not just spec
 * reasoning), giving the root a flat `min-w-0` regardless of children squeezes the
 * cluster itself down below its content width on surfaces with no leading slot — the
 * controls visually overflow instead of the intended sibling. Giving it `shrink-0`
 * unconditionally instead reproduces the original manage-layout overflow bug, because a
 * nested flex container's automatic min-width caps a `max-width`-limited child's
 * contribution at that max-width (160px here), not at 0, so the root never shrinks far
 * enough for the slot's `truncate` to matter. Only the conditional holds for both.
 */
export function AppControls({
  signOutUrl,
  children,
}: {
  signOutUrl?: string;
  children?: ReactNode;
}) {
  return (
    <div className={children ? 'flex min-w-0 items-center gap-1' : 'flex shrink-0 items-center gap-1'}>
      {children}
      <div className="flex shrink-0 items-center gap-1">
        <LanguageToggle />
        <ThemeToggle />
        {signOutUrl ? <SignOutButton redirectTo={signOutUrl} /> : null}
      </div>
    </div>
  );
}
