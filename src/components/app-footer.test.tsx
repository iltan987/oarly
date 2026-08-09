// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Key-echo translations, per this repo's component-test convention — except that values
// are echoed too, because WHAT is interpolated into `copyright` is the thing this file
// has to be able to see. Copy itself is covered by src/i18n/messages-parity.test.ts.
vi.mock('next-intl/server', () => ({
  getTranslations: () =>
    Promise.resolve((key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key),
}));
vi.mock('@/env', () => ({ env: { APP_URL: 'https://oarly.test' } }));

import { AppFooter, type FooterLabels, footerLabels } from './app-footer';

const LABELS: FooterLabels = {
  copyright: 'copyright',
  privacy: 'privacy',
  requestClub: 'requestClub',
};

/** `href` of the footer link whose label is `label`. */
function hrefOf(label: string): string | null {
  return screen.getByRole('link', { name: label }).getAttribute('href');
}

describe('AppFooter', () => {
  it('links to the apex routes relatively on the apex host', () => {
    render(<AppFooter labels={LABELS} />);
    expect(hrefOf('privacy')).toBe('/privacy');
    expect(hrefOf('requestClub')).toBe('/request-club');
  });

  it('links to the apex routes absolutely on a tenant host', () => {
    // A <Link href="/privacy"> on a club subdomain stays on the tenant host and 404s:
    // /privacy and /request-club exist only on the apex.
    render(<AppFooter tenant labels={LABELS} />);
    expect(hrefOf('privacy')).toBe('https://oarly.test/privacy');
    expect(hrefOf('requestClub')).toBe('https://oarly.test/request-club');
  });

  it('carries both apex routes in both modes', () => {
    // /request-club had zero inbound links from any page before this footer, and
    // /privacy was reachable only from the sign-up consent line. Losing either one
    // silently restores a dead route, which nothing else in the suite would notice.
    for (const tenant of [false, true]) {
      const { unmount } = render(<AppFooter tenant={tenant} labels={LABELS} />);
      expect(screen.getAllByRole('link')).toHaveLength(2);
      unmount();
    }
  });

  it('shares the header container: same max-width, same gutter', () => {
    // A brief requirement, not decoration — the footer's outer edges must line up with
    // AppShell's header at every viewport, and jsdom cannot measure that. It CAN pin the
    // classes the alignment rests on, which is the difference between this being checked
    // and it drifting silently the next time someone restyles the footer.
    render(<AppFooter labels={LABELS} />);
    const container = screen.getByRole('contentinfo').firstElementChild;
    expect(container).toHaveClass('mx-auto', 'w-full', 'max-w-[90rem]', 'px-4', 'sm:px-6');
  });

  it('does not blank an async layout that mounts it as a prop', async () => {
    // A reproduction of the trap documented in app-brand.tsx, not a proxy for it: an
    // async component anywhere in the tree that `render(await Layout({...}))` returns
    // makes @testing-library produce an empty container with NO error and NO warning.
    // AppFooter is mounted exactly this way on ten surfaces, so if it ever goes async
    // again, every future test of those pages passes against empty DOM. Make AppFooter
    // `async` and this line fails; nothing else in the suite would.
    async function LayoutLike() {
      return <div><AppFooter labels={LABELS} /></div>;
    }
    const { container } = render(await LayoutLike());
    expect(container.querySelector('footer')).not.toBeNull();
  });
});

describe('footerLabels', () => {
  it('interpolates the year as a string, not a number', async () => {
    // A numeric ICU argument goes through Intl.NumberFormat, and Turkish groups
    // thousands with a dot: the footer would read "© 2.026 Oarly" for every real user,
    // since Turkish is the default locale. The mocked translator echoes its values, so
    // the quotes here are the assertion.
    const year = String(new Date().getFullYear());
    expect((await footerLabels()).copyright).toBe(`copyright:{"year":"${year}"}`);
  });

  it('resolves all three labels the footer needs', async () => {
    expect(await footerLabels()).toMatchObject({ privacy: 'privacy', requestClub: 'requestClub' });
  });
});
