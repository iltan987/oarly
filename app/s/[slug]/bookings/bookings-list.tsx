'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';

import { cancelBookingAction, type CancelFormState } from './actions';

export type BookingRow = {
  id: string;
  boatName: string;
  startAt: string; // ISO
  endAt: string; // ISO
  status: 'booked' | 'waitlisted' | 'cancelled' | 'no_show' | 'attended';
  queuePosition: number | null;
  canCancel: boolean;
};

const initial: CancelFormState = { status: 'idle', error: null };

function CancelButton({ slug, bookingId }: { slug: string; bookingId: string }) {
  const t = useTranslations('booking');
  const [state, formAction, pending] = useActionState(cancelBookingAction.bind(null, slug), initial);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Button type="submit" size="xs" variant="ghost" disabled={pending}>{t('cancel')}</Button>
      {state.status === 'error' && <span className="text-xs text-destructive">{t(`cancelErrors.${state.error ?? 'generic'}`)}</span>}
    </form>
  );
}

function statusLabel(t: ReturnType<typeof useTranslations>, row: BookingRow): string {
  if (row.status === 'waitlisted') return t('waitlisted', { position: row.queuePosition ?? 0 });
  if (row.status === 'booked') return t('seated');
  return row.status;
}

function Section({ slug, title, rows, timeZone, cancellable }: { slug: string; title: string; rows: BookingRow[]; timeZone: string; cancellable: boolean }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-heading text-base font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <span>
                {f.dateTime(new Date(row.startAt), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })}
                {' · '}{row.boatName}{' · '}{statusLabel(t, row)}
              </span>
              {cancellable && row.canCancel && <CancelButton slug={slug} bookingId={row.id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BookingsList({ slug, upcoming, past, timeZone }: { slug: string; upcoming: BookingRow[]; past: BookingRow[]; timeZone: string }) {
  const t = useTranslations('booking');
  return (
    <div className="flex flex-col gap-6">
      <Section slug={slug} title={t('upcoming')} rows={upcoming} timeZone={timeZone} cancellable />
      <Section slug={slug} title={t('past')} rows={past} timeZone={timeZone} cancellable={false} />
    </div>
  );
}
