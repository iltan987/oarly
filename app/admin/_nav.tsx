'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * `owns` names route subtrees a tab is responsible for that do not sit under its own
 * href. The clubs tab is `/admin` — the list — but the club DETAIL page it links every
 * row to lives at `/admin/clubs/[id]`, which is not under `/admin` by prefix in any
 * useful sense (`/admin` is a prefix of literally every route here).
 */
const items = [
  { href: '/admin', key: 'clubs', owns: ['/admin/clubs'] },
  { href: '/admin/requests', key: 'requests', owns: [] },
  { href: '/admin/users', key: 'users', owns: [] },
  { href: '/admin/audit', key: 'audit', owns: [] },
  { href: '/admin/clubs/new', key: 'newClub', owns: [] },
] as const;

/**
 * How long a prefix matches this pathname, or -1 for no match.
 *
 * `/admin` is exact-only: as a prefix it claims every route in the console. Everything
 * else matches itself and its descendants, which is the idiom
 * `app/s/[slug]/manage/_nav.tsx` already uses.
 */
function matchLength(pathname: string, prefix: string): number {
  if (prefix === '/admin') return pathname === '/admin' ? prefix.length : -1;
  return pathname === prefix || pathname.startsWith(`${prefix}/`) ? prefix.length : -1;
}

export function AdminNav() {
  const pathname = usePathname();
  const t = useTranslations('admin');

  // Longest match wins, so `/admin/clubs/new` lights up "New club" (its own href, 16
  // chars) rather than "Clubs" (which owns `/admin/clubs`, 12). Before this the match
  // was exact, so `/admin/clubs/<uuid>` — the page every row of the clubs list links
  // to — highlighted NO tab at all, on the console's densest list.
  const scores = items.map((it) => Math.max(...[it.href, ...it.owns].map((p) => matchLength(pathname, p))));
  const best = Math.max(...scores);

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b">
      {items.map((it, i) => {
        const active = best >= 0 && scores[i] === best;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`border-b-2 px-3 py-2 text-sm ${active ? 'border-brand font-medium text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t(it.key)}
          </Link>
        );
      })}
    </nav>
  );
}
