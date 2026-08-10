// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConsoleShell } from './console-shell';

function renderShell() {
  return render(
    <ConsoleShell
      brand={<span>brand</span>}
      menu={<button type="button">menu</button>}
      title={<h1>Console</h1>}
      nav={<nav aria-label="section">nav</nav>}
    >
      <p>canvas</p>
    </ConsoleShell>,
  );
}

/** `[nav column, content column]` — the two flex items of the console row. */
function columns(): [HTMLElement, HTMLElement] {
  const row = screen.getByRole('main').children[1] as HTMLElement;
  const [navColumn, contentColumn] = Array.from(row.children) as HTMLElement[];
  return [navColumn, contentColumn];
}

function row(): HTMLElement {
  return screen.getByRole('main').children[1] as HTMLElement;
}

describe('ConsoleShell', () => {
  it('puts the nav and the children in the two columns, under the title', () => {
    renderShell();
    const [navColumn, contentColumn] = columns();
    // The control on every class assertion below: without this, a shell that rendered two
    // empty divs and dropped both slots would satisfy all of them.
    expect(navColumn).toContainElement(screen.getByRole('navigation', { name: 'section' }));
    expect(contentColumn).toContainElement(screen.getByText('canvas'));
    expect(screen.getByRole('main').children[0]).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Console' }),
    );
  });

  /**
   * The run's acceptance criterion, at the level jsdom can see it: the header container is
   * `AppShell`'s and nothing about the console reaches it. The measured half — the menu
   * trigger's `.right` matching `/`, `/book` and `/sign-in` at six viewports — is in this
   * task's report.
   */
  it('leaves the header exactly as AppShell renders it', () => {
    renderShell();
    const header = screen.getByRole('banner').firstElementChild as HTMLElement;
    expect(header).toHaveClass('max-w-[90rem]', 'px-4', 'sm:px-6', 'h-14');
    // The title is a page heading, not chrome. It moving into the controls row is what
    // used to drift the menu trigger's y between /manage and every other surface.
    expect(screen.getByRole('banner')).not.toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Console' }),
    );
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Console' }),
    );
  });

  it('matches the content column to the header container, so their edges agree', () => {
    renderShell();
    expect(screen.getByRole('main')).toHaveClass('max-w-[90rem]', 'px-4', 'sm:px-6');
  });

  /**
   * `min-w-0`, pinned by name.
   *
   * A flex item's automatic minimum size is its content, so `flex-1` alone will NOT let
   * this column narrow past the widest thing inside it — one 60-character member name and
   * the sidebar is pushed off the left edge. jsdom cannot lay out, so this is a class pin
   * and the report carries the browser measurement
   * (`documentElement.scrollWidth === clientWidth` at 1024 and 1440 with that name
   * seeded). Unlike a class that changes nothing, deleting this one changes what renders.
   */
  it('lets the canvas shrink and never the sidebar', () => {
    renderShell();
    const [navColumn, contentColumn] = columns();
    expect(contentColumn).toHaveClass('min-w-0', 'flex-1');
    expect(navColumn).toHaveClass('lg:shrink-0', 'lg:w-56');
  });

  /**
   * The canvas stops at 1024px on purpose. Past ~1000px a destructive control sits a
   * hand-span from the name it belongs to, which is a mis-click hazard on a 25-row roster.
   */
  it('caps the canvas rather than letting it run to the full console width', () => {
    renderShell();
    expect(columns()[1]).toHaveClass('lg:max-w-5xl');
  });

  it('stacks below lg and goes side by side at lg', () => {
    renderShell();
    expect(row()).toHaveClass('flex', 'flex-col', 'lg:flex-row', 'lg:gap-8');
  });
});
