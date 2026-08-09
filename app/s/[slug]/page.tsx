import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { ClubBrand } from '@/components/app-brand';
import { AppFooter, footerLabels } from '@/components/app-footer';
import { AppShell } from '@/components/app-shell';
import { StatusPill } from '@/components/booking-status-badge';
import { RestrictionNotice } from '@/components/restriction-notice';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { UserMenu } from '@/components/user-menu';
import { db } from '@/db';
import { env } from '@/env';
import { type ViewerKind, viewerKindOf } from '@/lib/club-cta';
import { initials } from '@/lib/initials';
import { getMembership } from '@/lib/membership';
import { menuSession } from '@/lib/menu-session';
import { getRestriction } from '@/lib/restriction';
import { buildClubMetadata } from '@/lib/seo';
import { getCurrentUser } from '@/lib/session';
import { requireClub } from '@/lib/tenant';
import { parseAppOrigin } from '@/lib/urls';

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
  // Free for the unrestricted member: `getRestrictions` short-circuits before it builds
  // a statement unless the row it was handed is actually restricted.
  const restriction = membership ? await getRestriction(db, membership) : { state: 'none' as const };
  const kind = viewerKindOf({ membership, restriction: restriction.state });

  const primary = buttonVariants({ className: 'w-full' });
  const ghost = buttonVariants({ variant: 'ghost', className: 'w-full' });

  /**
   * Whether `requireOwner` would let this viewer into the console — the same conjunction,
   * evaluated here so the page cannot offer a door that 404s (or hide one that works).
   *
   * A booking penalty and an admin console are DIFFERENT CONCERNS, and this is the line
   * where that distinction is made. `viewerKindOf` puts `restricted` above `owner`, which
   * is right for the notice: a restricted owner must be told they are restricted. It
   * would be wrong for the Manage link, because a timed pause leaves `status: 'approved'`
   * (`recomputeBan` only writes `'banned'` for a permanent row), so `requireOwner` still
   * admits them and the console still works — it would simply have become unreachable.
   * This page carries the only entry-point link to `/manage` outside the manage area, so
   * "unreachable from here" means unreachable, for as long as the pause lasts.
   *
   * A SUSPENDED owner is `status: 'banned'`, fails this conjunction, and correctly gets
   * no link — `requireOwner` would 404 them.
   */
  const canManage = membership?.role === 'owner' && membership.status === 'approved';

  /**
   * One row per viewer kind, replacing six nested ternaries that could disagree with
   * `/book`'s and `/bookings`' own gates. Every branch is now named by the same function
   * those gates share, and every branch except `pending` has a destination — which was
   * the reported bug: a restricted member saw one red word and had nowhere to click.
   *
   * `pending` is the one honest dead end. There is no destination: `requireMemberView`
   * admits `approved` and `banned` only, so `/book` and `/bookings` would 404 a pending
   * applicant. A link that 404s is worse than no link.
   *
   * "My bookings" is PRIMARY for a restricted member and secondary for an approved one,
   * on purpose. A restricted member's most useful destination is the record of what they
   * had — including the seats the penalty cancelled — not a calendar on which every
   * session reads "ineligible".
   */
  const ctas: Record<ViewerKind, ReactNode> = {
    anonymous: (
      <Link href="/join" className={primary}>{t('ctaRequestJoin')}</Link>
    ),
    rejected: (
      <>
        <p className="text-sm text-muted-foreground">{t('noteRejected')}</p>
        <Link href="/join" className={primary}>{t('ctaRequestJoin')}</Link>
      </>
    ),
    pending: (
      <>
        <StatusPill tone="warn">{t('statusPending')}</StatusPill>
        <p className="text-sm text-muted-foreground">{t('notePending')}</p>
      </>
    ),
    member: (
      <>
        <Link href="/book" className={primary}>{t('ctaGoBooking')}</Link>
        <Link href="/bookings" className={ghost}>{t('ctaMyBookings')}</Link>
      </>
    ),
    owner: (
      <>
        <Link href="/manage" className={primary}>{t('ctaManage')}</Link>
        <Link href="/book" className={ghost}>{t('ctaGoBooking')}</Link>
      </>
    ),
    restricted: (
      <>
        <RestrictionNotice restriction={restriction} timeZone={club.timezone} clubPhone={club.phone} variant="card" />
        {/* Leads for an owner: running the club is not what the penalty took away. */}
        {canManage ? <Link href="/manage" className={primary}>{t('ctaManage')}</Link> : null}
        <Link href="/bookings" className={canManage ? ghost : primary}>{t('ctaMyBookings')}</Link>
        <Link href="/book" className={ghost}>{t('ctaBookingCalendar')}</Link>
      </>
    ),
  };

  return (
    <AppShell
      width="md"
      align="center"
      brand={<ClubBrand name={club.name} logoUrl={club.logoUrl} />}
      menu={<UserMenu session={menuSession(user, { tenant: true })} />}
      footer={<AppFooter tenant labels={await footerLabels()} />}
    >
      <div className="flex flex-col items-center">
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

          <div className="flex w-full flex-col items-center gap-2">{ctas[kind]}</div>
        </Card>
      </div>
    </AppShell>
  );
}
