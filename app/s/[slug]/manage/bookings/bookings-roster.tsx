'use client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { StatusPill } from '@/components/booking-status-badge';
import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RosterSession } from '@/lib/roster';
import { cn } from '@/lib/utils';

import type { ManageActionResult } from '../action-result';
import { type MemberHit, ownerAddBookingAction, ownerRemoveBookingAction, type RemoveActionResult } from './actions';
import { type MarkActionResult, markNoShowAction, type UndoActionResult, undoNoShowAction } from './attendance-actions';
import { MemberCombobox } from './member-combobox';

export type RosterSessionWithPenalty = RosterSession & {
  banEndsAt: Date | null;
  banPermanent: boolean;
  banLapsed: boolean;
};

export function BookingsRoster({ slug, sessions, timezone, closed = false }: {
  slug: string;
  sessions: RosterSessionWithPenalty[];
  timezone: string;
  closed?: boolean;
}) {
  const t = useTranslations('manage.bookings');
  const tm = useTranslations('manage');

  // Drives the fade-in-place on the row being removed. Base UI's Dialog renders the
  // confirm form in a portal, so the row's PendingButton-based `has-data-pending:` CSS
  // trick can't see it — this state bridges that. Cleared once rmState resolves, below.
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);

  // Remove + add state live here (stable parent): a successful action revalidates
  // and can unmount the row/add-form, so a row-local toast effect would be dropped.
  const [rmState, rmAction] = useActionState<RemoveActionResult | null, FormData>(ownerRemoveBookingAction.bind(null, slug), null);
  const rmHandled = useRef<RemoveActionResult | null>(null);
  useEffect(() => {
    if (rmState === null || rmState === rmHandled.current) return;
    rmHandled.current = rmState;
    setPendingRemovalId(null);
    if (rmState.ok) toast.success(t('removed'));
    else if (rmState.error === 'not_active') toast.info(t('removeAlready'));
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

  const [markState, markAction, markPending] = useActionState<MarkActionResult | null, FormData>(markNoShowAction.bind(null, slug), null);
  const markHandled = useRef<MarkActionResult | null>(null);
  useEffect(() => {
    if (markState === null || markState === markHandled.current) return;
    markHandled.current = markState;
    if (!markState.ok) toast.error(tm('actionError'));
    else if (markState.cancelled > 0) toast.success(t('markedWithCancellations', { count: markState.cancelled }));
    else toast.success(t('marked'));
  }, [markState, t, tm]);

  const [undoState, undoAction] = useActionState<UndoActionResult | null, FormData>(undoNoShowAction.bind(null, slug), null);
  const undoHandled = useRef<UndoActionResult | null>(null);
  useEffect(() => {
    if (undoState === null || undoState === undoHandled.current) return;
    undoHandled.current = undoState;
    if (undoState.ok) toast.success(t('undone'));
    else if (undoState.error === 'restore_conflict') toast.error(t('undoConflict'));
    else toast.error(tm('actionError'));
  }, [undoState, t, tm]);

  const [confirming, setConfirming] = useState<{ bookingId: string; name: string; session: RosterSessionWithPenalty } | null>(null);
  const [removing, setRemoving] = useState<{ bookingId: string; name: string } | null>(null);
  const [now] = useState(() => Date.now());

  if (sessions.length === 0) return closed ? null : <p className="text-sm text-muted-foreground">{t('empty')}</p>;

  return (
    <div className="flex flex-col gap-3">
      {sessions.map((s, i) => {
        const time = `${fmt(s.startAt, timezone)}–${fmt(s.endAt, timezone)}`;
        return (
          <Card key={s.sessionId ?? `${s.boatTypeId}-${i}`} size="sm">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-heading text-sm font-semibold">{s.boatName} · {time}</span>
                <span className="text-xs text-muted-foreground">{s.seated.filter((m) => m.status === 'booked').length}/{s.capacity}</span>
              </div>

              {s.seated.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {s.seated.map((m) => (
                    <li
                      key={m.bookingId}
                      className={cn(
                        'flex items-center justify-between gap-2 text-sm transition-opacity has-data-pending:opacity-40',
                        pendingRemovalId === m.bookingId && 'opacity-40',
                      )}
                    >
                      <span className="min-w-0 truncate">{m.name}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {m.status === 'no_show' ? (
                          <>
                            <StatusPill tone="bad">{t('absent')}</StatusPill>
                            <form action={undoAction}>
                              <input type="hidden" name="bookingId" value={m.bookingId} />
                              <PendingButton size="sm" variant="ghost">{t('undoAbsent')}</PendingButton>
                            </form>
                          </>
                        ) : (
                          <>
                            {s.startAt.getTime() <= now && (
                              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming({ bookingId: m.bookingId, name: m.name, session: s })}>
                                {t('markAbsent')}
                              </Button>
                            )}
                            <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving({ bookingId: m.bookingId, name: m.name })}>
                              {t('remove')}
                            </Button>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {s.waitlisted.length > 0 && s.waitlistCapacity != null && (
                <span className="text-xs text-muted-foreground">{t('waitingCount', { n: s.waitlisted.length, capacity: s.waitlistCapacity })}</span>
              )}
              {s.waitlisted.length > 0 && (
                <ul className="flex flex-col gap-1 border-t pt-2">
                  {s.waitlisted.map((m) => (
                    <li
                      key={m.bookingId}
                      className={cn(
                        'flex items-center justify-between gap-2 text-sm text-muted-foreground transition-opacity',
                        pendingRemovalId === m.bookingId && 'opacity-40',
                      )}
                    >
                      <span className="min-w-0 truncate">{t('waitPosition', { n: m.queuePosition ?? 0 })} · {m.name}</span>
                      <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={() => setRemoving({ bookingId: m.bookingId, name: m.name })}>
                        {t('remove')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {!closed && s.freeSeats > 0 && s.windowId && (
                <AddMemberForm session={s} slug={slug} addAction={addAction} addPending={addPending} />
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        <DialogContent>
          {confirming && (
            <form action={markAction} onSubmit={() => setConfirming(null)} className="flex flex-col gap-4">
              <input type="hidden" name="bookingId" value={confirming.bookingId} />
              <DialogHeader>
                <DialogTitle>{t('confirmAbsentTitle', { name: confirming.name })}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {confirming.session.banPermanent
                  ? t('confirmAbsentPermanent')
                  : confirming.session.banEndsAt === null
                    ? t('confirmAbsentNoPenalty')
                    : confirming.session.banLapsed
                      ? t('confirmAbsentLapsed')
                      : t('confirmAbsentBan', { date: fmtDate(confirming.session.banEndsAt, timezone) })}
              </p>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="ghost" />}>{tm('cancel')}</DialogClose>
                <Button type="submit" variant="destructive" disabled={markPending}>{t('confirmAbsentCta')}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <DialogContent>
          {removing && (
            <form
              action={rmAction}
              onSubmit={() => {
                setPendingRemovalId(removing.bookingId);
                setRemoving(null);
              }}
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="bookingId" value={removing.bookingId} />
              <DialogHeader>
                <DialogTitle>{t('confirmRemoveTitle', { name: removing.name })}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">{t('confirmRemoveBody')}</p>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="ghost" />}>{tm('cancel')}</DialogClose>
                <PendingButton variant="destructive">{t('confirmRemoveCta')}</PendingButton>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddMemberForm({ session, slug, addAction, addPending }: {
  session: RosterSession; slug: string; addAction: (fd: FormData) => void; addPending: boolean;
}) {
  const t = useTranslations('manage.bookings');
  const [selected, setSelected] = useState<MemberHit | null>(null);
  const [payment, setPayment] = useState<'regular' | 'multisport'>('regular');

  return (
    <form action={addAction} className="flex flex-wrap items-center gap-2 border-t pt-2">
      <input type="hidden" name="windowId" value={session.windowId ?? ''} />
      <input type="hidden" name="boatTypeId" value={session.boatTypeId} />
      <input type="hidden" name="startAt" value={session.startAt.toISOString()} />
      <input type="hidden" name="userId" value={selected?.userId ?? ''} />
      <input type="hidden" name="paymentType" value={payment} />
      <MemberCombobox slug={slug} selected={selected} onSelect={setSelected} />
      <Select value={payment} onValueChange={(v) => setPayment(v as 'regular' | 'multisport')}>
        <SelectTrigger className="w-32">
          <SelectValue>{(v) => (v === 'multisport' ? t('paymentMultisport') : t('paymentRegular'))}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="regular">{t('paymentRegular')}</SelectItem>
          <SelectItem value="multisport">{t('paymentMultisport')}</SelectItem>
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" disabled={addPending || !selected}>{t('add')}</Button>
    </form>
  );
}

// startAt/endAt are UTC instants; render the wall-clock in the club timezone.
const fmt = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
const fmtDate = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
