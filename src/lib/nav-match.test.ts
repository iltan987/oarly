import { describe, expect, it } from 'vitest';

import { activeNavIndex, type NavItem } from './nav-match';

describe('activeNavIndex', () => {
  it('matches an exact-only item on its own path and nowhere else', () => {
    const items: NavItem[] = [{ href: '/admin', exact: true }, { href: '/admin/users' }];
    expect(activeNavIndex('/admin', items)).toBe(0);
    // Without `exact`, '/admin' would be a prefix of every route here.
    expect(activeNavIndex('/admin/users', items)).toBe(1);
  });

  it('matches a prefix item on its descendants', () => {
    const items: NavItem[] = [{ href: '/admin/requests' }];
    expect(activeNavIndex('/admin/requests', items)).toBe(0);
    expect(activeNavIndex('/admin/requests/1', items)).toBe(0);
  });

  it('the descendant boundary: a similarly-named sibling path does not match', () => {
    const items: NavItem[] = [{ href: '/admin' }];
    // `startsWith(prefix + '/')`, not `startsWith(prefix)` — '/adminfoo' must not match.
    expect(activeNavIndex('/adminfoo', items)).toBe(-1);
  });

  it('longest match wins between an `owns` entry and a longer sibling href', () => {
    const items: NavItem[] = [
      { href: '/admin', exact: true, owns: ['/admin/clubs'] },
      { href: '/admin/clubs/new' },
    ];
    // '/admin/clubs/new' matches both the clubs tab's `owns` prefix (12 chars) and its
    // own href (16 chars) — the longer, more specific one must win.
    expect(activeNavIndex('/admin/clubs/new', items)).toBe(1);
    // A plain clubs detail page only matches the `owns` entry.
    expect(activeNavIndex('/admin/clubs/4d4b7b0f-1f6c-4d7e-9b1a-2f2c9b8a1234', items)).toBe(0);
  });

  it('returns -1 when no item matches', () => {
    const items: NavItem[] = [{ href: '/admin' }, { href: '/admin/users' }];
    expect(activeNavIndex('/somewhere/else', items)).toBe(-1);
  });
});
