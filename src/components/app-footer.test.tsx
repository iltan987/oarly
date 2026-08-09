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

import { AppFooter } from './app-footer';

/** `href` of the footer link whose (echoed) label is `key`. */
function hrefOf(key: string): string | null {
  return screen.getByRole('link', { name: key }).getAttribute('href');
}

describe('AppFooter', () => {
  it('links to the apex routes relatively on the apex host', async () => {
    render(await AppFooter({}));
    expect(hrefOf('privacy')).toBe('/privacy');
    expect(hrefOf('requestClub')).toBe('/request-club');
  });

  it('links to the apex routes absolutely on a tenant host', async () => {
    // A <Link href="/privacy"> on a club subdomain stays on the tenant host and 404s:
    // /privacy and /request-club exist only on the apex.
    render(await AppFooter({ tenant: true }));
    expect(hrefOf('privacy')).toBe('https://oarly.test/privacy');
    expect(hrefOf('requestClub')).toBe('https://oarly.test/request-club');
  });

  it('carries both apex routes in both modes', async () => {
    // /request-club had zero inbound links from any page before this footer, and
    // /privacy was reachable only from the sign-up consent line. Losing either one
    // silently restores a dead route, which nothing else in the suite would notice.
    for (const props of [{}, { tenant: true }]) {
      const { unmount } = render(await AppFooter(props));
      expect(screen.getAllByRole('link')).toHaveLength(2);
      unmount();
    }
  });

  it('interpolates the year as a string, not a number', async () => {
    // A numeric ICU argument goes through Intl.NumberFormat, and Turkish groups
    // thousands with a dot: the footer would read "© 2.026 Oarly" for every real user,
    // since Turkish is the default locale. The mocked translator echoes its values, so
    // the quotes here are the assertion.
    render(await AppFooter({}));
    const year = String(new Date().getFullYear());
    expect(screen.getByText(`copyright:{"year":"${year}"}`)).toBeInTheDocument();
  });
});
