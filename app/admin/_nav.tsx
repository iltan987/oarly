'use client';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ConsoleNav } from '@/components/console-nav';

/**
 * `owns` names route subtrees a tab is responsible for that do not sit under its own
 * href. The clubs tab is `/admin` — the list — but the club DETAIL page it links every
 * row to lives at `/admin/clubs/[id]`, which is not under `/admin` by prefix in any
 * useful sense (`/admin` is a prefix of literally every route here). `/admin` is also
 * `exact`-only for the same reason: as a prefix it claims every route in the console.
 *
 * "New club" used to be a fifth tab. It is a create ACTION wearing a nav tab — a nav
 * names places you can be, and `/admin/clubs/new` is something you do to the list you
 * are already looking at. It is now a button beside the search on `/admin`, and
 * `/admin/clubs/new` lights the clubs tab through the `owns` entry below, which is
 * where the operator actually is.
 */
type Item = { href: string; key: string; exact?: boolean; owns?: readonly string[] };

const items: readonly Item[] = [
  { href: '/admin', key: 'clubs', exact: true, owns: ['/admin/clubs'] },
  { href: '/admin/requests', key: 'requests' },
  { href: '/admin/users', key: 'users' },
  { href: '/admin/audit', key: 'audit' },
];

export function AdminNav(): ReactElement {
  const t = useTranslations('admin');
  return (
    <ConsoleNav
      items={items.map((it) => ({ href: it.href, exact: it.exact, owns: it.owns, label: t(it.key) }))}
    />
  );
}
