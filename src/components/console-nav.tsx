'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';

import { activeNavIndex, type NavItem } from '@/lib/nav-match';

export type ConsoleNavItem = NavItem & { label: string };

/**
 * The section nav of both consoles, in ONE component that renders both orientations —
 * a tab strip below `lg:`, a list beside the canvas at `lg:` and up.
 *
 * Not two subtrees under `hidden`/`lg:hidden`: that duplicates every destination in the
 * accessibility tree and gives a screen-reader user two "Members" links, one of which is
 * invisible. One DOM node per destination, at every viewport.
 *
 * ## The active indicator flips edge, and that is not cosmetic
 *
 * `border-b-2 border-l-0` below `lg:`, `lg:border-b-0 lg:border-l-2` at and above it. An
 * underline is the tab-strip idiom, but on a VERTICAL list a full-width bottom rule sits
 * between two adjacent items and reads as a divider, not as a selection — the indicator
 * would be pointing at the gap. On the vertical axis the selected edge is the leading one.
 *
 * Both widths are declared on every item (the inactive ones with `border-transparent`), so
 * the rule appearing does not change the box and nothing shifts on navigation.
 *
 * Class interaction, so measured rather than argued: at 1023px the current item computes
 * `border-bottom-width: 2px` / `border-left-width: 0px`, and at 1024px the reverse. See
 * this task's report.
 */
export function ConsoleNav({ items }: { items: readonly ConsoleNavItem[] }): ReactElement {
  const pathname = usePathname();
  // Longest match wins — see src/lib/nav-match.ts. A pathname can satisfy an `owns`
  // prefix and a longer sibling href at once, and exactly one item must end up current.
  const activeIndex = activeNavIndex(pathname, items);

  return (
    <nav className="flex flex-wrap gap-1 border-b lg:flex-col lg:flex-nowrap lg:border-b-0">
      {items.map((it, i) => {
        const isActive = activeIndex === i;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={isActive ? 'page' : undefined}
            className={`border-b-2 border-l-0 px-3 py-2 text-sm lg:border-b-0 lg:border-l-2 ${
              isActive
                ? 'border-brand font-medium text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
