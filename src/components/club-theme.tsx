import type { ReactNode } from 'react';
import { accentStyle } from '@/lib/theme';

/** Scopes a per-club brand accent to its subtree. */
export function ClubTheme({ accent, children }: { accent?: string | null; children: ReactNode }) {
  return <div style={accentStyle(accent)}>{children}</div>;
}
