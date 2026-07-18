'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

const items = [
  { href: '/admin', key: 'clubs' },
  { href: '/admin/requests', key: 'requests' },
  { href: '/admin/clubs/new', key: 'newClub' },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  const t = useTranslations('admin');
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b">
      {items.map((it) => {
        const active = it.href === '/admin' ? pathname === '/admin' : pathname === it.href;
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
