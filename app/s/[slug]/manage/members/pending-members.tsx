'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type { ManageActionResult } from '../action-result';
import { approveMemberAction, rejectMemberAction } from './actions';

/** What a row needs to be decided on. The loader returns more; this is the part used. */
export type PendingMemberRow = { membershipId: string; name: string; email: string };

/**
 * The join-request queue: approve in one click, reject behind a confirmation.
 *
 * ## Why the asymmetry, which is this codebase's own rule
 *
 * `app/admin/club-status-button.tsx:13-30` states it: the destructive direction confirms
 * and NAMES its subject, the restorative direction does not, because "an extra click on
 * a control whose only effect is to restore service is friction with nothing behind it".
 *
 * Reject is terminal in practice even though `setMembershipStatus` will technically
 * accept `'approved'` afterwards. `searchClubMembers` selects only `approved` and
 * `banned`, so a rejected row vanishes from every surface in the product: no list shows
 * it, no control undoes it — and `requestToJoin` returns `'exists'` for the row that is
 * still there, so the person cannot ask again either. One misclick on a dense queue ends
 * somebody's membership with no way back, which is exactly the shape of decision that
 * earns a second one.
 *
 * Approve stays one-click. It is restorative, the row stays visible in the roster below,
 * and it is the bulk operation after a season sign-up — 30 confirmations for 30 approvals
 * is friction with nothing behind it.
 *
 * ## Why this is a client component at all, and why the state lives HERE
 *
 * Two things had to move up out of the rows:
 *
 * 1. **`pendingRejectId`.** The row dims while its action is in flight via
 *    `has-data-pending:opacity-40`, a `:has()` bridge to `PendingButton`'s `data-pending`.
 *    Base UI portals the confirm form out of the row's DOM subtree, so `:has()` can no
 *    longer see the submit button and the row stops dimming — the trap documented at
 *    `bookings-roster.tsx:43-53`. `ConfirmDialog`'s `onSubmit` runs on the submitting
 *    frame and is the hook for setting this id, which is what keeps the fade. The CSS
 *    bridge stays on the row as well: it is what dims an in-row APPROVE, whose submit is
 *    not portalled.
 *
 * 2. **Both `useActionState`s.** A successful decision revalidates the route and unmounts
 *    the row, so a row-local toast effect is dropped before it runs
 *    (`bookings-roster.tsx:66-70`). Hoisted here, the parent survives and the toast
 *    fires. `PendingButton` reads `useFormStatus`, which is scoped to the nearest
 *    ancestor `<form>` — one per row — so hoisting the dispatcher does NOT grey out every
 *    row's Approve.
 */
export function PendingMembers({ slug, rows }: { slug: string; rows: readonly PendingMemberRow[] }) {
  const t = useTranslations('manage');
  const [rejecting, setRejecting] = useState<PendingMemberRow | null>(null);
  const [pendingRejectId, setPendingRejectId] = useState<string | null>(null);

  const [approveState, approveAction] = useActionState<ManageActionResult | null, FormData>(
    approveMemberAction.bind(null, slug), null,
  );
  // `useActionState` hands back the SAME object on unrelated re-renders, so the effect
  // is guarded by identity rather than by a dependency list alone — otherwise a second
  // row's render re-toasts the first row's result.
  const approveHandled = useRef<ManageActionResult | null>(null);
  useEffect(() => {
    if (approveState === null || approveState === approveHandled.current) return;
    approveHandled.current = approveState;
    if (approveState.ok) toast.success(t('memberApproved'));
    else toast.error(t('actionError'));
  }, [approveState, t]);

  const [rejectState, rejectAction] = useActionState<ManageActionResult | null, FormData>(
    rejectMemberAction.bind(null, slug), null,
  );
  const rejectHandled = useRef<ManageActionResult | null>(null);
  useEffect(() => {
    if (rejectState === null || rejectState === rejectHandled.current) return;
    rejectHandled.current = rejectState;
    setPendingRejectId(null);
    if (rejectState.ok) toast.success(t('memberRejected'));
    else toast.error(t('actionError'));
  }, [rejectState, t]);

  return (
    <>
      <Card className="gap-0 divide-y divide-border py-0">
        {rows.map((r) => (
          <div
            key={r.membershipId}
            className={cn(
              'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4 transition-opacity has-data-pending:opacity-40',
              // The portal bridge's visible half. Only a REJECT sets this; an approve is
              // covered by the `:has()` selector above, whose submit is still in the row.
              pendingRejectId === r.membershipId && 'opacity-40',
            )}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-heading text-sm font-semibold break-words">{r.name}</span>
              <span className="text-xs break-words text-muted-foreground">{r.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <form action={approveAction}>
                <input type="hidden" name="membershipId" value={r.membershipId} />
                <PendingButton size="sm">{t('approve')}</PendingButton>
              </form>
              {/*
                A plain Button, not a submit: it opens the question, it does not answer
                it. Disabled once its own reject is in flight so a dialog dismissed
                mid-round-trip cannot start a second one — the rule `CancelButton` in
                `bookings-list.tsx` follows for the same reason.
              */}
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setRejecting(r)}
                disabled={pendingRejectId === r.membershipId}
              >
                {t('reject')}
              </Button>
            </div>
          </div>
        ))}
      </Card>

      {/*
        Kept MOUNTED while closed rather than wrapped in `{rejecting && …}`, which is what
        preserves Base UI's exit animation; `ConfirmDialog` renders its form only while
        open, so the empty-string fallbacks below can never reach the DOM.

        `confirmLabel` is its own word, never the trigger's: two controls sharing an
        accessible name is how an "are you sure?" stops being a second decision
        (`decision-buttons.tsx:80-81`). `dismissLabel` says what it DOES — leave the
        request waiting — rather than "never mind".
      */}
      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(open) => { if (!open) setRejecting(null); }}
        title={t('confirmRejectTitle', { name: rejecting?.name ?? '' })}
        description={t('confirmRejectBody')}
        confirmLabel={t('confirmRejectCta')}
        dismissLabel={t('confirmRejectKeep')}
        destructive
        action={rejectAction}
        hidden={{ membershipId: rejecting?.membershipId ?? '' }}
        onSubmit={() => {
          if (!rejecting) return;
          setPendingRejectId(rejecting.membershipId);
          setRejecting(null);
        }}
      />
    </>
  );
}
