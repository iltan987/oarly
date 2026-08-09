import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AppControls } from '@/components/app-controls';
import { env } from '@/env';
import { requireOwner } from '@/lib/membership';
import { apexUrl, parseAppOrigin } from '@/lib/urls';

import { ManageNav } from './_nav';

export default async function ManageLayout({
  children, params,
}: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user } = await requireOwner(slug);
  const t = await getTranslations('manage');
  const origin = parseAppOrigin(env.APP_URL);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-bold text-brand">{t('title')}</h1>
        <AppControls signOutUrl={apexUrl('/sign-in?signedout=1', origin)}>
          {/*
            Absolute apex link (not <Link>): the owner is on the club subdomain, so
            a relative href would stay on the tenant host. The apex home is where
            the account identity and the user's other clubs live.
          */}
          <a
            href={apexUrl('/', origin)}
            className="min-w-0 max-w-40 truncate rounded-field px-2 py-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
            title={user.email}
          >
            {user.name || user.email}
          </a>
        </AppControls>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/" className="text-muted-foreground hover:text-foreground hover:underline">
          {t('viewPublicPage')}
        </Link>
        <Link href="/book" className="text-muted-foreground hover:text-foreground hover:underline">
          {t('viewAsMember')}
        </Link>
      </div>
      <ManageNav />
      {children}
    </div>
  );
}
