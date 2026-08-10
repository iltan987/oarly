// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ManageLoading from '../s/[slug]/manage/loading';
import Loading from './loading';

/** Every skeleton block in the fallback, in DOM order. */
function skeletons(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-slot="skeleton"]'));
}

describe('the admin console fallback', () => {
  /**
   * Deliverable F, which had no test at all until review pointed that out: deleting the
   * search row left the suite green.
   *
   * `loading.tsx` replaces the WHOLE segment, and the search form lives in
   * `app/admin/page.tsx` — so with no row here, every search submit made the box the
   * operator had just typed into vanish and reappear. Asserted structurally (a row of
   * blocks BEFORE the list, sharing the form's own layout classes) because a skeleton has
   * no roles and no text to query by.
   */
  it('mirrors the search row, which the segment fallback would otherwise blank', () => {
    const { container } = render(<Loading />);
    const row = container.querySelector('.mb-6');
    expect(row).not.toBeNull();
    // Three controls, matching page.tsx: the input, its submit, and the create link.
    expect(skeletons(row as HTMLElement)).toHaveLength(3);
    // And it comes first — a search row rendered under the list is not a mirror of the
    // page, it is a second thing moving.
    expect(skeletons(container).slice(0, 3)).toEqual(skeletons(row as HTMLElement));
  });

  it('still mirrors the list underneath it', () => {
    const { container } = render(<Loading />);
    // The control on the assertion above: without this, a fallback that dropped the list
    // entirely and kept only the search row would satisfy it.
    expect(skeletons(container).length).toBeGreaterThan(3);
  });

  /**
   * The contract both fallbacks are written to, asserted rather than left in a comment:
   * the console title and the section nav are rendered by `layout.tsx`, ABOVE this
   * Suspense boundary, so they persist across a navigation. A fallback that redrew them
   * would make the sidebar flicker on every tab switch — and after Task 9 the nav is a
   * permanent sidebar at `lg:`, where a flicker is far more visible than it was under a
   * tab strip.
   */
  it.each([
    ['admin', <Loading key="a" />],
    ['manage', <ManageLoading key="m" />],
  ])('draws no nav in the %s fallback, because the layout keeps it', (_name, element) => {
    const { container } = render(element);
    expect(container.querySelector('nav')).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});
