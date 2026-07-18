'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

// Public tenant paths (slug is in the hostname — see proxy.ts). Never /s/{slug}/...
const tabs = [
  { key: 'book', href: '/book', labelKey: 'book' },
  { key: 'bookings', href: '/bookings', labelKey: 'myBookings' },
] as const;

export function MemberTabs() {
  const t = useTranslations('booking');
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b">
      {tabs.map((tab) => {
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
