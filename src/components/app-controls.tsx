import type { ReactNode } from 'react';

import { LanguageToggle } from '@/components/language-toggle';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * The page-chrome control cluster, in one place.
 *
 * This pairing repeats on eight surfaces. Owning it here is what keeps their order and
 * spacing identical, and means the next control added to the chrome lands on all eight
 * at once instead of on whichever ones someone remembered.
 *
 * Order is deliberate: the text control first, then icons, so the row reads
 * left-to-right from widest to narrowest and the icon buttons stay adjacent.
 */
export function AppControls({
  signOutUrl,
  children,
}: {
  signOutUrl?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {children}
      <LanguageToggle />
      <ThemeToggle />
      {signOutUrl ? <SignOutButton redirectTo={signOutUrl} /> : null}
    </div>
  );
}
