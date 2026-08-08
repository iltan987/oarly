'use client';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useEffect, useOptimistic, useRef, useState } from 'react';
import { toast } from 'sonner';

import { StatusPill } from '@/components/booking-status-badge';
import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RosterSession } from '@/lib/roster';
import { cn } from '@/lib/utils';

import { type MemberHit, type OwnerAddActionResult, ownerAddBookingAction, ownerRemoveBookingAction, type RemoveActionResult } from './actions';
import { type MarkActionResult, markNoShowAction, type UndoActionResult, undoNoShowAction } from './attendance-actions';
import { MemberCombobox } from './member-combobox';

/** A seat added optimistically, tagged with the session card it belongs under. */
type PendingAddition = { sessionKey: string; member: MemberHit };

export type RosterSessionWithPenalty = RosterSession & {
  banEndsAt: Date | null;
  banPermanent: boolean;
  banLapsed: boolean;
};

export function BookingsRoster({ slug, sessions, timezone, closed = false, multisportEnabled = true }: {
  slug: string;
  sessions: RosterSessionWithPenalty[];
  timezone: string;
  closed?: boolean;
  multisportEnabled?: boolean;
}) {
  const t = useTranslations('manage.bookings');
  const tm = useTranslations('manage');

  // Drives the fade-in-place on the row being removed. Base UI's Dialog renders the
  // confirm form in a portal, so the row's PendingButton-based `has-data-pending:` CSS
  // trick can't see it — this state bridges that. Cleared once rmState resolves, below.
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);

  // Same bridge for "mark absent", which has the same portalled-confirm-form problem
  // AND the slowest round trip in this file (marking cascades booking cancellations and
  // penalty mail). Its dialog closes on submit, so without this the operator sees
  // nothing at all change for the whole trip — the very defect this branch fixed for
  // remove. Cleared once markState resolves, below.
  const [pendingAbsenceId, setPendingAbsenceId] = useState<string | null>(null);

  // Optimistic seat additions, owned HERE rather than in AddMemberForm so they can be
  // rendered as trailing <li>s of the confirmed seated list. Rendering them below the
  // waitlist instead would make the server's confirmation jump the new member up past
  // every waitlisted row — shifting those rows' destructive controls at round-trip
  // completion, which is exactly the delayed reflow of §1.2. As trailing seated rows,
  // confirmation is a pure in-place replacement that moves nothing.
  const [pendingAdditions, addPendingMember] = useOptimistic<PendingAddition[], PendingAddition>(
    [],
    (current, addition) => [...current, addition],
  );

  // Remove state lives here (stable parent): a successful removal revalidates
  // and unmounts the row, so a row-local toast effect would be dropped. (Add
  // has the same hazard — its own toast fires imperatively after the awaited
  // action instead, which survives the add-form unmounting just as well; see
  // `AddMemberFields` below.)
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

  const [markState, markAction] = useActionState<MarkActionResult | null, FormData>(markNoShowAction.bind(null, slug), null);
  const markHandled = useRef<MarkActionResult | null>(null);
  useEffect(() => {
    if (markState === null || markState === markHandled.current) return;
    markHandled.current = markState;
    setPendingAbsenceId(null);
    if (markState.ok) {
      if (markState.cancelled > 0) toast.success(t('markedWithCancellations', { count: markState.cancelled }));
      else toast.success(t('marked'));
    } else if (markState.error === 'already_marked') toast.info(t('markAlready'));
    else toast.error(tm('actionError'));
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
        const sessionKey = s.sessionId ?? `${s.boatTypeId}-${i}`;
        const pending = pendingAdditions.filter((p) => p.sessionKey === sessionKey);
        return (
          <Card key={sessionKey} size="sm">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-heading text-sm font-semibold">{s.boatName} · {time}</span>
                <span className="text-xs text-muted-foreground">{s.seated.filter((m) => m.status === 'booked').length}/{s.capacity}</span>
              </div>

              {(s.seated.length > 0 || pending.length > 0) && (
                <ul className="flex flex-col gap-1">
                  {s.seated.map((m) => (
                    <li
                      key={m.bookingId}
                      className={cn(
                        'flex items-center justify-between gap-2 text-sm transition-opacity has-data-pending:opacity-40',
                        (pendingRemovalId === m.bookingId || pendingAbsenceId === m.bookingId) && 'opacity-40',
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
                  {/*
                    Trailing rows of the SEATED list, dimmed until the server confirms.
                    When it does, the optimistic row is replaced in place by the real
                    one — no row above or below it moves.
                  */}
                  {pending.map((p) => (
                    // min-h-7 matches the h-7 size="sm" buttons a confirmed seated row
                    // carries (src/components/ui/button.tsx). This row is text-only and
                    // would otherwise sit shorter, so confirmation would grow the row and
                    // shift every waitlisted row's Remove control below it — do not remove
                    // this as cosmetic.
                    <li key={p.member.userId} className="flex min-h-7 items-center justify-between gap-2 text-sm text-muted-foreground opacity-50">
                      <span className="min-w-0 truncate">{p.member.name}</span>
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
                <AddMemberForm
                  session={s}
                  slug={slug}
                  multisportEnabled={multisportEnabled}
                  onSubmitted={(member) => addPendingMember({ sessionKey, member })}
                />
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        <DialogContent>
          {confirming && (
            <form
              action={markAction}
              onSubmit={() => {
                setPendingAbsenceId(confirming.bookingId);
                setConfirming(null);
              }}
              className="flex flex-col gap-4"
            >
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
                <PendingButton variant="destructive">{t('confirmAbsentCta')}</PendingButton>
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

/**
 * Appending below the confirmed roster shifts nothing above it, unlike a remove or an
 * insert in the middle of the list — that is what makes an add safe to show before the
 * round trip resolves (see spec §3). The optimistic list itself is owned by
 * `BookingsRoster` so it can render inside the seated <ul>; this component only
 * forwards the pick to it and remounts `AddMemberFields` (via `key`) on a successful
 * add so the picker resets to empty.
 */
function AddMemberForm({ session, slug, multisportEnabled, onSubmitted }: {
  session: RosterSession; slug: string; multisportEnabled: boolean;
  onSubmitted: (member: MemberHit) => void;
}) {
  const [formKey, setFormKey] = useState(0);

  return (
    <AddMemberFields
      key={formKey}
      session={session}
      slug={slug}
      multisportEnabled={multisportEnabled}
      onSubmitted={onSubmitted}
      // Post-`await` state update, so it must be wrapped in `startTransition`
      // (spec §4.4) — outside one React warns and applies it synchronously,
      // tearing it out of the action's transition.
      onAdded={() => startTransition(() => setFormKey((k) => k + 1))}
    />
  );
}

function AddMemberFields({ session, slug, multisportEnabled, onSubmitted, onAdded }: {
  session: RosterSession; slug: string; multisportEnabled: boolean;
  onSubmitted: (member: MemberHit) => void;
  onAdded: () => void;
}) {
  const t = useTranslations('manage.bookings');
  const tm = useTranslations('manage');
  const [selected, setSelected] = useState<MemberHit | null>(null);
  const [payment, setPayment] = useState<'regular' | 'multisport'>('regular');

  // A plain async function passed as the <form>'s `action` runs inside React's
  // implicit form-action transition, so `onSubmitted` — a `useOptimistic`
  // dispatch owned by the parent `AddMemberForm` — is safe to call here on the
  // current frame. The toast fires imperatively, after the awaited result, so
  // it does not depend on this component still being mounted to observe a
  // state change (unlike the hoisted-`useActionState` rows above, this one
  // has nothing that needs to survive an unmount). `onAdded` remounts this
  // component with a fresh `key` — the guide's key-increment technique — so
  // the picker and payment type reset only once the add is confirmed, not
  // eagerly and not on failure (a rejected add leaves the pick in place to retry).
  async function handleSubmit(formData: FormData) {
    if (!selected) return;
    onSubmitted(selected);
    const result: OwnerAddActionResult = await ownerAddBookingAction(slug, null, formData);
    if (result.ok) {
      toast.success(t('added'));
      onAdded();
    } else if (result.error === 'multisport_disabled') {
      toast.error(t('multisportDisabled'));
    } else {
      toast.error(tm('actionError'));
    }
  }

  return (
    <form action={handleSubmit} className="flex flex-wrap items-center gap-2 border-t pt-2">
      <input type="hidden" name="windowId" value={session.windowId ?? ''} />
      <input type="hidden" name="boatTypeId" value={session.boatTypeId} />
      <input type="hidden" name="startAt" value={session.startAt.toISOString()} />
      <input type="hidden" name="userId" value={selected?.userId ?? ''} />
      {/* Base UI's <Select> does not serialize to FormData — this hidden input is the
          source of truth submitted. When the club has no MultiSport contract, the
          picker below is hidden and this is forced to 'regular' regardless of `payment`. */}
      <input type="hidden" name="paymentType" value={multisportEnabled ? payment : 'regular'} />
      <MemberCombobox slug={slug} selected={selected} onSelect={setSelected} />
      {multisportEnabled && (
        <Select value={payment} onValueChange={(v) => setPayment(v as 'regular' | 'multisport')}>
          <SelectTrigger className="w-32">
            <SelectValue>{(v) => (v === 'multisport' ? t('paymentMultisport') : t('paymentRegular'))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="regular">{t('paymentRegular')}</SelectItem>
            <SelectItem value="multisport">{t('paymentMultisport')}</SelectItem>
          </SelectContent>
        </Select>
      )}
      <PendingButton size="sm" disabled={!selected}>{t('add')}</PendingButton>
    </form>
  );
}

// startAt/endAt are UTC instants; render the wall-clock in the club timezone.
const fmt = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
const fmtDate = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
