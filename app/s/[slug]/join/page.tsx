import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { env } from '@/env';
import { getMembership } from '@/lib/membership';
import { getSession } from '@/lib/session';
import { requireClub } from '@/lib/tenant';
import { apexUrl, clubUrl, parseAppOrigin } from '@/lib/urls';

import { joinAction } from './actions';
import { JoinForm } from './join-form';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
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
  if (membership?.status === 'approved') redirect('/book');
  const statusMsg = membership
    ? { pending: tj('pending'), approved: tj('approved'), rejected: tj('rejected'), banned: tj('banned') }[membership.status]
    : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-heading text-2xl font-bold text-brand">{t('joinTitle', { name: club.name })}</h1>
      {error === 'rate_limited' && <p className="text-sm text-destructive">{tj('rateLimited')}</p>}
      {membership ? (
        <p className="text-muted-foreground">{statusMsg}</p>
      ) : (
        <JoinForm action={joinAction.bind(null, slug)} body={t('joinBody')} cta={tj('requestToJoin')} />
      )}
    </main>
  );
}
