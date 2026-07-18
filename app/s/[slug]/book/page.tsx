import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { MemberHeader } from '@/components/member-header';
import { db } from '@/db';
import { skillLevels } from '@/db/schema';
import { todayInClub } from '@/lib/date-tz';
import { computeMemberCalendar, type PaymentType } from '@/lib/member-calendar';
import { requireMember } from '@/lib/membership';

import { BookCalendar } from './book-calendar';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const BOOK_DAYS = 14;

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club, user, membership } = await requireMember(slug, '/book');
  const t = await getTranslations('booking');

  let skillRank: number | null = null;
  if (membership.skillLevelId) {
    const [level] = await db.select({ rank: skillLevels.rank }).from(skillLevels).where(eq(skillLevels.id, membership.skillLevelId));
    skillRank = level?.rank ?? null;
  }

  // Better Auth types `defaultPaymentType` as a generic `string | null | undefined` even though
  // the additionalField only ever stores 'regular' | 'multisport' (default 'regular'); narrow it.
  const paymentType: PaymentType = user.defaultPaymentType === 'multisport' ? 'multisport' : 'regular';

  const fromDateISO = todayInClub(new Date(), club.timezone);
  const days = await computeMemberCalendar(db, club.id, {
    userId: user.id,
    membershipStatus: membership.status,
    bannedUntil: membership.bannedUntil,
    skillRank,
    paymentType,
  }, { fromDateISO, days: BOOK_DAYS });

  return (
    <div className="mx-auto max-w-2xl p-4">
      <MemberHeader active="book" club={{ name: club.name, logoUrl: club.logoUrl }} />
      <div className="mb-4">
        <h1 className="font-heading text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description', { days: BOOK_DAYS })}</p>
      </div>
      <BookCalendar slug={slug} days={days} timeZone={club.timezone} />
    </div>
  );
}
