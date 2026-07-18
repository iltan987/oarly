import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { listBoats } from '@/lib/boats';
import { requireOwner } from '@/lib/membership';
import { listWindowsWithBoats } from '@/lib/schedule';

import { ScheduleEditor } from './schedule-editor';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SchedulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/schedule');
  const t = await getTranslations('manage.schedule');
  const [windows, boats] = await Promise.all([listWindowsWithBoats(db, club.id), listBoats(db, club.id)]);
  const activeBoats = boats.filter((b) => b.active);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {/* Public-facing link: the tenant subdomain rewrites `/manage/...` to `/s/{slug}/manage/...`
            internally, but client-side `<Link>` navigation must use the public `/manage/...` form
            (slug is in the hostname, not the path). See app/s/[slug]/manage/page.tsx. */}
        <Link href="/manage/schedule/preview" className="shrink-0 text-sm text-primary hover:underline">
          {t('previewLink')}
        </Link>
      </div>
      <ScheduleEditor
        slug={slug}
        windows={windows.map((w) => ({ id: w.id, weekday: w.weekday, startTime: w.startTime, endTime: w.endTime, defaultSessionMinutes: w.defaultSessionMinutes, boats: w.boats }))}
        boats={activeBoats.map((b) => ({ id: b.id, name: b.name }))}
        weekdayNames={{ 0: t('weekdays.0'), 1: t('weekdays.1'), 2: t('weekdays.2'), 3: t('weekdays.3'), 4: t('weekdays.4'), 5: t('weekdays.5'), 6: t('weekdays.6') }}
        labels={{
          addWindow: t('addWindow'), noWindows: t('noWindows'), edit: t('edit'), delete: t('delete'),
          minutesShort: t('minutesShort'), needBoats: t('needBoats'), startTime: t('startTime'), endTime: t('endTime'),
          sessionMinutes: t('sessionMinutes'), boats: t('boats'), addBoat: t('addBoat'), removeBoat: t('removeBoat'),
          save: t('save'), cancel: t('cancel'),
          errors: {
            end_before_start: t('errors.end_before_start'), uneven_tiling: t('errors.uneven_tiling'),
            overlap: t('errors.overlap'), invalid_boats: t('errors.invalid_boats'),
            not_found: t('errors.not_found'), generic: t('errors.generic'),
          },
        }}
      />
    </div>
  );
}
