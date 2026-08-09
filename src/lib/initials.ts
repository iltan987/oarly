/**
 * The two-letter uppercase initials of a name, for use as an avatar fallback.
 *
 * Lived in three byte-identical copies (`app/page.tsx`, `app/s/[slug]/page.tsx`, and the
 * since-deleted `src/components/member-header.tsx`) before it was extracted here.
 */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
