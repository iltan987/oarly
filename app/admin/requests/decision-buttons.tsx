'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

import { decideClubRequestAction, type DecideState } from './actions';

/**
 * The approve/reject pair for one club request. Deliberately NOT `ClubStatusButton`:
 * that component is the suspend/reinstate control, and sharing it is what made
 * approving a new club indistinguishable from un-suspending an old one in the audit
 * trail (spec §1, §5.3).
 *
 * Both decisions go behind a confirmation NAMING the club, because neither can be
 * walked back: a decided request never returns to `pending`, and `rejected` is
 * terminal — `setClubStatus` refuses it, so there is no un-reject path at any layer.
 * An unnamed confirm is what let a double-click land on the wrong row and destroy real
 * data in this codebase before.
 */
export function DecisionButtons({ clubId, clubName }: { clubId: string; clubName: string }) {
  const t = useTranslations('admin');
  const [pendingDecision, setPendingDecision] = useState<'approve' | 'reject' | null>(null);
  const [state, formAction] = useActionState<DecideState | null, FormData>(decideClubRequestAction, null);
  // Each resolved action produces a fresh state object, so identity is enough to tell
  // "a new result arrived" from "this effect re-ran" — without it, a re-render after an
  // unrelated prop change would re-toast a result the operator already dismissed.
  const handled = useRef<DecideState | null>(null);

  useEffect(() => {
    if (state === null || state === handled.current) return;
    handled.current = state;
    setPendingDecision(null);
    if (state.ok) toast.success(state.decision === 'approve' ? t('approved') : t('rejected'));
    // Both refusals come from server-side guards and say something the operator can act
    // on, so they are reported verbatim rather than as the generic "try again".
    else if (state.error === 'note_required') toast.error(t('errorNoteRequired'));
    else if (state.error === 'not_pending') toast.error(t('errorNotPending'));
    else toast.error(t('actionError'));
  }, [state, t]);

  const rejecting = pendingDecision === 'reject';
  const noteLabel = rejecting ? t('rejectNote') : t('approveNote');

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => setPendingDecision('approve')}>{t('approve')}</Button>
      <Button size="sm" variant="destructive" onClick={() => setPendingDecision('reject')}>{t('reject')}</Button>

      <Dialog open={pendingDecision !== null} onOpenChange={(open) => { if (!open) setPendingDecision(null); }}>
        <DialogContent>
          {/* Mounted only while a decision is pending, so the note field is fresh for
              each one: a reason typed into an abandoned reject dialog must not be
              carried into the next request's approval. */}
          {pendingDecision && (
            <form action={formAction}>
              <input type="hidden" name="clubId" value={clubId} />
              <input type="hidden" name="decision" value={pendingDecision} />
              <DialogHeader>
                <DialogTitle>
                  {rejecting ? t('confirmRejectTitle', { club: clubName }) : t('confirmApproveTitle', { club: clubName })}
                </DialogTitle>
              </DialogHeader>
              <p className="mt-2 text-sm text-muted-foreground">
                {rejecting ? t('confirmRejectBody') : t('confirmApproveBody')}
              </p>
              <label className="mt-3 flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{noteLabel}</span>
                {/* `required` on reject is the client half only; `decideClubRequest`
                    refuses an empty or whitespace-only note server-side regardless,
                    because the column is nullable and no constraint can (spec §5.1). */}
                <Textarea name="note" rows={3} required={rejecting} aria-label={noteLabel} />
              </label>
              <DialogFooter className="mt-4">
                <DialogClose render={<Button type="button" variant="ghost" />}>{t('cancel')}</DialogClose>
                {/* Its own label, not the trigger's: two controls sharing one accessible
                    name is how an "are you sure?" stops being a second decision. */}
                <PendingButton variant={rejecting ? 'destructive' : 'default'}>
                  {rejecting ? t('confirmRejectCta') : t('confirmApproveCta')}
                </PendingButton>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
