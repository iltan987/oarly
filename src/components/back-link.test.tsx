// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BackLink } from './back-link';

describe('BackLink', () => {
  it('is one link, to one place, named by that place', () => {
    render(<BackLink href="/manage/settings" label="Ayarlar" />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/manage/settings');
    expect(links[0]).toHaveAccessibleName('Ayarlar');
  });

  /**
   * The distinction this component exists to hold: a breadcrumb asserts a URL hierarchy,
   * and the manage console does not have one — `/manage/profile` is deliberately not under
   * `/manage/settings`, which is what let the nav shrink to four items without changing a
   * single URL. A trail of ancestor links above `/manage/profile` would be a lie in the
   * chrome, so there is exactly one link here and it names a destination, not a path.
   */
  it('never renders a trail', () => {
    const { container } = render(<BackLink href="/manage/schedule" label="Program" />);
    expect(container.querySelectorAll('a')).toHaveLength(1);
    // And the arrow is decoration: it must not land in the accessible name.
    expect(screen.getByRole('link')).toHaveAccessibleName('Program');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden');
  });
});
