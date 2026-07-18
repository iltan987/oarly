import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { StatusPill } from '@/components/booking-status-badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { db } from '@/db';
import { env } from '@/env';
import { getMembership } from '@/lib/membership';
import { buildClubMetadata } from '@/lib/seo';
import { getCurrentUser } from '@/lib/session';
import { requireClub } from '@/lib/tenant';
import { parseAppOrigin } from '@/lib/urls';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function computeIsBanned(membership: { status: string; bannedUntil: Date | null } | null): boolean {
  const bannedActive = membership?.bannedUntil != null && membership.bannedUntil.getTime() > Date.now();
  return membership?.status === 'banned' || bannedActive;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const club = await requireClub(slug);
  const t = await getTranslations('club');
  return buildClubMetadata({
    club,
    description: club.description ?? club.tagline ?? t('metaDescription', { name: club.name }),
    origin: parseAppOrigin(env.APP_URL),
  });
}

export default async function ClubPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const club = await requireClub(slug);
  const t = await getTranslations('club');

  const user = await getCurrentUser();
  const membership = user ? await getMembership(db, user.id, club.id) : null;
  const isBanned = computeIsBanned(membership);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-8">
      <Card className="w-full items-center gap-6 p-8 text-center">
        <Avatar className="size-16 rounded-card after:rounded-card">
          {club.logoUrl ? <AvatarImage src={club.logoUrl} alt="" className="rounded-card" /> : null}
          <AvatarFallback className="rounded-card bg-brand font-heading text-xl font-bold text-primary-foreground">
            {initials(club.name)}
          </AvatarFallback>
        </Avatar>

        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-bold text-brand">{club.name}</h1>
          {club.tagline ? <p className="text-muted-foreground">{club.tagline}</p> : null}
        </div>

        {club.description ? (
          <p className="text-sm text-muted-foreground">{club.description}</p>
        ) : !membership ? (
          <p className="text-sm text-muted-foreground">{t('joinBody')}</p>
        ) : null}

        {club.phone ? <p className="text-sm text-muted-foreground">{club.phone}</p> : null}

        <div className="flex w-full flex-col items-center gap-2">
          {membership?.role === 'owner' && membership.status === 'approved' ? (
            <>
              <Link href="/manage" className={buttonVariants({ className: 'w-full' })}>
                {t('ctaManage')}
              </Link>
              <Link href="/book" className={buttonVariants({ variant: 'ghost', className: 'w-full' })}>
                {t('ctaGoBooking')}
              </Link>
            </>
          ) : isBanned ? (
            <>
              <StatusPill tone="bad">{t('statusBanned')}</StatusPill>
              <p className="text-sm text-muted-foreground">{t('noteBanned')}</p>
            </>
          ) : membership?.status === 'pending' ? (
            <>
              <StatusPill tone="warn">{t('statusPending')}</StatusPill>
              <p className="text-sm text-muted-foreground">{t('notePending')}</p>
            </>
          ) : membership?.status === 'rejected' ? (
            <>
              <p className="text-sm text-muted-foreground">{t('noteRejected')}</p>
              <Link href="/join" className={buttonVariants({ className: 'w-full' })}>
                {t('ctaRequestJoin')}
              </Link>
            </>
          ) : membership?.status === 'approved' ? (
            <>
              <Link href="/book" className={buttonVariants({ className: 'w-full' })}>
                {t('ctaGoBooking')}
              </Link>
              <p className="text-sm text-muted-foreground">{t('noteMember')}</p>
            </>
          ) : (
            <Link href="/join" className={buttonVariants({ className: 'w-full' })}>
              {t('ctaRequestJoin')}
            </Link>
          )}
        </div>
      </Card>
    </main>
  );
}
