// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Keys are asserted on directly rather than resolved through the real catalogs — this
// file is about which destination is marked current, not about copy.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const pathname = vi.hoisted(() => ({ value: '/manage' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }));

import { ManageNav } from './_nav';

function renderAt(path: string) {
  pathname.value = path;
  render(<ManageNav />);
}

/** Every element marked `aria-current="page"`, by its label. */
function currentTabs(): string[] {
  return Array.from(document.querySelectorAll('[aria-current="page"]')).map((el) => el.textContent ?? '');
}

describe('ManageNav', () => {
  /**
   * The reported defect, in one assertion: "there are so many tab items now ... in my
   * phone I see 4 rows of buttons." Eight destinations became four; the other five moved
   * behind the settings index, at URLs that did not change.
   */
  it('offers four destinations, not eight', () => {
    renderAt('/manage');
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/manage',
      '/manage/bookings',
      '/manage/members',
      '/manage/settings',
    ]);
  });

  /**
   * The label AND the count, on every one of the seven paths. Asserting only "exactly
   * one is current" would pass with `exact` dropped from Overview (whose href is a prefix
   * of the whole console, so it would light up on all seven) — a sibling entry masking
   * the item under test is the failure mode that bit `nav-match`'s own first tests.
   *
   * The last three rows are the ones `owns` exists for: `/manage/profile` and
   * `/manage/schedule` are NOT under `/manage/settings` by any prefix rule, and
   * `/manage/schedule/preview` reaches Settings only because `/manage/schedule` is a
   * prefix of it. Take `owns` away and all three light nothing at all.
   */
  it.each([
    ['/manage', 'overviewNav'],
    ['/manage/bookings', 'bookings.navLabel'],
    ['/manage/members', 'members'],
    ['/manage/settings', 'settings.navLabel'],
    ['/manage/profile', 'settings.navLabel'],
    ['/manage/schedule', 'settings.navLabel'],
    ['/manage/schedule/preview', 'settings.navLabel'],
  ])('marks exactly one destination current on %s, and it is %s', (path, label) => {
    renderAt(path);
    expect(currentTabs()).toEqual([label]);
  });

  // The other three setup pages, for completeness: `owns` names five subtrees and a test
  // that exercised two of them could not tell a complete list from a partial one.
  it.each([
    ['/manage/skill-levels'],
    ['/manage/boats'],
    ['/manage/policies'],
  ])('folds %s under Settings', (path) => {
    renderAt(path);
    expect(currentTabs()).toEqual(['settings.navLabel']);
  });

  // Overview's href is a prefix of every route in this console. As a prefix rule it would
  // claim all of them, which is why it is `exact`.
  it('does not let Overview claim the pages beneath it', () => {
    renderAt('/manage/members');
    expect(screen.getByRole('link', { name: 'overviewNav' })).not.toHaveAttribute('aria-current');
  });

  // No `<Link>` may carry the internal `/s/{slug}/manage/...` form: the proxy rewrites
  // again on the next client-side navigation and the double prefix 404s.
  it('links to public tenant paths only', () => {
    renderAt('/manage');
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toMatch(/^\/s\//);
    }
  });
});
