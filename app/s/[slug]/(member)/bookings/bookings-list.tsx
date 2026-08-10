'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { StatusPill, toneByStatus } from '@/components/booking-status-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

import { cancelBookingAction, type CancelFormState } from './actions';

export type BookingRow = {
  id: string;
  boatName: string;
  startAt: string; // ISO
  endAt: string; // ISO
  status: 'booked' | 'waitlisted' | 'cancelled' | 'no_show' | 'attended';
  /** Null for every row that is not cancelled, and for every row cancelled before the column existed. */
  cancelledReason: 'member' | 'owner' | 'penalty' | null;
  queuePosition: number | null;
  canCancel: boolean;
};

const initial: CancelFormState = { status: 'idle', error: null };

/**
 * Cancelling a seat is GATED, and it is the only member-facing action in this codebase
 * that was not.
 *
 * `cancelBooking` calls `applySeating` inside the same transaction, so on a full session
 * the waitlist promotes the instant it commits — the seat is gone before the row has
 * finished re-rendering, and rebooking means the back of a queue the club may cap at zero.
 * An action whose undo may be impossible is the class that confirms. Every comparable
 * action here already does (mark-absent, owner-remove, approve/reject, suspend, admin
 * toggle, ownership transfer); this was the exception, on the surface with the smallest
 * tap targets — an `xs` button in a dense row on a 320px phone.
 *
 * Recorded against it, because it is a real cost and not a strawman: friction discourages
 * exactly the behaviour a club wants, since an early cancellation is what frees the seat
 * for someone else. The mitigation is that the gate is ONE extra tap — no typed
 * confirmation, no cooling-off — and the body tells the member the thing that makes the
 * tap worth it: where the seat goes.
 *
 * The dismiss label is `confirmCancelKeep` ("Yerimi koru"), never `cancel`. The trigger is
 * already `booking.cancel` ("Vazgeç"), so reusing it would render the dialog as
 * "Vazgeç / Vazgeç" — two controls with one accessible name, which is how an "are you
 * sure?" stops being a second decision (`decision-buttons.tsx:80-81`).
 */
function CancelButton({ slug, bookingId }: { slug: string; bookingId: string }) {
  const t = useTranslations('booking');
  // The THIRD SLOT is not optional here. This control used to be a `PendingButton` inside
  // the form, disabled by `useFormStatus` for the whole round trip; moving the form into a
  // portalled dialog took that away, because `useFormStatus` only sees a form it is inside
  // and this button is no longer inside one. `pending-button.tsx:26-28` names this exact
  // regression ("the policies form regressed precisely by dropping the third slot").
  //
  // What it costs to drop it: the dialog is Base UI's default DISMISSIBLE modal, so Escape
  // or the backdrop closes it while the cancellation is still in flight. In that window the
  // row would look untouched and its trigger would be live again — so a member who presses
  // Escape because "nothing happened" taps Cancel again, the second dispatch spends a token
  // from the shared `book:acct` bucket and comes back an error, and they read a red failure
  // for a cancellation that actually succeeded.
  const [state, formAction, isPending] = useActionState(cancelBookingAction.bind(null, slug), initial);
  const [confirming, setConfirming] = useState(false);

  // The toast carries the SAME specific reason as the inline line below it — a
  // generic "something went wrong" alongside a specific reason just contradicts
  // itself. (It also kept the owner-facing `manage` namespace on a member page.)
  //
  // The dialog closes HERE rather than in the confirm button's `onSubmit`, so it stays up
  // — with `PendingButton`'s spinner in it — for the whole round trip. Closing on submit
  // would leave a member on a page where nothing at all changed until the toast landed,
  // which is the defect the roster's `pendingRemovalId` bridge exists to fix; here the
  // dialog is still on screen, so it can just carry the spinner itself.
  //
  // The `handled` ref is the pattern `decision-buttons.tsx:31-45` and `admin-toggle.tsx`
  // already use, and it is load-bearing here for the same reason plus one more: each
  // resolved action produces a FRESH state object, so identity distinguishes "a new result
  // arrived" from "this effect re-ran". `useTranslations` returns a new `t` on every
  // render, and `t` is in the dependency array — without the ref, any re-render of this
  // row (a sibling's revalidation, a theme change) would re-fire the toast and re-close a
  // dialog the member had since reopened.
  const handled = useRef<CancelFormState | null>(null);
  useEffect(() => {
    if (state.status === 'idle' || state === handled.current) return;
    handled.current = state;
    setConfirming(false);
    if (state.status === 'ok') toast.success(t('cancelledToast'));
    else toast.error(t(`cancelErrors.${state.error ?? 'generic'}`));
  }, [state, t]);

  return (
    <div className="flex items-center gap-2">
      {/*
        `data-pending` mirrors what `PendingButton` exposes, so an ancestor's
        `has-data-pending:` CSS bridge keeps working on this row; the spinner sits BEFORE
        the label rather than replacing it, same as `PendingButton`, so the label never
        disappears mid-flight.

        `aria-hidden` on the spinner, which `PendingButton` does not do. `ui/spinner.tsx`
        gives it `role="status" aria-label="Loading"` — inside a button that is folded into
        the accessible name, so mid-flight this control would rename itself from "Vazgeç"
        to "Loading Vazgeç": an unstable accessible name, and one English word inside a
        Turkish flow, which is the same defect the dialog's X button was removed for.
        `disabled` is what a screen reader needs here and it already announces it; the
        spinner is decoration.
      */}
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={isPending}
        data-pending={isPending ? '' : undefined}
        onClick={() => setConfirming(true)}
      >
        {isPending && <Spinner aria-hidden />}
        {t('cancel')}
      </Button>
      {state.status === 'error' && <span className="text-xs text-destructive">{t(`cancelErrors.${state.error ?? 'generic'}`)}</span>}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('confirmCancelTitle')}
        description={t('confirmCancelBody')}
        confirmLabel={t('confirmCancelCta')}
        dismissLabel={t('confirmCancelKeep')}
        destructive
        action={formAction}
        hidden={{ bookingId }}
      />
    </div>
  );
}

function statusLabel(t: ReturnType<typeof useTranslations>, row: BookingRow): string {
  if (row.status === 'waitlisted') return t('waitlisted', { position: row.queuePosition ?? 0 });
  if (row.status === 'booked') return t('seated');
  if (row.status === 'cancelled') return t('cancelled');
  if (row.status === 'no_show') return t('noShow');
  return t('attended');
}

/**
 * The one line that says which cancellation this was. The PILL stays `booking.cancelled`
 * with its neutral tone for all four cases — the pill is the status, and the status really
 * is the same one; this is the story underneath it.
 *
 * `'member'` and `null` both render nothing, and that is a decision, not a missing case:
 *
 * - `'member'` — the member did this themselves, and they were told so at the time. A line
 *   telling them again is noise.
 * - `null` — the row predates the column (or, harmlessly, is not cancelled at all). We do
 *   not know who ended it. Defaulting those to "you cancelled this" would assert the one
 *   thing this column exists to stop guessing at, and would be wrong for exactly the rows
 *   that most need explaining: the owner removals and penalty cascades already in the
 *   database. Silence is the honest rendering of "no record".
 */
function cancelledSubLine(t: ReturnType<typeof useTranslations>, row: BookingRow): string | null {
  if (row.status !== 'cancelled') return null;
  if (row.cancelledReason === 'penalty') return t('cancelledBy.penalty');
  if (row.cancelledReason === 'owner') return t('cancelledBy.owner');
  return null;
}

/**
 * `empty` is a PROP, not something derived from `cancellable`. The two sections' empty
 * states differ in the one way that matters — Upcoming offers a way out, Past cannot —
 * and deriving that from the cancellability flag would tie one decision to an unrelated
 * one, so a test could pass for the wrong reason and a club that turns self-cancellation
 * off would silently get the wrong empty state on both sections.
 */
function Section({ slug, title, rows, timeZone, cancellable, empty }: { slug: string; title: string; rows: BookingRow[]; timeZone: string; cancellable: boolean; empty: ReactNode }) {
  const t = useTranslations('booking');
  const f = useFormatter();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        empty
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const why = cancelledSubLine(t, row);
            return (
            <li key={row.id}>
              <Card size="sm">
                <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-heading text-sm font-semibold">
                      {f.dateTime(new Date(row.startAt), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })}
                    </span>
                    <span className="text-xs text-muted-foreground">{row.boatName}</span>
                    {/* Under the boat name, not beside the pill: at 320px the pill row already
                        wraps, and a sentence there would push the cancel affordance off-screen. */}
                    {why && <span className="text-xs text-muted-foreground">{why}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={toneByStatus[row.status]}>{statusLabel(t, row)}</StatusPill>
                    {cancellable && (row.canCancel ? <CancelButton slug={slug} bookingId={row.id} /> : <span className="text-xs text-muted-foreground">{t('cancelClosed')}</span>)}
                  </div>
                </CardContent>
              </Card>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function BookingsList({ slug, upcoming, past, timeZone, restricted }: {
  slug: string;
  upcoming: BookingRow[];
  past: BookingRow[];
  timeZone: string;
  /**
   * Whether this member is paused or suspended — `restriction.state !== 'none'`, computed
   * by the page, which already loads it for `RestrictionNotice`. A boolean rather than the
   * `Restriction`: nothing here formats a date or names a cause, and the two states differ
   * in nothing this component decides.
   *
   * REQUIRED, with no default, and that is the whole point. `restricted = false` would fail
   * OPEN — a caller that forgets to thread it through gets the exact bug this prop exists
   * to fix, silently, and the empty state goes back to inviting a paused member to book.
   * `BoatsEditor` and `BookingsRoster.multisportEnabled` are required for the same reason.
   */
  restricted: boolean;
}) {
  const t = useTranslations('booking');
  return (
    <div className="flex flex-col gap-6">
      <Section
        slug={slug}
        title={t('upcoming')}
        rows={upcoming}
        timeZone={timeZone}
        cancellable
        /*
          The CTA is a real `next/link`, so the tap is a prefetched navigation rather than
          a client push, and `/book` is the PUBLIC tenant path — the slug is in the
          hostname (proxy.ts), never in the href.

          `buttonVariants(...)` on the Link, NOT `<Button render={<Link/>}>`. Base UI's
          `Button` is `nativeButton` by default and logs an error when its `render` element
          is not a `<button>` — and the documented fix, `nativeButton={false}`, is worse
          here: it stamps `role="button"` onto the anchor, so a control that NAVIGATES
          stops announcing itself as a link and drops out of a screen reader's links list.
          The class-only form keeps the anchor an anchor and looks identical.
          (`app/s/[slug]/manage/page.tsx` and `app/admin/audit/page.tsx` used to be the
          same five leftover call sites — now converted, so this is the only shape left
          in the app. Dev-console only: `@base-ui/utils/error` gates on
          `NODE_ENV !== 'production'`.)

          A RESTRICTED member gets the title and nothing else — no invitation, no button.

          Task 6 ended this exact dead end ("a restricted member now has somewhere to
          click"), and this section was walking them back into it: three lines under a card
          reading "Duraklatıldı — rezervasyon erişimin 17 Ağustos… geri açılacak" sat a
          primary button to `/book`, where every session renders `Kilitli`. The body is an
          imperative too — "göz at ve yerini ayırt" is "browse and reserve your place" —
          so dropping the button alone would leave the sentence issuing the instruction the
          button used to carry out.

          What is NOT done here, and deliberately: saying why. No "you can't book yet"
          variant, no second copy of the pause date. `RestrictionNotice` is directly above,
          it already says it with the date AND the hour, and a weaker restatement three
          lines down dilutes the one that is authoritative. The title alone —
          "Yaklaşan rezervasyonun yok" — is a true, complete statement of what this section
          holds; the card above is its explanation.
        */
        empty={(
          <EmptyState
            title={t('emptyUpcomingTitle')}
            body={restricted ? undefined : t('emptyUpcomingBody')}
            action={restricted ? undefined : <Link href="/book" className={buttonVariants({ size: 'sm' })}>{t('emptyUpcomingCta')}</Link>}
          />
        )}
      />
      {/* No action: there is nothing a member can do to acquire a past booking. */}
      <Section
        slug={slug}
        title={t('past')}
        rows={past}
        timeZone={timeZone}
        cancellable={false}
        empty={<EmptyState title={t('emptyPastTitle')} body={t('emptyPastBody')} />}
      />
    </div>
  );
}
