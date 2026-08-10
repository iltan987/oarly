// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Keys are asserted on directly rather than resolved through the real catalogs — this
// test is about which tab is marked current, not about copy.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const pathname = vi.hoisted(() => ({ value: '/admin' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }));

import { AdminNav } from './_nav';

function renderAt(path: string) {
  pathname.value = path;
  render(<AdminNav />);
}

/** The tab currently marked `aria-current="page"`, or null. */
function currentTab(): string | null {
  const el = document.querySelector('[aria-current="page"]');
  return el ? el.textContent : null;
}

describe('AdminNav active tab', () => {
  // "New club" was a fifth tab until Task 9 demoted it to a button beside the search on
  // /admin: a nav names places you can be, and creating a club is something you do to the
  // list you are already looking at. Both consoles now have four items.
  it('offers four destinations, and creating a club is not one of them', () => {
    renderAt('/admin');
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
      '/admin',
      '/admin/requests',
      '/admin/users',
      '/admin/audit',
    ]);
  });

  it.each([
    ['/admin', 'clubs'],
    ['/admin/requests', 'requests'],
    ['/admin/users', 'users'],
    ['/admin/audit', 'audit'],
  ])('marks %s as %s', (path, key) => {
    renderAt(path);
    expect(currentTab()).toBe(key);
  });

  // The regression this file exists for: the match was exact, so the page every row of
  // the clubs list links to highlighted NOTHING — the console's densest list dropped
  // the operator's place in the nav the moment they clicked into a club.
  it('keeps the clubs tab lit on a club detail page', () => {
    renderAt('/admin/clubs/4d4b7b0f-1f6c-4d7e-9b1a-2f2c9b8a1234');
    expect(currentTab()).toBe('clubs');
  });

  // The create page is still a real route — it just is not a tab any more. It sits under
  // the clubs tab's `owns` subtree, which is where the operator actually is while using
  // it, and exactly one tab is current there.
  it('keeps the clubs tab lit on the create page, and lights exactly one', () => {
    renderAt('/admin/clubs/new');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(currentTab()).toBe('clubs');
  });

  // `/admin` is a prefix of every route in the console, so treating it as one would
  // light the clubs tab up everywhere.
  it('does not let the clubs tab claim an unrelated section', () => {
    renderAt('/admin/users');
    expect(currentTab()).toBe('users');
    expect(screen.getByText('clubs')).not.toHaveAttribute('aria-current');
  });
});
