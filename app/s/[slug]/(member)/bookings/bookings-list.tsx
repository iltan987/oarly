'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';

import { StatusPill, toneByStatus } from '@/components/booking-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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

  useEffect(() => {
    if (state.status === 'ok') toast.success(t('cancelledToast'));
  }, [state, t]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Button type="submit" size="xs" variant="outline" disabled={pending}>{t('cancel')}</Button>
      {state.status === 'error' && <span className="text-xs text-destructive">{t(`cancelErrors.${state.error ?? 'generic'}`)}</span>}
    </form>
  );
}

function statusLabel(t: ReturnType<typeof useTranslations>, row: BookingRow): string {
  if (row.status === 'waitlisted') return t('waitlisted', { position: row.queuePosition ?? 0 });
  if (row.status === 'booked') return t('seated');
  if (row.status === 'cancelled') return t('cancelled');
  if (row.status === 'no_show') return t('noShow');
  return t('attended');
}

function Section({ slug, title, rows, timeZone, cancellable }: { slug: string; title: string; rows: BookingRow[]; timeZone: string; cancellable: boolean }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Card size="sm">
                <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-heading text-sm font-semibold">
                      {f.dateTime(new Date(row.startAt), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })}
                    </span>
                    <span className="text-xs text-muted-foreground">{row.boatName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={toneByStatus[row.status]}>{statusLabel(t, row)}</StatusPill>
                    {cancellable && (row.canCancel ? <CancelButton slug={slug} bookingId={row.id} /> : <span className="text-xs text-muted-foreground">{t('cancelClosed')}</span>)}
                  </div>
                </CardContent>
              </Card>
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
