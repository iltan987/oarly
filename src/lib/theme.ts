import type { CSSProperties } from 'react';

/** Returns an inline style that overrides the club brand accent, or {} when none. */
export function accentStyle(accent?: string | null): CSSProperties {
  return accent ? ({ '--club-accent': accent } as CSSProperties) : {};
}
