'use client';

import { useTranslations } from 'next-intl';
import { useOptimistic, useState } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { setClubStatusAction } from './actions';

/**
 * Suspend / reinstate for one club, rendered on both `/admin` and
 * `/admin/clubs/[id]`.
 *
 * SUSPEND goes behind a confirmation NAMING the club; Activate does not. Suspending
 * a club 404s every `/s/[slug]/*` page and refuses every server action for every
 * member AND its owner (`requireActiveClub`) — one click on a 25-row list takes an
 * entire tenant offline, and the two lists this control appears on are dense enough
 * that the row under the pointer is not always the row you meant. Every other
 * destructive control in the console confirms and names its subject; this was the
 * one that did not, and the cycle then rendered it on a second surface.
 *
 * Reinstating is not destructive and does not confirm: an extra click on a control
 * whose only effect is to restore service is friction with nothing behind it.
 *
 * The optimistic flip stays. It is what makes the confirm cost nothing perceptible:
 * the label swaps on the frame the operator confirms, so the dialog is the only added
 * step, not an added wait.
 */
export function ClubStatusButton({
  clubId,
  clubName,
  targetStatus,
  label,
}: {
  clubId: string;
  clubName: string;
  targetStatus: 'active' | 'suspended';
  label: string;
}) {
  const t = useTranslations('admin');

  // Activate/suspend is a value swap on this button's own label — it never
  // moves anything, so it is safe to flip on the current frame. This page is
  // a Server Component, so there is no client parent to lift the swap into;
  // the club's status pill next to this button stays server-driven and
  // updates on the next revalidated render, same as before.
  const [optimistic, setOptimistic] = useOptimistic({ targetStatus, label });
  const [confirming, setConfirming] = useState(false);

  // A plain async function passed as the <form>'s `action` runs inside
  // React's implicit form-action transition, so `setOptimistic` is safe to
  // call here on the current frame. It reads `optimistic.targetStatus` rather
  // than the `targetStatus` prop because the prop stays stale until the route
  // revalidates: after the flip, the prop still describes the OLD status, so
  // deriving the next target from it would flip straight back. (No second
  // in-flight click to compose with here — PendingButton disables this button
  // for the whole pending window, unlike the sibling rows in
  // skill-levels-editor, where each row is its own form.)
  async function handleSubmit(formData: FormData) {
    // Closed synchronously, BEFORE the await, not after the result arrives. The
    // optimistic flip immediately re-renders this component down the non-destructive
    // branch, which unmounts the dialog anyway; but if the action then FAILS, the
    // optimistic value reverts and this branch comes back — and a `confirming` still
    // left true would silently re-open the dialog behind the error toast.
    setConfirming(false);
    setOptimistic(
      optimistic.targetStatus === 'active'
        ? { targetStatus: 'suspended', label: t('suspend') }
        : { targetStatus: 'active', label: t('activate') },
    );
    const result = await setClubStatusAction(null, formData);
    if (result.ok) {
      toast.success(result.status === 'active' ? t('activated') : t('suspended2'));
    } else if (result.error === 'not_decided') {
      toast.error(t('errorNotDecided'));
    } else {
      toast.error(t('actionError'));
    }
  }

  const fields = (
    <>
      <input type="hidden" name="clubId" value={clubId} />
      <input type="hidden" name="status" value={optimistic.targetStatus === 'active' ? 'active' : 'suspend'} />
    </>
  );

  if (optimistic.targetStatus === 'active') {
    return (
      <form action={handleSubmit}>
        {fields}
        <PendingButton size="sm">{optimistic.label}</PendingButton>
      </form>
    );
  }

  return (
    <>
      <Button size="sm" variant="destructive" onClick={() => setConfirming(true)}>
        {optimistic.label}
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <form action={handleSubmit}>
            {fields}
            <DialogHeader>
              <DialogTitle>{t('confirmSuspendTitle', { club: clubName })}</DialogTitle>
            </DialogHeader>
            <p className="mt-2 text-sm text-muted-foreground">{t('confirmSuspendBody')}</p>
            <DialogFooter className="mt-4">
              <DialogClose render={<Button type="button" variant="ghost" />}>{t('cancel')}</DialogClose>
              {/* Its own label, not the trigger's: two controls sharing one accessible
                  name is how an "are you sure?" stops being a second decision. */}
              <PendingButton variant="destructive">{t('confirmSuspendCta')}</PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
