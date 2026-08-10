// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AdminLoading from '../../admin/loading';
import Loading from './loading';

/**
 * This fallback serves EVERY tenant surface — it paints before `manage/`'s and
 * `(member)/`'s own fallbacks on a cold load, because those sit below it. So the property
 * worth pinning is not what it draws but what it refuses to draw: anything that differs
 * between the three surfaces.
 *
 * `app/admin/loading.test.tsx` asserts the opposite for the console fallbacks: no nav, no
 * links, because `/admin` and `/manage` render their chrome in a `layout.tsx` above the
 * Suspense boundary. Here `app/s/[slug]/layout.tsx` renders only `ClubTheme`, a `<div>`
 * carrying the accent, so the header is the page's — and the header is the ONLY thing all
 * three tenant surfaces share.
 *
 * Note what these tests structurally cannot see: rendered in isolation, jsdom cannot lay
 * out and knows nothing about which segment mounts this. The first version of this file
 * drew a landing-card silhouette and a footer, passed its own tests, and still flashed the
 * wrong shape on `/manage`. That was caught by timing a cold load in a browser, not here.
 */
describe('the tenant fallback', () => {
  it('draws the page chrome, because the tenant layout renders none', () => {
    const { container } = render(<Loading />);
    expect(container.querySelector('header')).not.toBeNull();
  });

  it('is alone in doing so — the admin fallback draws none', () => {
    const { container } = render(<AdminLoading />);
    expect(container.querySelector('header')).toBeNull();
  });

  /**
   * No footer. `manage/layout.tsx` and `(member)/layout.tsx` pass none, so drawing one
   * here paints a page region that never arrives on two of the three surfaces it covers.
   */
  it('draws no footer, which two of its three surfaces never have', () => {
    const { container } = render(<Loading />);
    expect(container.querySelector('footer')).toBeNull();
  });

  /**
   * No content silhouette either. The content column is `max-w-md` on the landing page,
   * `max-w-2xl` for a member and `max-w-[90rem]` in the console — any shape drawn here is
   * wrong on two of them and visibly corrects itself when the real page lands.
   */
  it('draws no content silhouette, whose width it cannot know', () => {
    const { container } = render(<Loading />);
    const main = container.querySelector('main');
    expect(main).not.toBeNull();
    expect((main as HTMLElement).querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });

  /** Nothing it does not yet know: resolving the club is the lookup being waited on. */
  it('renders no club name, logo or link', () => {
    const { container } = render(<Loading />);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    // The header skeletons are still there — the control on the assertion above, so a
    // fallback that rendered literally nothing could not pass this file.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
