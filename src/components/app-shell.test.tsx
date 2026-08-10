// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppShell, type ShellWidth } from './app-shell';

/** The header's inner container — the element whose width and gutter must never vary. */
function headerContainer(): HTMLElement {
  return screen.getByRole('banner').firstElementChild as HTMLElement;
}

/** `[brand wrapper, menu wrapper]`, in DOM order. */
function headerSlots(): [HTMLElement, HTMLElement] {
  const [brand, menu] = Array.from(headerContainer().children) as HTMLElement[];
  return [brand, menu];
}

function renderShell(props: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return render(
    <AppShell
      width="md"
      brand={<span>brand</span>}
      menu={<button type="button">menu</button>}
      {...props}
    >
      <p>content</p>
    </AppShell>,
  );
}

describe('AppShell', () => {
  it('renders a banner, a main landmark and the children inside main', () => {
    renderShell();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(screen.getByText('content'));
    // The chrome is NOT inside the content column — that nesting is what would make the
    // header inherit the per-section max-width again.
    expect(screen.getByRole('main')).not.toContainElement(screen.getByRole('banner'));
  });

  it('keeps the full-height column that the footer and align="center" both depend on', () => {
    // jsdom cannot measure layout, but it can pin the two classes the layout rests on.
    // Without `min-h-dvh` on the root a short page's footer floats up under the content
    // instead of sitting at the bottom of the viewport; without `flex-1` on <main> the
    // root has no slack to distribute, so `align="center"` centres inside a
    // content-height box and centres nothing. Neither failure raises anything.
    const { container } = renderShell({ align: 'center' });
    expect(container.firstElementChild).toHaveClass('flex', 'min-h-dvh', 'flex-col');
    expect(screen.getByRole('main')).toHaveClass('flex-1');
  });

  /**
   * THE regression test for the reported defect: "when I press the manage club button ...
   * I expect theme button, language switch to remain in the same place." Before this
   * component, each surface hand-rolled its own shell and the header inherited that
   * surface's `max-w-*` and padding, so the controls moved on every section change.
   *
   * The `expect(mains).not.toBe` line is the control: without it, an implementation whose
   * WIDTH lookup returned nothing for every width would satisfy the header assertion
   * trivially and this test would pass while proving nothing.
   */
  it('gives every width the same header container, however different their content columns', () => {
    const widths: ShellWidth[] = ['sm', 'md', '2xl', '3xl', '4xl', '[90rem]'];
    const headers = new Set<string>();
    const mains = new Set<string>();
    for (const width of widths) {
      const { unmount } = renderShell({ width });
      headers.add(headerContainer().className);
      mains.add(screen.getByRole('main').className);
      unmount();
    }
    expect([...headers]).toHaveLength(1);
    expect([...mains]).toHaveLength(widths.length);
  });

  it('pins the header container to one width and one gutter', () => {
    // Named explicitly, because "all five are equal" is also satisfied by all five being
    // equally wrong. 90rem is >= the widest content column in the product; the gutter is
    // what actually matters below ~480px, where every max-w-* is inert.
    renderShell();
    expect(headerContainer()).toHaveClass('max-w-[90rem]', 'px-4', 'sm:px-6', 'h-14');
  });

  it.each([
    ['sm', 'max-w-sm'],
    ['md', 'max-w-md'],
    ['2xl', 'max-w-2xl'],
    ['3xl', 'max-w-3xl'],
    ['4xl', 'max-w-4xl'],
    // The console width, and the only one that equals the header's own container. It is
    // still the CONTENT column: the header is `max-w-[90rem]` because it always was, not
    // because a caller asked for that width.
    ['[90rem]', 'max-w-[90rem]'],
  ] as const)('maps width=%s onto the content column class %s', (width, expected) => {
    // Every entry of the WIDTH record, not just one: a single-case test cannot tell a
    // correct table from one where four rows point at the same class.
    renderShell({ width });
    expect(screen.getByRole('main')).toHaveClass(expected);
    // And the gutter is the header's, so the two columns' edges agree at every viewport.
    expect(screen.getByRole('main')).toHaveClass('px-4', 'sm:px-6');
  });

  /**
   * Asserted on the header's own direct children, NOT via
   * `container.querySelector('.shrink-0')`. That selector cannot fail: `shrink-0` is baked
   * into the `button` and `toggle-group` primitives, so it always matches something nested
   * regardless of whether the wrapper under test carries it.
   *
   * The deleted `app-controls.test.tsx` learned this the hard way — it shipped with that
   * exact selector at `cfcce15` and was corrected at `534ca1e` to assert on
   * `[role="group"]`'s `parentElement`, with a comment rejecting the querySelector form.
   * So the version deleted by this task was already right; the lesson is carried forward
   * here, not the mistake.
   */
  it('lets the brand compress and never the menu', () => {
    renderShell();
    const [brand, menu] = headerSlots();
    expect(brand).toHaveClass('min-w-0');
    expect(brand).not.toHaveClass('shrink-0');
    expect(menu).toHaveClass('shrink-0');
  });

  it('keeps the brand first and the menu last', () => {
    renderShell();
    const [brand, menu] = headerSlots();
    expect(brand).toHaveTextContent('brand');
    expect(menu).toHaveTextContent('menu');
  });

  it('centres the content column only when asked, and never the header', () => {
    const { unmount } = renderShell({ align: 'center' });
    expect(screen.getByRole('main')).toHaveClass('justify-center');
    const centredHeader = headerContainer().className;
    unmount();

    renderShell();
    expect(screen.getByRole('main')).not.toHaveClass('justify-center');
    // `align` must not reach the chrome either — it is the second thing that used to
    // differ between the entry surfaces and the console.
    expect(headerContainer().className).toBe(centredHeader);
  });

  it('renders the footer outside the content column, and nothing when there is none', () => {
    const { unmount } = renderShell({ footer: <footer>footer</footer> });
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('main')).not.toContainElement(screen.getByRole('contentinfo'));
    unmount();

    renderShell();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });
});
