'use client';

import { Lock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { type BadgeTone, StatusPill } from '@/components/booking-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MemberCalendarDay, MemberVirtualSession } from '@/lib/member-calendar';
import { cn } from '@/lib/utils';

import { type BookFormState, bookSeatAction } from './actions';

const initial: BookFormState = { status: 'idle', error: null };
const selectClass = 'h-8 rounded-field border border-input bg-transparent px-2 text-xs shadow-xs';

type UiState = 'booked' | 'waitlisted' | 'ineligible' | 'notopen' | 'full' | 'open';

function uiStateOf(s: MemberVirtualSession): UiState {
  if (s.myStatus === 'booked') return 'booked';
  if (s.myStatus === 'waitlisted') return 'waitlisted';
  if (!s.eligibility.ok) return 'ineligible';
  if (!s.bookingOpen) return 'notopen';
  return s.seatsLeft <= 0 ? 'full' : 'open';
}

const toneOf: Record<UiState, BadgeTone> = {
  booked: 'accent',
  waitlisted: 'warn',
  ineligible: 'neutral',
  notopen: 'info',
  full: 'neutral',
  open: 'ok',
};

function SeatPips({ capacity, seatsLeft, mine }: { capacity: number; seatsLeft: number; mine: boolean }) {
  const filled = Math.min(capacity, Math.max(0, capacity - seatsLeft));
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: capacity }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'size-2.5 rounded-full border',
            mine && i === filled - 1
              ? 'border-brand bg-brand'
              : i < filled
                ? 'border-muted-foreground bg-muted-foreground'
                : 'border-border',
          )}
        />
      ))}
    </span>
  );
}

function BookForm({ slug, windowId, startAtISO, session, full }: { slug: string; windowId: string; startAtISO: string; session: MemberVirtualSession; full: boolean }) {
  const t = useTranslations('booking');
  const [state, formAction, pending] = useActionState(bookSeatAction.bind(null, slug), initial);
  const [payment, setPayment] = useState(session.defaultPayment);
  const [idempotencyKey] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`));

  useEffect(() => {
    if (state.status === 'ok') toast.success(state.outcome === 'waitlisted' ? t('waitlistedToast') : t('bookedToast'));
  }, [state, t]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="windowId" value={windowId} />
      <input type="hidden" name="boatTypeId" value={session.boatTypeId} />
      <input type="hidden" name="startAt" value={startAtISO} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {session.paymentChoices.length > 1 ? (
        <select name="paymentType" value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)} className={selectClass} aria-label={t('paymentLabel')}>
          {session.paymentChoices.map((p) => (
            <option key={p} value={p}>{p === 'regular' ? t('paymentRegular') : t('paymentMultisport')}</option>
          ))}
        </select>
      ) : (
        <input type="hidden" name="paymentType" value={session.paymentChoices[0]} />
      )}
      <Button
        type="submit"
        size="xs"
        variant={full ? 'secondary' : 'default'}
        className={cn(full && 'border-transparent bg-warn-bg text-warn hover:bg-warn-bg/80')}
        disabled={pending}
      >
        {full ? t('joinWaitlist') : t('book')}
      </Button>
      {state.status === 'error' && <span className="text-xs text-destructive">{t(`errors.${state.error ?? 'generic'}`)}</span>}
    </form>
  );
}

function SessionRow({ slug, windowId, startAtISO, session, timeZone }: { slug: string; windowId: string; startAtISO: string; session: MemberVirtualSession; timeZone: string }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  const ui = uiStateOf(session);
  // A "notopen" session with no future open date has already started/closed
  // (always-open mode past its start) — show a neutral "Closed", not "Soon".
  const notOpenClosed = ui === 'notopen' && !session.bookingOpensAt;
  const pillTone: BadgeTone = notOpenClosed ? 'neutral' : toneOf[ui];

  const pillText =
    ui === 'open' ? t('seatsLeft', { count: session.seatsLeft, capacity: session.capacity })
    : ui === 'full' ? t('full')
    : ui === 'booked' ? t('booked')
    : ui === 'waitlisted' ? t('waitlisted', { position: session.myQueuePosition ?? 0 })
    : ui === 'notopen' ? (notOpenClosed ? t('closedByClub') : t('soon'))
    : t('locked');

  const subText =
    ui === 'notopen'
      ? (session.bookingOpensAt ? t('opensOn', { date: f.dateTime(session.bookingOpensAt, { day: 'numeric', month: 'short', timeZone }) }) : null)
      : ui === 'ineligible' && !session.eligibility.ok
        ? t(`reasons.${session.eligibility.reason}`)
        : null;

  const restrictedPayment = session.paymentChoices.length === 1 ? session.paymentChoices[0] : null;

  return (
    <div className="flex flex-col gap-2 rounded-field border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-2 font-heading text-sm font-bold">{session.capacity}</span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-heading text-sm font-semibold">{session.boatName}</span>
            {restrictedPayment && (
              <span className={cn('mt-0.5 inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium', restrictedPayment === 'multisport' ? 'bg-info-bg text-info' : 'bg-surface-2 text-muted-foreground')}>
                {restrictedPayment === 'multisport' ? t('paymentMultisport') : t('paymentRegular')}
              </span>
            )}
          </div>
        </div>
        <StatusPill tone={pillTone}>{pillText}</StatusPill>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <SeatPips capacity={session.capacity} seatsLeft={session.seatsLeft} mine={ui === 'booked'} />
          {subText && <span className="text-xs text-muted-foreground">{subText}</span>}
        </div>
        {ui === 'open' || ui === 'full' ? (
          <BookForm slug={slug} windowId={windowId} startAtISO={startAtISO} session={session} full={ui === 'full'} />
        ) : ui === 'ineligible' ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" />{t('locked')}</span>
        ) : null}
      </div>
    </div>
  );
}

export function BookCalendar({ slug, days, timeZone }: { slug: string; days: MemberCalendarDay[]; timeZone: string }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  return (
    <ul className="flex flex-col gap-3">
      {days.map((day) => (
        <li key={day.dateISO}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>{f.dateTime(new Date(`${day.dateISO}T00:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span>
                {day.closed && <StatusPill tone="neutral" className="font-normal">{day.closedReason === 'holiday' ? t('closedHoliday') : t('closedByClub')}</StatusPill>}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {day.slots.length > 0 ? (
                day.slots.map((slot) => (
                  <div key={slot.startAt.toISOString()} className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
                    <span className="font-heading text-xs font-bold text-muted-foreground">
                      {f.dateTime(slot.startAt, { hour: '2-digit', minute: '2-digit', timeZone })} – {f.dateTime(slot.endAt, { hour: '2-digit', minute: '2-digit', timeZone })}
                    </span>
                    {day.closed ? (
                      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                        {slot.sessions.map((session, i) => (
                          <li key={`${session.boatTypeId}-${session.sessionId ?? i}`}>{session.boatName}</li>
                        ))}
                      </ul>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {slot.sessions.map((session, i) => (
                          <li key={`${session.boatTypeId}-${session.sessionId ?? i}`}>
                            <SessionRow slug={slug} windowId={slot.windowId ?? ''} startAtISO={slot.startAt.toISOString()} session={session} timeZone={timeZone} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              ) : (
                !day.closed && <p className="text-sm text-muted-foreground">{t('noSessions')}</p>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
