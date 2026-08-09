import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AppWordmark } from '@/components/app-brand';
import { AppFooter, footerLabels } from '@/components/app-footer';
import { AppShell } from '@/components/app-shell';
import { StatusPill } from '@/components/booking-status-badge';
import { RestrictionNotice } from '@/components/restriction-notice';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { UserMenu } from '@/components/user-menu';
import { db } from '@/db';
import { clubs, memberships } from '@/db/schema';
import { env } from '@/env';
import { initials } from '@/lib/initials';
import { menuSession } from '@/lib/menu-session';
import { getRestrictions } from '@/lib/restriction';
import { getCurrentUser } from '@/lib/session';
import { clubUrl, parseAppOrigin } from '@/lib/urls';

export default async function Home() {
  const t = await getTranslations('common');
  const tHome = await getTranslations('home');
  const origin = parseAppOrigin(env.APP_URL);
  const footerCopy = await footerLabels();
  const user = await getCurrentUser();

  if (!user) {
    return (
      <AppShell
        width="md"
        align="center"
        brand={<AppWordmark name={t('appName')} />}
        menu={<UserMenu />}
        footer={<AppFooter labels={footerCopy} />}
      >
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
      </AppShell>
    );
  }

  const tClub = await getTranslations('club');

  const myClubs = await db
    .select({
      // The membership id is what `getRestrictions` keys its answer by, and the club's
      // timezone is what the notice formats the lift date in — it varies per row here,
      // which is precisely why the notice takes a `timeZone` rather than reading the
      // request's.
      id: memberships.id,
      slug: clubs.slug,
      name: clubs.name,
      logoUrl: clubs.logoUrl,
      timezone: clubs.timezone,
      role: memberships.role,
      status: memberships.status,
      bannedUntil: memberships.bannedUntil,
    })
    .from(memberships)
    .innerJoin(clubs, eq(clubs.id, memberships.clubId))
    .where(eq(memberships.userId, user.id))
    .orderBy(asc(clubs.name));

  // One instant for the whole list, not `Date.now()` per row: two clubs whose bans
  // straddle the same millisecond must not disagree about what time it is.
  const now = new Date();
  // ONE call for the whole list, never one per row. `getRestrictions` folds every
  // membership into a single `inArray` read — and issues no read at all in the common
  // case where none of them is restricted, which is the only reason this is affordable
  // on the page every signed-in member lands on.
  const restrictions = await getRestrictions(db, myClubs, now);

  return (
    <AppShell
      width="md"
      brand={<AppWordmark name={t('appName')} />}
      menu={<UserMenu session={menuSession(user)} />}
      footer={<AppFooter labels={footerCopy} />}
    >
      <p className="text-sm text-muted-foreground">{tHome('signedInAs', { email: user.email })}</p>

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">{tHome('myClubs')}</h2>

        {myClubs.length === 0 ? (
          /*
            This empty state is the ONLY inbound route to /request-club from a page — the
            route had zero of them before this — so it is a card with a real call to
            action, not the bare <p> it used to be. The hint matters as much as the CTA:
            most people who land here are not club owners, they are members whose club
            sent them a join link, and "request a club" is the wrong door for them.
          */
          <Card className="items-start gap-3 p-6">
            <h3 className="font-heading text-base font-bold">{tHome('noClubsTitle')}</h3>
            <p className="text-sm text-muted-foreground">{tHome('noClubsBody')}</p>
            <Link href="/request-club" className={buttonVariants({ size: 'sm' })}>
              {tHome('noClubsCta')}
            </Link>
            <p className="text-xs text-muted-foreground">{tHome('noClubsHint')}</p>
          </Card>
        ) : (
          <Card className="gap-0 divide-y divide-border py-0">
            {myClubs.map((row) => {
              const restriction = restrictions.get(row.id) ?? { state: 'none' as const };
              const isRestricted = restriction.state !== 'none';
              return (
                <div key={row.slug} className="flex items-center gap-3 p-4">
                  <Avatar>
                    {row.logoUrl ? <AvatarImage src={row.logoUrl} alt="" /> : null}
                    <AvatarFallback className="font-heading font-bold">{initials(row.name)}</AvatarFallback>
                  </Avatar>

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium">{row.name}</span>
                    {/*
                      The slot that used to be hard-`null`ed for a restricted member — the
                      reported bug in one line: "I see Suspended and I can't do anything …
                      there is literally no explanation at all."
                    */}
                    {isRestricted ? (
                      <RestrictionNotice restriction={restriction} timeZone={row.timezone} variant="inline" />
                    ) : row.status === 'pending' ? (
                      <span className="text-xs text-muted-foreground">{tClub('notePending')}</span>
                    ) : row.status === 'rejected' ? (
                      <span className="text-xs text-muted-foreground">{tClub('noteRejected')}</span>
                    ) : row.status === 'approved' && row.role === 'member' ? (
                      <span className="text-xs text-muted-foreground">{tClub('noteMember')}</span>
                    ) : null}
                  </div>

                  {/*
                    A restricted member gets a LINK where a dead red pill used to sit. The
                    club page is the surface that carries the phone number and the two
                    member destinations, so it is the right single door from here.
                  */}
                  {isRestricted ? (
                    <a
                      href={clubUrl(row.slug, origin)}
                      className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'shrink-0' })}
                    >
                      {tHome('ctaOpenClub')}
                    </a>
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
              );
            })}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
