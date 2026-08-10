import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Every page the Settings tab OWNS has to offer a way back to the index that now holds
 * it — otherwise shrinking the nav to four items took the fifth-to-eighth destinations
 * off the screen and left no return path but the browser button.
 *
 * The list is DERIVED from `_nav.tsx`'s `owns` array rather than written out here. A
 * hand-copied list only guards the pages that existed when it was written: the next task
 * to add a setup page would add it to `owns`, forget the back link, and this file would go
 * on passing. Reading the source is also the only way to see this at all — the pages are
 * server components with five different sets of data dependencies, and a render test for
 * each would be five mock harnesses to assert one anchor.
 *
 * `expect(owned).toHaveLength(5)` is the control. Without it, a regex that stopped matching
 * (the array reformatted, the key renamed) would yield an empty list and every assertion
 * below would pass vacuously — which is exactly the shape of failure this run keeps
 * finding.
 */
function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

/** The route subtrees `_nav.tsx` hands to the Settings destination, e.g. `/profile`. */
function ownedBySettings(): string[] {
  const nav = read('./_nav.tsx');
  const block = /labelKey:\s*'settings\.navLabel',\s*owns:\s*\[([^\]]*)\]/.exec(nav);
  if (!block) return [];
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('the settings back links', () => {
  const owned = ownedBySettings();

  it('reads the owned routes out of the nav, and there are five of them', () => {
    expect(owned).toEqual(['/profile', '/skill-levels', '/boats', '/schedule', '/policies']);
    expect(owned).toHaveLength(5);
  });

  it.each(owned)('%s offers a way back to the settings index', (route) => {
    expect(read(`.${route}/page.tsx`)).toContain('<BackLink href="/manage/settings"');
  });

  /**
   * The one page whose back link points somewhere else, because it is the one page whose
   * parent really is its parent: `/manage/schedule/preview` sits under `/manage/schedule`.
   * Sending it to the settings index instead would skip a level the URL genuinely has.
   */
  it('sends the schedule preview back to the schedule, not to the index', () => {
    const preview = read('./schedule/preview/page.tsx');
    expect(preview).toContain('<BackLink href="/manage/schedule"');
    expect(preview).not.toContain('<BackLink href="/manage/settings"');
  });

  /**
   * No `<Link>` in the console may carry the internal `/s/{slug}/manage/...` form — the
   * proxy rewrites again on the next client-side navigation and the double prefix 404s.
   */
  it.each([...owned, '/schedule/preview'])('%s links by public tenant path', (route) => {
    expect(read(`.${route}/page.tsx`)).not.toMatch(/href="\/s\//);
  });
});
