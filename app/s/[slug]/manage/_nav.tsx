'use client';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ConsoleNav } from '@/components/console-nav';

// The tenant subdomain is served via a proxy rewrite (see proxy.ts / tenant-routing.ts):
// a request to `demo.<root>/manage/...` is rewritten server-side to the internal
// `/s/demo/manage/...` route tree. NextResponse.rewrite() preserves the URL shown in
// the browser, so both `usePathname()` and any `<Link>` navigated from this page must
// use the public `/manage/...` form — the slug is already encoded in the hostname, not
// the path. Using the internal `/s/{slug}/manage/...` form here would double-prefix on
// the next client-side navigation (the proxy rewrites again), 404-ing.
const BASE = '/manage';

/**
 * Four destinations, not eight. The five setup pages moved behind `/manage/settings`,
 * which `owns` them: **no URL changed**, so nothing that links to `/manage/boats` — the
 * first-run checklist, the schedule page's preview link, a bookmark — rots.
 *
 * `exact` on Overview for the same reason `/admin` needs it: its href is a prefix of
 * every route in the console, so as a prefix rule it would claim all of them.
 *
 * `/manage/schedule/preview` needs no entry of its own: it is under `/schedule` by
 * prefix, so Settings' `owns` covers it.
 */
type Item = { href: string; labelKey: string; exact?: boolean; owns?: readonly string[] };

const items: readonly Item[] = [
  { href: '', labelKey: 'overviewNav', exact: true },
  { href: '/bookings', labelKey: 'bookings.navLabel' },
  { href: '/members', labelKey: 'members' },
  {
    href: '/settings',
    labelKey: 'settings.navLabel',
    owns: ['/profile', '/skill-levels', '/boats', '/schedule', '/policies'],
  },
];

export function ManageNav(): ReactElement {
  const t = useTranslations('manage');
  return (
    <ConsoleNav
      items={items.map((it) => ({
        href: `${BASE}${it.href}`,
        exact: it.exact,
        owns: it.owns?.map((sub) => `${BASE}${sub}`),
        label: t(it.labelKey),
      }))}
    />
  );
}
