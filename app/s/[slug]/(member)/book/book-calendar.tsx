'use client';

import { Lock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { type BadgeTone, StatusPill } from '@/components/booking-status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import type { MemberCalendarDay, MemberVirtualSession, MemberVirtualSlot } from '@/lib/member-calendar';
import { cn } from '@/lib/utils';

import { type BookFormState, bookSeatAction } from './actions';

const initial: BookFormState = { status: 'idle', error: null };

type UiState = 'booked' | 'waitlisted' | 'ineligible' | 'notopen' | 'full' | 'open';

type Confirm = { key: string; dayISO: string; slot: MemberVirtualSlot; session: MemberVirtualSession };

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

function dayLabel(f: ReturnType<typeof useFormatter>, dateISO: string): string {
  return f.dateTime(new Date(`${dateISO}T00:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

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
                : 'border-border bg-muted',
          )}
        />
      ))}
    </span>
  );
}

function PaymentChips({ session, t }: { session: MemberVirtualSession; t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {session.paymentChoices.map((p) => (
        <span
          key={p}
          className={cn(
            'inline-flex w-fit items-center rounded-pill px-2 py-0.5 text-[11px] font-medium',
            p === 'multisport' ? 'bg-info-bg text-info' : 'bg-surface-2 text-muted-foreground',
          )}
        >
          {p === 'multisport' ? t('paymentMultisport') : t('paymentRegular')}
        </span>
      ))}
    </div>
  );
}

function DateStrip({
  days,
  selected,
  onSelect,
}: {
  days: MemberCalendarDay[];
  selected: string;
  onSelect: (dateISO: string) => void;
}) {
  const t = useTranslations('booking');
  const f = useFormatter();
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {days.map((day) => {
        const date = new Date(`${day.dateISO}T00:00:00Z`);
        const isSelected = day.dateISO === selected;
        const hasSessions = day.slots.length > 0;
        return (
          <button
            key={day.dateISO}
            type="button"
            aria-current={isSelected ? 'date' : undefined}
            aria-label={t('selectDay', { date: dayLabel(f, day.dateISO) })}
            onClick={() => onSelect(day.dateISO)}
            className={cn(
              'flex w-12 shrink-0 flex-col items-center gap-1 rounded-field border px-1 py-2 text-center transition-colors',
              isSelected ? 'border-brand bg-brand text-primary-foreground' : 'border-border bg-transparent text-foreground hover:bg-muted',
              day.closed && !isSelected && 'opacity-50',
            )}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">{f.dateTime(date, { weekday: 'short', timeZone: 'UTC' })}</span>
            <span className={cn('font-heading text-base font-bold tabular-nums', day.closed && 'line-through')}>{f.dateTime(date, { day: 'numeric', timeZone: 'UTC' })}</span>
            <span className={cn('size-1 rounded-full', hasSessions && !day.closed ? (isSelected ? 'bg-primary-foreground' : 'bg-brand') : 'bg-transparent')} />
          </button>
        );
      })}
    </div>
  );
}

function ConfirmBooking({
  slug,
  dayISO,
  slot,
  session,
  timeZone,
  onClose,
}: {
  slug: string;
  dayISO: string;
  slot: MemberVirtualSlot;
  session: MemberVirtualSession;
  timeZone: string;
  onClose: () => void;
}) {
  const t = useTranslations('booking');
  const f = useFormatter();
  const [state, formAction, pending] = useActionState(bookSeatAction.bind(null, slug), initial);
  const [idempotencyKey] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const [payment, setPayment] = useState(session.defaultPayment);
  const isWaitlist = uiStateOf(session) === 'full';

  useEffect(() => {
    if (state.status === 'ok') {
      toast.success(state.outcome === 'waitlisted' ? t('waitlistedToast') : t('bookedToast'));
      onClose();
    }
  }, [state, t, onClose]);

  const timeLabel = `${f.dateTime(slot.startAt, { hour: '2-digit', minute: '2-digit', timeZone })}–${f.dateTime(slot.endAt, { hour: '2-digit', minute: '2-digit', timeZone })}`;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="windowId" value={slot.windowId ?? ''} />
      <input type="hidden" name="boatTypeId" value={session.boatTypeId} />
      <input type="hidden" name="startAt" value={slot.startAt.toISOString()} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <DialogHeader>
        <DialogTitle>{isWaitlist ? t('confirmWaitlistTitle') : t('confirmTitle')}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col divide-y divide-border text-sm">
        <div className="flex items-center justify-between py-2 first:pt-0">
          <span className="text-muted-foreground">{t('fieldBoat')}</span>
          <span className="font-medium">{session.boatName}</span>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">{t('fieldDay')}</span>
          <span className="font-medium">{dayLabel(f, dayISO)}</span>
        </div>
        <div className="flex items-center justify-between py-2 last:pb-0">
          <span className="text-muted-foreground">{t('fieldTime')}</span>
          <span className="font-medium tabular-nums">{timeLabel}</span>
        </div>
      </div>
      {session.paymentChoices.length > 1 ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{t('paymentQuestion')}</span>
          {/* Explicit hidden field is the source of truth for FormData; RadioGroup is controlled UI only. */}
          <input type="hidden" name="paymentType" value={payment} />
          <RadioGroup value={payment} onValueChange={(v) => setPayment(v as typeof payment)} className="grid grid-cols-2 gap-2">
            {session.paymentChoices.map((p) => {
              const label = p === 'multisport' ? t('paymentMultisport') : t('paymentRegular');
              const checked = payment === p;
              return (
                <div
                  key={p}
                  onClick={() => setPayment(p)}
                  className={cn(
                    'flex cursor-pointer items-center justify-center rounded-field border p-2.5 text-sm font-medium transition-colors',
                    checked ? 'border-brand bg-brand-tint text-brand-ink' : 'border-border text-foreground hover:bg-muted',
                  )}
                >
                  <RadioGroupItem value={p} aria-label={label} className="sr-only" />
                  {label}
                </div>
              );
            })}
          </RadioGroup>
        </div>
      ) : (
        <input type="hidden" name="paymentType" value={session.paymentChoices[0]} />
      )}
      {state.status === 'error' && <p className="text-sm text-destructive">{t(`errors.${state.error ?? 'generic'}`)}</p>}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" />}>{t('cancel')}</DialogClose>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          {isWaitlist ? t('confirmWaitlistCta') : t('confirmCta')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function SessionCard({
  slot,
  session,
  timeZone,
  onBook,
}: {
  slot: MemberVirtualSlot;
  session: MemberVirtualSession;
  timeZone: string;
  onBook: (slot: MemberVirtualSlot, session: MemberVirtualSession) => void;
}) {
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

  return (
    <div className={cn('flex flex-col gap-3 rounded-card border bg-card p-4', ui === 'booked' ? 'border-brand' : 'border-border')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="font-heading text-xl font-bold tabular-nums">
            {f.dateTime(slot.startAt, { hour: '2-digit', minute: '2-digit', timeZone })}–{f.dateTime(slot.endAt, { hour: '2-digit', minute: '2-digit', timeZone })}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {session.boatName} · {t('seatsCount', { count: session.capacity })}
          </span>
        </div>
        <StatusPill tone={pillTone} className="shrink-0">{pillText}</StatusPill>
      </div>
      <PaymentChips session={session} t={t} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <SeatPips capacity={session.capacity} seatsLeft={session.seatsLeft} mine={ui === 'booked'} />
          {subText && <span className="text-xs text-muted-foreground">{subText}</span>}
        </div>
        {ui === 'open' || ui === 'full' ? (
          <Button
            type="button"
            size="sm"
            variant={ui === 'full' ? 'secondary' : 'default'}
            className={cn(ui === 'full' && 'border-transparent bg-warn-bg text-warn hover:bg-warn-bg/80')}
            onClick={() => onBook(slot, session)}
          >
            {ui === 'full' ? t('joinWaitlist') : t('book')}
          </Button>
        ) : ui === 'ineligible' ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" />{t('locked')}</span>
        ) : null}
      </div>
    </div>
  );
}

function ClosedDay({ day, timeZone, t, f }: { day: MemberCalendarDay; timeZone: string; t: ReturnType<typeof useTranslations>; f: ReturnType<typeof useFormatter> }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <StatusPill tone="neutral" className="w-fit">{day.closedReason === 'holiday' ? t('closedHoliday') : t('closedByClub')}</StatusPill>
      {day.slots.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {day.slots.flatMap((slot) =>
            slot.sessions.map((session, i) => (
              <li key={`${slot.startAt.toISOString()}-${session.boatTypeId}-${session.sessionId ?? i}`}>
                {f.dateTime(slot.startAt, { hour: '2-digit', minute: '2-digit', timeZone })}–{f.dateTime(slot.endAt, { hour: '2-digit', minute: '2-digit', timeZone })} · {session.boatName}
              </li>
            )),
          )}
        </ul>
      )}
    </div>
  );
}

export function BookCalendar({ slug, days, timeZone }: { slug: string; days: MemberCalendarDay[]; timeZone: string }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  const [selectedDate, setSelectedDate] = useState<string>(() => (days.find((d) => d.slots.length > 0) ?? days[0])?.dateISO ?? '');
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  // Fall back to the first day with sessions (or the first day) if the previously
  // selected date no longer exists in a refreshed `days` window — computed at
  // render time so a stale selection never needs a corrective effect.
  const selectedDay = days.find((d) => d.dateISO === selectedDate) ?? days.find((d) => d.slots.length > 0) ?? days[0];
  const sessionRows = selectedDay && !selectedDay.closed
    ? selectedDay.slots.flatMap((slot) => slot.sessions.map((session, i) => ({ slot, session, key: `${slot.startAt.toISOString()}-${session.boatTypeId}-${session.sessionId ?? i}` })))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <DateStrip days={days} selected={selectedDay?.dateISO ?? ''} onSelect={setSelectedDate} />
      {selectedDay && (
        <div className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">{dayLabel(f, selectedDay.dateISO)}</h2>
          {selectedDay.closed ? (
            <ClosedDay day={selectedDay} timeZone={timeZone} t={t} f={f} />
          ) : sessionRows.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {sessionRows.map(({ slot, session, key }) => (
                <li key={key}>
                  <SessionCard
                    slot={slot}
                    session={session}
                    timeZone={timeZone}
                    onBook={(bookSlot, bookSession) => setConfirm({ key: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`, dayISO: selectedDay.dateISO, slot: bookSlot, session: bookSession })}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noSessions')}</p>
          )}
        </div>
      )}
      <Dialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <DialogContent>
          {confirm && (
            <ConfirmBooking
              key={confirm.key}
              slug={slug}
              dayISO={confirm.dayISO}
              slot={confirm.slot}
              session={confirm.session}
              timeZone={timeZone}
              onClose={() => setConfirm(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
