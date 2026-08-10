// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const pathname = vi.hoisted(() => ({ value: '/bookings' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }));
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

import { MemberTabs } from './member-tabs';

describe('MemberTabs', () => {
  /**
   * Negative-first: `/book` invites a member who taps it into a wall where every
   * session renders "Kilitli" (the same dead end `e99a19d` closed on `/bookings`' empty
   * state). This is the assertion that must fail if the tab is ever restored for a
   * restricted member — `queryByRole` rather than `getByRole`, so a re-added tab makes
   * the test fail rather than throw past the point of assertion.
   */
  it('does not offer a /book tab to a restricted member', () => {
    render(<MemberTabs restricted />);
    expect(screen.queryByRole('link', { name: 'booking.book' })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/book"]')).toBeNull();
  });

  // The other half: hiding the tab is not the same bug as deleting it outright.
  it('still offers the bookings tab to a restricted member', () => {
    render(<MemberTabs restricted />);
    expect(screen.getByRole('link', { name: 'booking.myBookings' })).toHaveAttribute('href', '/bookings');
  });

  it('offers both tabs to an unrestricted member', () => {
    render(<MemberTabs restricted={false} />);
    expect(screen.getByRole('link', { name: 'booking.book' })).toHaveAttribute('href', '/book');
    expect(screen.getByRole('link', { name: 'booking.myBookings' })).toHaveAttribute('href', '/bookings');
  });

  it('marks the current tab, among whichever tabs are visible', () => {
    pathname.value = '/bookings';
    render(<MemberTabs restricted />);
    expect(screen.getByRole('link', { name: 'booking.myBookings' })).toHaveAttribute('aria-current', 'page');
  });
});
