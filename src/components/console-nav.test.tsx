// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const pathname = vi.hoisted(() => ({ value: '/admin' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }));

import { ConsoleNav } from './console-nav';

const items = [
  { href: '/admin', label: 'Clubs', exact: true, owns: ['/admin/clubs'] },
  { href: '/admin/requests', label: 'Requests' },
  { href: '/admin/users', label: 'Users' },
];

function renderAt(path: string) {
  pathname.value = path;
  return render(<ConsoleNav items={items} />);
}

describe('ConsoleNav', () => {
  /**
   * The reason this is one component rather than a tab strip and a sidebar rendered under
   * `hidden` / `lg:hidden`: a duplicated subtree puts every destination in the
   * accessibility tree twice, and a screen-reader user gets two "Users" links, one of
   * which is invisible at whatever viewport they are on. Counting by href, not by class.
   */
  it('renders each destination exactly once, at every viewport', () => {
    renderAt('/admin');
    expect(screen.getAllByRole('link')).toHaveLength(items.length);
    for (const item of items) {
      expect(document.querySelectorAll(`a[href="${item.href}"]`)).toHaveLength(1);
    }
  });

  it('marks exactly one destination current, through activeNavIndex', () => {
    renderAt('/admin/clubs/4d4b7b0f-1f6c-4d7e-9b1a-2f2c9b8a1234');
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Clubs');
  });

  /**
   * The orientation flip, pinned as classes on the ANCHOR ITSELF — there is no nested
   * primitive here to match by accident, which is the failure mode a `container
   * .querySelector('.border-l-2')` would have.
   *
   * jsdom cannot lay out or resolve a media query, so this pins the four utilities and the
   * BROWSER measurement in this task's report pins what they compute to: at 1023px the
   * current item is `border-bottom-width: 2px` / `border-left-width: 0px`, at 1024px the
   * reverse. Neither half is sufficient alone: the classes could be right and shadowed by
   * a later rule, or the computed value could be right today and rest on a class nobody
   * wrote down.
   */
  it('declares a bottom rule below lg and a left rule at lg, on the current item', () => {
    renderAt('/admin/users');
    const current = screen.getByRole('link', { name: 'Users' });
    expect(current).toHaveClass('border-b-2', 'border-l-0', 'lg:border-b-0', 'lg:border-l-2');
    expect(current).toHaveClass('border-brand');
  });

  /**
   * Every item declares both widths, the inactive ones transparently. If only the current
   * item carried a 2px edge, the box would grow by 2px on selection and the whole strip
   * would jog sideways on every navigation.
   */
  it('gives an inactive item the same box and only a different colour', () => {
    renderAt('/admin/users');
    const inactive = screen.getByRole('link', { name: 'Requests' });
    expect(inactive).toHaveClass('border-b-2', 'border-l-0', 'lg:border-b-0', 'lg:border-l-2');
    expect(inactive).toHaveClass('border-transparent');
    expect(inactive).not.toHaveAttribute('aria-current');
  });

  /**
   * A tab strip's baseline rule below `lg:`, and none at `lg:` — a horizontal rule under a
   * vertical list is a divider under the last item, not a strip.
   */
  it('keeps the strip rule for the horizontal orientation only', () => {
    const { container } = renderAt('/admin');
    const nav = container.querySelector('nav')!;
    expect(nav).toHaveClass('flex', 'flex-wrap', 'border-b', 'lg:flex-col', 'lg:flex-nowrap', 'lg:border-b-0');
  });
});
