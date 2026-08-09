'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { activeNavIndex } from '@/lib/nav-match';

/**
 * `owns` names route subtrees a tab is responsible for that do not sit under its own
 * href. The clubs tab is `/admin` — the list — but the club DETAIL page it links every
 * row to lives at `/admin/clubs/[id]`, which is not under `/admin` by prefix in any
 * useful sense (`/admin` is a prefix of literally every route here). `/admin` is also
 * `exact`-only for the same reason: as a prefix it claims every route in the console.
 */
const items = [
  { href: '/admin', key: 'clubs', exact: true, owns: ['/admin/clubs'] },
  { href: '/admin/requests', key: 'requests' },
  { href: '/admin/users', key: 'users' },
  { href: '/admin/audit', key: 'audit' },
  { href: '/admin/clubs/new', key: 'newClub' },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  const t = useTranslations('admin');

  // Longest match wins, so `/admin/clubs/new` lights up "New club" (its own href, 16
  // chars) rather than "Clubs" (which owns `/admin/clubs`, 12). Before this the match
  // was exact, so `/admin/clubs/<uuid>` — the page every row of the clubs list links
  // to — highlighted NO tab at all, on the console's densest list.
  const activeIndex = activeNavIndex(pathname, items);

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b">
      {items.map((it, i) => {
        const isActive = activeIndex === i;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={isActive ? 'page' : undefined}
            className={`border-b-2 px-3 py-2 text-sm ${isActive ? 'border-brand font-medium text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t(it.key)}
          </Link>
        );
      })}
    </nav>
  );
}
