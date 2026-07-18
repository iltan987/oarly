import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { StatusPill } from '@/components/booking-status-badge';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { db } from '@/db';
import { clubs, memberships } from '@/db/schema';
import { env } from '@/env';
import { getCurrentUser } from '@/lib/session';
import { apexUrl, clubUrl, parseAppOrigin } from '@/lib/urls';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function computeIsBanned(row: { status: string; bannedUntil: Date | null }): boolean {
  const bannedActive = row.bannedUntil != null && row.bannedUntil.getTime() > Date.now();
  return row.status === 'banned' || bannedActive;
}

export default async function Home() {
  const t = await getTranslations('common');
  const tHome = await getTranslations('home');
  const origin = parseAppOrigin(env.APP_URL);
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-10 p-8">
        <div className="flex w-full items-center justify-between">
          <span className="font-heading text-2xl font-bold text-brand">{t('appName')}</span>
          <ThemeToggle />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-bold text-balance">{tHome('heroTitle')}</h1>
          <p className="text-muted-foreground">{tHome('heroSubtitle')}</p>
        </div>

        <div className="flex flex-col gap-2">
          <Link href="/sign-in" className={buttonVariants({ className: 'w-full' })}>{t('signIn')}</Link>
          <Link href="/sign-up" className={buttonVariants({ variant: 'ghost', className: 'w-full' })}>
            {tHome('createAccount')}
          </Link>
        </div>
      </main>
    );
  }

  const tClub = await getTranslations('club');

  const myClubs = await db
    .select({
      slug: clubs.slug,
      name: clubs.name,
      logoUrl: clubs.logoUrl,
      role: memberships.role,
      status: memberships.status,
      bannedUntil: memberships.bannedUntil,
    })
    .from(memberships)
    .innerJoin(clubs, eq(clubs.id, memberships.clubId))
    .where(eq(memberships.userId, user.id))
    .orderBy(asc(clubs.name));

  const rows = myClubs.map((row) => ({ ...row, isBanned: computeIsBanned(row) }));

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-8">
      <div className="flex w-full items-center justify-between">
        <span className="font-heading text-2xl font-bold text-brand">{t('appName')}</span>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <SignOutButton redirectTo={apexUrl('/sign-in?signedout=1', origin)} />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{tHome('signedInAs', { email: user.email })}</p>

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">{tHome('myClubs')}</h2>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tHome('noClubs')}</p>
        ) : (
          <Card className="gap-0 divide-y divide-border py-0">
            {rows.map((row) => (
              <div key={row.slug} className="flex items-center gap-3 p-4">
                <Avatar>
                  {row.logoUrl ? <AvatarImage src={row.logoUrl} alt="" /> : null}
                  <AvatarFallback className="font-heading font-bold">{initials(row.name)}</AvatarFallback>
                </Avatar>

                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="font-medium">{row.name}</span>
                  {row.isBanned ? null : row.status === 'pending' ? (
                    <span className="text-xs text-muted-foreground">{tClub('notePending')}</span>
                  ) : row.status === 'rejected' ? (
                    <span className="text-xs text-muted-foreground">{tClub('noteRejected')}</span>
                  ) : row.status === 'approved' && row.role === 'member' ? (
                    <span className="text-xs text-muted-foreground">{tClub('noteMember')}</span>
                  ) : null}
                </div>

                {row.isBanned ? (
                  <StatusPill tone="bad">{tHome('statusSuspended')}</StatusPill>
                ) : row.status === 'pending' ? (
                  <StatusPill tone="warn">{tHome('statusPending')}</StatusPill>
                ) : row.status === 'rejected' ? (
                  <StatusPill tone="neutral">{tHome('statusRejected')}</StatusPill>
                ) : row.status === 'approved' && row.role === 'owner' ? (
                  <a
                    href={`${clubUrl(row.slug, origin)}/manage`}
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  >
                    {tClub('ctaManage')}
                  </a>
                ) : row.status === 'approved' && row.role === 'member' ? (
                  <a
                    href={`${clubUrl(row.slug, origin)}/book`}
                    className={buttonVariants({ size: 'sm' })}
                  >
                    {tClub('ctaGoBooking')}
                  </a>
                ) : null}
              </div>
            ))}
          </Card>
        )}
      </div>
    </main>
  );
}
