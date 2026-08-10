import type { CSSProperties } from 'react';

/**
 * The three theme choices the product offers, and the only values `user.theme` may hold.
 *
 * Lives here rather than in `user-menu.tsx`, which is where it used to live and which is
 * the only thing that RENDERS it, because `src/auth.ts` has to bind
 * `additionalFields.theme` to the same set — and a `'use client'` module that imports
 * `next-themes` has no business being pulled into the auth server config. `next-themes`
 * takes these strings as-is; `system` is its own name for "follow the OS", not a fourth
 * palette.
 */
export const THEMES = ['light', 'dark', 'system'] as const;
export type ThemeChoice = (typeof THEMES)[number];

/** Returns an inline style that overrides the club brand accent, or {} when none. */
export function accentStyle(accent?: string | null): CSSProperties {
  return accent ? ({ '--club-accent': accent } as CSSProperties) : {};
}
