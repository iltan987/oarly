'use client';

import { useFormatter, useTranslations } from 'next-intl';

import type { CalendarDay } from '@/lib/calendar';

import { DateOverrideControls } from './date-override-controls';

export function PreviewCalendar({ slug, days, overriddenDates, timeZone }: { slug: string; days: CalendarDay[]; overriddenDates: string[]; timeZone: string }) {
  const t = useTranslations('manage.schedulePreview');
  const f = useFormatter();
  const overridden = new Set(overriddenDates);
  return (
    <ul className="flex flex-col gap-3">
      {days.map((day) => (
        <li key={day.dateISO} className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{f.dateTime(new Date(`${day.dateISO}T00:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span>
            {day.closed && <span className="text-sm text-muted-foreground">{day.closedReason === 'holiday' ? t('closedHoliday') : t('closedByYou')}</span>}
          </div>
          {!day.closed && day.slots.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {day.slots.map((s) => (
                <li key={s.startAt.toISOString()} className="text-muted-foreground">
                  {f.dateTime(s.startAt, { hour: '2-digit', minute: '2-digit', timeZone })}
                  {' – '}
                  {f.dateTime(s.endAt, { hour: '2-digit', minute: '2-digit', timeZone })}
                  {' · '}
                  {s.sessions.map((x) => x.boatName).join(', ') || t('noBoats')}
                </li>
              ))}
            </ul>
          )}
          {!day.closed && day.slots.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t('noSessions')}</p>}
          <div className="mt-2">
            <DateOverrideControls slug={slug} dateISO={day.dateISO} overridden={overridden.has(day.dateISO)} />
          </div>
        </li>
      ))}
    </ul>
  );
}
