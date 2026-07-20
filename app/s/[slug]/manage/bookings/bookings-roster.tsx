'use client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RosterSession } from '@/lib/roster';

import type { ManageActionResult } from '../action-result';
import { ownerAddBookingAction, ownerRemoveBookingAction } from './actions';

type Member = { userId: string; name: string };

export function BookingsRoster({ slug, sessions, members, timezone }: { slug: string; sessions: RosterSession[]; members: Member[]; timezone: string }) {
  const t = useTranslations('manage.bookings');
  const tm = useTranslations('manage');

  // Remove + add state live here (stable parent): a successful action revalidates
  // and can unmount the row/add-form, so a row-local toast effect would be dropped.
  const [rmState, rmAction, rmPending] = useActionState<ManageActionResult | null, FormData>(ownerRemoveBookingAction.bind(null, slug), null);
  const rmHandled = useRef<ManageActionResult | null>(null);
  useEffect(() => {
    if (rmState === null || rmState === rmHandled.current) return;
    rmHandled.current = rmState;
    if (rmState.ok) toast.success(t('removed'));
    else toast.error(tm('actionError'));
  }, [rmState, t, tm]);

  const [addState, addAction, addPending] = useActionState<ManageActionResult | null, FormData>(ownerAddBookingAction.bind(null, slug), null);
  const addHandled = useRef<ManageActionResult | null>(null);
  useEffect(() => {
    if (addState === null || addState === addHandled.current) return;
    addHandled.current = addState;
    if (addState.ok) toast.success(t('added'));
    else toast.error(tm('actionError'));
  }, [addState, t, tm]);

  if (sessions.length === 0) return <p className="text-sm text-muted-foreground">{t('empty')}</p>;

  return (
    <div className="flex flex-col gap-3">
      {sessions.map((s, i) => {
        const time = `${fmt(s.startAt, timezone)}–${fmt(s.endAt, timezone)}`;
        return (
          <Card key={s.sessionId ?? `${s.boatTypeId}-${i}`} size="sm">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-heading text-sm font-semibold">{s.boatName} · {time}</span>
                <span className="text-xs text-muted-foreground">{s.seated.length}/{s.capacity}</span>
              </div>

              {s.seated.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {s.seated.map((m) => (
                    <li key={m.bookingId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{m.name}</span>
                      <form action={rmAction} className="shrink-0">
                        <input type="hidden" name="bookingId" value={m.bookingId} />
                        <Button type="submit" size="sm" variant="ghost" disabled={rmPending}>{t('remove')}</Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              {s.waitlisted.length > 0 && (
                <ul className="flex flex-col gap-1 border-t pt-2">
                  {s.waitlisted.map((m) => (
                    <li key={m.bookingId} className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                      <span className="min-w-0 truncate">{t('waitPosition', { n: m.queuePosition ?? 0 })} · {m.name}</span>
                      <form action={rmAction} className="shrink-0">
                        <input type="hidden" name="bookingId" value={m.bookingId} />
                        <Button type="submit" size="sm" variant="ghost" disabled={rmPending}>{t('remove')}</Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              {s.freeSeats > 0 && s.windowId && (
                <AddMemberForm session={s} members={members} addAction={addAction} addPending={addPending} />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AddMemberForm({ session, members, addAction, addPending }: {
  session: RosterSession; members: Member[]; addAction: (fd: FormData) => void; addPending: boolean;
}) {
  const t = useTranslations('manage.bookings');
  const [userId, setUserId] = useState('');
  const [payment, setPayment] = useState<'regular' | 'multisport'>('regular');

  return (
    <form action={addAction} className="flex flex-wrap items-center gap-2 border-t pt-2">
      <input type="hidden" name="windowId" value={session.windowId ?? ''} />
      <input type="hidden" name="boatTypeId" value={session.boatTypeId} />
      <input type="hidden" name="startAt" value={session.startAt.toISOString()} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="paymentType" value={payment} />
      <Select value={userId || undefined} onValueChange={(v) => setUserId(v ?? '')}>
        <SelectTrigger className="min-w-40 flex-1"><SelectValue placeholder={t('selectMember')} /></SelectTrigger>
        <SelectContent>
          {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={payment} onValueChange={(v) => setPayment(v as 'regular' | 'multisport')}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="regular">{t('paymentRegular')}</SelectItem>
          <SelectItem value="multisport">{t('paymentMultisport')}</SelectItem>
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" disabled={addPending || !userId}>{t('add')}</Button>
    </form>
  );
}

// startAt/endAt are UTC instants; render the wall-clock in the club timezone.
const fmt = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
