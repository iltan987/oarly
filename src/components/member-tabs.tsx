'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

// Public tenant paths (slug is in the hostname — see proxy.ts). Never /s/{slug}/...
const tabs = [
  { key: 'book', href: '/book', labelKey: 'book' },
  { key: 'bookings', href: '/bookings', labelKey: 'myBookings' },
] as const;

export function MemberTabs({ restricted }: {
  /**
   * REQUIRED, with no default — `restricted = false` would fail OPEN, and a caller that
   * forgets to thread it reproduces the exact bug this prop exists to fix: a member
   * whose pause is in force still sees a live-looking "book a session" tab. Same
   * reasoning as `BookingsList.restricted` (`e99a19d`).
   *
   * HIDDEN, not disabled, when true. A restricted member finds every session on `/book`
   * rendering "Kilitli" — this is the same dead end Task 6 closed and Task 8 reopened on
   * `/bookings`' empty state (`e99a19d`: "no invitation, no button"). A nav tab is still
   * an invitation to tap through to a wall, so it is removed rather than greyed out. The
   * page it points to already handles a restricted member who reaches it anyway (a
   * bookmark, browser history, a typed URL): `requireMemberView` still admits them, and
   * `/book` renders the restriction notice above a calendar where every session is
   * locked — see `book/page.tsx` and `book-calendar.tsx`.
   */
  restricted: boolean;
}) {
  const t = useTranslations('booking');
  const pathname = usePathname();
  const visibleTabs = restricted ? tabs.filter((tab) => tab.key !== 'book') : tabs;
  return (
    <nav className="flex flex-wrap gap-1 border-b">
      {visibleTabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={`border-b-2 px-3 py-2 text-sm ${
              isActive
                ? 'border-brand font-medium text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
