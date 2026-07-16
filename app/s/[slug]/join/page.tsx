import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { env } from '@/env';
import { getMembership } from '@/lib/membership';
import { getSession } from '@/lib/session';
import { requireClub } from '@/lib/tenant';
import { apexUrl, clubUrl, parseAppOrigin } from '@/lib/urls';

import { joinAction } from './actions';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await requireClub(slug);
  const t = await getTranslations('club');
  const tj = await getTranslations('join');
  const session = await getSession();

  if (!session) {
    const origin = parseAppOrigin(env.APP_URL);
    const back = `${clubUrl(slug, origin)}/join`;
    const signInHref = `${apexUrl('/sign-in', origin)}?redirect=${encodeURIComponent(back)}`;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="font-heading text-2xl font-bold text-brand">{t('joinTitle', { name: club.name })}</h1>
        <p className="text-muted-foreground">{t('joinBody')}</p>
        <a href={signInHref} className={buttonVariants({ className: 'w-full' })}>{tj('signInToJoin')}</a>
      </main>
    );
  }

  const membership = await getMembership(db, session.user.id, club.id);
  const statusMsg = membership
    ? { pending: tj('pending'), approved: tj('approved'), rejected: tj('rejected'), banned: tj('banned') }[membership.status]
    : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-heading text-2xl font-bold text-brand">{t('joinTitle', { name: club.name })}</h1>
      {membership ? (
        <p className="text-muted-foreground">{statusMsg}</p>
      ) : (
        <form action={joinAction.bind(null, slug)} className="w-full">
          <p className="mb-4 text-muted-foreground">{t('joinBody')}</p>
          <button type="submit" className={buttonVariants({ className: 'w-full' })}>{tj('requestToJoin')}</button>
        </form>
      )}
    </main>
  );
}
