import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { computeCalendar } from '@/lib/calendar';
import { listOverrides } from '@/lib/date-overrides';
import { todayInClub } from '@/lib/date-tz';
import { requireOwner } from '@/lib/membership';

import { PreviewCalendar } from './preview-calendar';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const PREVIEW_DAYS = 14;

export default async function SchedulePreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/schedule');
  const t = await getTranslations('manage.schedulePreview');

  const fromDateISO = todayInClub(new Date(), club.timezone);
  const [days, overrides] = await Promise.all([
    computeCalendar(db, club.id, { fromDateISO, days: PREVIEW_DAYS }),
    listOverrides(db, club.id, { fromDateISO, days: PREVIEW_DAYS }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description', { days: PREVIEW_DAYS })}</p>
      </div>
      <PreviewCalendar slug={slug} days={days} overriddenDates={overrides.map((o) => o.dateISO)} timeZone={club.timezone} />
    </div>
  );
}
