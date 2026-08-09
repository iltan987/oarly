import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { ClubBrand } from '@/components/app-brand';
import { AppShell } from '@/components/app-shell';
import { UserMenu } from '@/components/user-menu';
import { requireOwner } from '@/lib/membership';
import { menuSession } from '@/lib/menu-session';

import { ManageNav } from './_nav';

export default async function ManageLayout({
  children, params,
}: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club, user } = await requireOwner(slug);
  const t = await getTranslations('manage');
  return (
    // A tenant host: the account link and sign-out inside UserMenu are apex-only routes,
    // so `menuSession` hands it absolute URLs. That replaces the hand-rolled absolute
    // <a href={apexUrl('/', origin)}> that used to sit in this row next to the controls
    // and was the thing shoving them out of alignment with every other surface.
    <AppShell
      width="3xl"
      brand={<ClubBrand name={club.name} logoUrl={club.logoUrl} href="/manage" />}
      menu={<UserMenu session={menuSession(user, { tenant: true })} />}
    >
      {/*
        Stays an <h1> and stays in the content column: it is the manage section's page
        title, not part of the chrome. Putting it back in the controls row is what made
        the avatar's y drift between /manage and every other surface.
      */}
      <h1 className="font-heading text-2xl font-bold text-brand">{t('title')}</h1>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href="/" className="text-muted-foreground hover:text-foreground hover:underline">
          {t('viewPublicPage')}
        </Link>
        <Link href="/book" className="text-muted-foreground hover:text-foreground hover:underline">
          {t('viewAsMember')}
        </Link>
      </div>
      <ManageNav />
      {children}
    </AppShell>
  );
}
