import type { ReactElement, ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';

/**
 * The two consoles' page frame: title, then a section nav beside a content canvas.
 *
 * ## The header is not part of this
 *
 * `AppShell` owns one full-bleed header with a constant `max-w-[90rem]` inner container on
 * every surface of the product, and the acceptance criterion for this whole run is that
 * the menu trigger's `getBoundingClientRect().right` is identical across sections at each
 * viewport. So the sidebar and the canvas go strictly BELOW the header, the section title
 * stays in the content column, and nothing here can reach the chrome. `width="[90rem]"` is
 * the one width that matches the header's own container, so the console's outer edges line
 * up with the controls above them — the gutter (`px-4 sm:px-6`) comes from `AppShell` too,
 * which is what actually matters below ~480px where every `max-w-*` is inert.
 *
 * ## `min-w-0` on the canvas is load-bearing, not cosmetic
 *
 * A flex item's automatic minimum size is its CONTENT, not zero — so `flex-1` alone does
 * not let the canvas shrink below the widest thing inside it. One 60-character member name
 * in the roster, or one long club name in the admin list, and the canvas refuses to
 * narrow, pushing the sidebar off the left edge and the document into horizontal scroll.
 * `min-w-0` is what caps its contribution at zero and makes `flex-1` mean what it looks
 * like it means.
 *
 * This is the same mechanism `app-shell.tsx`'s doc comment records, where it was reasoned
 * wrong twice before being settled by rendering. jsdom cannot lay out, so the class is
 * pinned in `console-shell.test.tsx` and the behaviour is measured in a browser — see this
 * task's report for `documentElement.scrollWidth === clientWidth` at 1024 and 1440 with a
 * 60-character name seeded.
 *
 * ## Why the canvas stops at `lg:max-w-5xl`
 *
 * 1024px, deliberately, on a 1440px screen with room to spare. Past roughly 1000px a
 * destructive control sits a hand-span away from the name it belongs to, and on a 25-row
 * roster that is a mis-click hazard — the same condition `app/admin/club-status-button.tsx`
 * cites when it justifies asking for confirmation. Width should buy alignment, not
 * distance. The leftover space becomes the centring margin, not a wider row.
 */
export function ConsoleShell({
  brand,
  menu,
  title,
  nav,
  children,
}: {
  /** Header left slot, passed straight through: wordmark on apex, club on a tenant. */
  brand: ReactNode;
  /** Header right slot, passed straight through. Never re-wrapped or re-sized here. */
  menu: ReactNode;
  /** The section `<h1>`. In the content column, NOT in the chrome — putting it in the
   *  controls row is what used to move the menu trigger's y between sections. */
  title: ReactNode;
  /** The section nav. Renders both orientations itself; this only gives it a column. */
  nav: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <AppShell width="[90rem]" brand={brand} menu={menu}>
      {title}
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <div className="lg:w-56 lg:shrink-0">{nav}</div>
        <div className="min-w-0 flex-1 lg:max-w-5xl">{children}</div>
      </div>
    </AppShell>
  );
}
