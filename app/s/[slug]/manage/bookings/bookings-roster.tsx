'use client';
import { useFormatter, useTranslations } from 'next-intl';
import { startTransition, useActionState, useEffect, useOptimistic, useRef, useState } from 'react';
import { toast } from 'sonner';

import { StatusPill } from '@/components/booking-status-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

export function BookingsRoster({ slug, sessions, timezone, closed = false, multisportEnabled }: {
  slug: string;
  sessions: RosterSessionWithPenalty[];
  timezone: string;
  closed?: boolean;
  /**
   * Required, with no default: defaulting it to `true` fails OPEN — a caller that
   * forgets to thread the club flag through would offer MultiSport at a club that
   * has none. `BoatsEditor` makes it required for the same reason.
   */
  multisportEnabled: boolean;
}) {
  const t = useTranslations('manage.bookings');
  const tm = useTranslations('manage');
  const f = useFormatter();

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
    // Two session cards per row at `lg:`, which halves the scroll for a club running six
    // boats in a morning window.
    //
    // `items-start` keeps each card's BOX at its own content height. A grid item stretches
    // to its row's height by default, so without it the shorter card of a pair grows to its
    // neighbour's height and paints the difference as empty card — and its bottom edge then
    // moves every time the OTHER card gains or loses a row. Measured at 1440px across an
    // optimistic add and its confirmation: with this class the short card is 137px at all
    // three moments, with 12px of padding below its last control; without it, 438 → 470 →
    // 425, with 313 → 345 → 300px of empty card under content that never changed.
    //
    // What it does NOT do is hold any CONTROL still — an earlier version of this comment
    // said it did, and the measurement that was offered as proof returns the same 0.000px
    // either way. `Card` is `display:flex; flex-direction:column; justify-content:normal`
    // with a single child that does not grow (`src/components/ui/card.tsx:15`), so a
    // stretched card gains its space BELOW the content: with `items-start` deleted, all
    // four of the untouched card's buttons stayed at 200/249/249/251, unchanged.
    //
    // The precondition for a control to move is something bottom-anchored inside the card,
    // and there is none. Verified rather than assumed: `justify-content: space-between` on
    // the card moves nothing (it has one child, so there is no space to distribute), while
    // `margin-top: auto` on `CardContent` moves every button by +288px. If a footer or a
    // second Card child is ever added here, that is the point at which this reasoning has
    // to be redone — not before.
    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
      {sessions.map((s, i) => {
        const time = `${fmt(f, s.startAt, timezone)}–${fmt(f, s.endAt, timezone)}`;
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

      {/*
        `title`/`description` are computed with `confirming?.…` because `ConfirmDialog`
        renders its form only while `open`, and `open` here IS `confirming !== null` — the
        empty-string branch can never reach the DOM. Keeping the `<Dialog>` mounted while
        closed (rather than wrapping the whole thing in `{confirming && …}`) is what
        preserves Base UI's exit animation.

        `onSubmit` is the portal bridge, unchanged in substance from the hand-rolled form
        it replaces: Base UI renders this form outside the row's subtree, so the row's
        `has-data-pending:` `:has()` selector cannot see the submit button and the row
        stops dimming. Setting the pending id here is what keeps the fade.
      */}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => { if (!open) setConfirming(null); }}
        title={t('confirmAbsentTitle', { name: confirming?.name ?? '' })}
        description={absenceConsequence(t, f, confirming?.session, timezone)}
        confirmLabel={t('confirmAbsentCta')}
        dismissLabel={tm('cancel')}
        destructive
        action={markAction}
        hidden={{ bookingId: confirming?.bookingId ?? '' }}
        onSubmit={() => {
          if (!confirming) return;
          setPendingAbsenceId(confirming.bookingId);
          setConfirming(null);
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={t('confirmRemoveTitle', { name: removing?.name ?? '' })}
        description={t('confirmRemoveBody')}
        confirmLabel={t('confirmRemoveCta')}
        dismissLabel={tm('cancel')}
        destructive
        action={rmAction}
        hidden={{ bookingId: removing?.bookingId ?? '' }}
        onSubmit={() => {
          if (!removing) return;
          setPendingRemovalId(removing.bookingId);
          setRemoving(null);
        }}
      />
    </div>
  );
}

/**
 * Which of the four penalty sentences a mark-absent confirmation shows. Lifted out of the
 * JSX unchanged so the nested ternary stays readable as a `description` prop; `undefined`
 * only occurs while the dialog is closed, where nothing renders it.
 */
function absenceConsequence(
  t: ReturnType<typeof useTranslations>,
  f: Formatter,
  session: RosterSessionWithPenalty | undefined,
  timezone: string,
): string {
  if (!session) return '';
  if (session.banPermanent) return t('confirmAbsentPermanent');
  if (session.banEndsAt === null) return t('confirmAbsentNoPenalty');
  if (session.banLapsed) return t('confirmAbsentLapsed');
  return t('confirmAbsentBan', { date: fmtDate(f, session.banEndsAt, timezone) });
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

/**
 * Refusal -> `manage.bookings` message key. Typed as a total `Record` over the action's
 * error union on purpose: add a refusal to `ownerAddBooking` and this stops compiling until
 * it has copy, which is what stops the next one silently inheriting the generic toast the
 * way `session_full` and `already_booked_this_slot` both did.
 *
 * None of these copy strings offers the owner an action the product cannot perform. In
 * particular `already_booked_this_slot` — which a waitlisted member standing on the dock
 * now reliably produces — reports the state and stops there: there is no way to promote
 * them from this form, and pretending otherwise would be worse than saying nothing.
 */
const ADD_ERROR_KEYS: Record<NonNullable<Extract<OwnerAddActionResult, { ok: false }>['error']>, string> = {
  already_booked_this_slot: 'alreadyInSlot',
  multisport_day_taken: 'multisportDayTaken',
  multisport_disabled: 'multisportDisabled',
  no_session: 'sessionUnavailable',
  not_a_member: 'notBookable',
  session_full: 'sessionFull',
};

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
    } else {
      // Every named refusal has copy; the generic toast is left for the one case that is
      // not a state of the club at all — a submission that failed schema validation, which
      // carries no `error`.
      const key = result.error && ADD_ERROR_KEYS[result.error];
      toast.error(key ? t(key) : tm('actionError'));
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

/**
 * startAt/endAt are UTC instants; these render the wall-clock in the CLUB's timezone, in
 * the READER's locale.
 *
 * Both were `new Intl.DateTimeFormat('en-GB', …)` — a hardcoded locale on a page whose
 * default is Turkish. `fmt` is locale-invariant across tr/en (a 24-hour clock is a
 * 24-hour clock) and was merely wrong on paper; `fmtDate` was wrong on screen, because
 * `month: 'long'` renders "12 August" and it feeds `confirmAbsentBan`'s `{date}` — the
 * sentence telling a Turkish owner how long they are about to ban a member for.
 *
 * The formatter is passed in rather than called here: `useFormatter` is a hook, and these
 * are module-level helpers called from render and from `absenceConsequence`.
 */
type Formatter = ReturnType<typeof useFormatter>;
const fmt = (f: Formatter, d: Date, tz: string) => f.dateTime(d, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
const fmtDate = (f: Formatter, d: Date, tz: string) => f.dateTime(d, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
