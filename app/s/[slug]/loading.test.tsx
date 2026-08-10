// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AdminLoading from '../../admin/loading';
import Loading from './loading';

/**
 * The tenant fallback is the ONE fallback in this app that must draw the page chrome, and
 * that is the only interesting thing about it — so it is what these tests pin.
 *
 * `app/admin/loading.test.tsx` asserts the opposite for the console fallbacks: no nav, no
 * links, because `/admin` and `/manage` render their header and nav in a `layout.tsx`
 * above the Suspense boundary and drawing them twice would make the sidebar flicker.
 * `app/s/[slug]/layout.tsx` renders only `ClubTheme`, a `<div>` carrying the accent — so
 * here the header and footer belong to the page, and a content-only fallback would pop a
 * whole header and footer in around the card when the page resolved.
 *
 * The admin fallback is rendered alongside as the control. Without it, "renders a header"
 * reads as a generic good-practice assertion rather than what it is: a deliberate
 * divergence from the rule every other fallback in the repo follows.
 */
describe('the tenant fallback', () => {
  it('draws the page chrome, because the tenant layout renders none', () => {
    const { container } = render(<Loading />);
    expect(container.querySelector('header')).not.toBeNull();
    expect(container.querySelector('footer')).not.toBeNull();
  });

  it('is alone in doing so — the admin fallback draws neither', () => {
    const { container } = render(<AdminLoading />);
    expect(container.querySelector('header')).toBeNull();
    expect(container.querySelector('footer')).toBeNull();
  });

  it('mirrors the landing card underneath the chrome', () => {
    const { container } = render(<Loading />);
    const card = container.querySelector('[data-slot="card"]');
    expect(card).not.toBeNull();
    // Avatar, name, tagline and two CTAs: enough silhouette that the card does not
    // change height when the real content arrives.
    expect((card as HTMLElement).querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(5);
  });

  /**
   * No links, and no club name or logo. Resolving the club is precisely the lookup this
   * fallback is waiting on, so anything it rendered from club data would be invented.
   */
  it('renders nothing it does not yet know', () => {
    const { container } = render(<Loading />);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});
