'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

const items = [
  { href: '', key: 'overviewNav' },
  { href: '/profile', key: 'profile' },
  { href: '/skill-levels', key: 'skillLevels' },
  { href: '/boats', key: 'boats' },
  { href: '/members', key: 'members' },
] as const;

export function ManageNav() {
  const pathname = usePathname();
  const t = useTranslations('manage');
  // The tenant subdomain is served via a proxy rewrite (see proxy.ts / tenant-routing.ts):
  // a request to `demo.<root>/manage/...` is rewritten server-side to the internal
  // `/s/demo/manage/...` route tree. NextResponse.rewrite() preserves the URL shown in
  // the browser (confirmed via Next.js docs: "browser shows /about" even though the
  // internal request is rewritten to `/proxy`), so both `usePathname()` and any `<Link>`
  // navigated from this page must use the public path `/manage/...` — the slug is already
  // encoded in the hostname, not the path. Using the internal `/s/{slug}/manage/...` form
  // here would double-prefix on the next client-side navigation (the proxy rewrites again),
  // 404-ing.
  const base = '/manage';
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b">
      {items.map((it) => {
        const href = `${base}${it.href}`;
        const active = pathname === href;
        const label = it.key === 'overviewNav' ? t('overviewNav')
          : it.key === 'members' ? t('members')
          : t(`${it.key}.navLabel`);
        return (
          <Link key={it.href || 'overview'} href={href}
            className={`border-b-2 px-3 py-2 text-sm ${active ? 'border-brand font-medium text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
