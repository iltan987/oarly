'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { MemberCalendarDay, MemberVirtualSession } from '@/lib/member-calendar';

import { type BookFormState, bookSeatAction } from './actions';

const initial: BookFormState = { status: 'idle', error: null };
const selectClass = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs';

function BookableSession({ slug, windowId, startAtISO, session }: { slug: string; windowId: string; startAtISO: string; session: MemberVirtualSession }) {
  const t = useTranslations('booking');
  const [state, formAction, pending] = useActionState(bookSeatAction.bind(null, slug), initial);
  const [payment, setPayment] = useState(session.defaultPayment);
  const [idempotencyKey] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`));

  const full = session.seatsLeft <= 0;
  const label = full ? t('joinWaitlist') : t('book');

  if (session.myStatus === 'booked') return <span className="text-sm font-medium text-primary">{t('booked')}</span>;
  if (session.myStatus === 'waitlisted') return <span className="text-sm text-muted-foreground">{t('waitlisted', { position: session.myQueuePosition ?? 0 })}</span>;
  if (!session.eligibility.ok) return <span className="text-sm text-muted-foreground">{t(`reasons.${session.eligibility.reason}`)}</span>;
  if (!session.bookingOpen) return <span className="text-sm text-muted-foreground">—</span>;

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="windowId" value={windowId} />
      <input type="hidden" name="boatTypeId" value={session.boatTypeId} />
      <input type="hidden" name="startAt" value={startAtISO} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {session.paymentChoices.length > 1 ? (
        <select name="paymentType" value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)} className={selectClass} aria-label={t('paymentLabel')}>
          {session.paymentChoices.map((p) => <option key={p} value={p}>{p === 'regular' ? 'Cash' : 'MultiSport'}</option>)}
        </select>
      ) : (
        <input type="hidden" name="paymentType" value={session.paymentChoices[0]} />
      )}
      <Button type="submit" size="xs" variant={full ? 'outline' : 'default'} disabled={pending}>{label}</Button>
      {state.status === 'error' && <span className="text-xs text-destructive">{t(`errors.${state.error ?? 'generic'}`)}</span>}
    </form>
  );
}

export function BookCalendar({ slug, days, timeZone }: { slug: string; days: MemberCalendarDay[]; timeZone: string }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  return (
    <ul className="flex flex-col gap-3">
      {days.map((day) => (
        <li key={day.dateISO} className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{f.dateTime(new Date(`${day.dateISO}T00:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span>
            {day.closed && <span className="text-sm text-muted-foreground">{day.closedReason === 'holiday' ? t('closedHoliday') : t('closedByClub')}</span>}
          </div>
          {day.slots.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {day.slots.map((slot) => (
                <li key={slot.startAt.toISOString()} className="flex flex-col gap-1 border-t pt-2 first:border-t-0 first:pt-0">
                  <span className="text-muted-foreground">
                    {f.dateTime(slot.startAt, { hour: '2-digit', minute: '2-digit', timeZone })} – {f.dateTime(slot.endAt, { hour: '2-digit', minute: '2-digit', timeZone })}
                  </span>
                  <ul className="flex flex-col gap-1">
                    {slot.sessions.map((session, i) => (
                      <li key={`${session.boatTypeId}-${session.sessionId ?? i}`} className="flex items-center justify-between gap-3">
                        <span>
                          {session.boatName}
                          {' · '}
                          {session.seatsLeft > 0 ? t('seatsLeft', { count: session.seatsLeft, capacity: session.capacity }) : t('full')}
                        </span>
                        {day.closed ? null : <BookableSession slug={slug} windowId={slot.windowId ?? ''} startAtISO={slot.startAt.toISOString()} session={session} />}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            !day.closed && <p className="mt-2 text-sm text-muted-foreground">{t('noSessions')}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
