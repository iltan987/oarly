'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { transferOwnershipAction, type TransferOwnerState } from './actions';

export type TransferCandidate = { userId: string; name: string; email: string };

const SELECT_ID = 'transfer-owner-select';

/**
 * Ownership transfer is irreversible without a second transfer, and it demotes a real
 * person, so it goes behind a confirmation naming BOTH the incoming owner and the
 * club — an admin working through a list of clubs must not be able to reassign the
 * wrong one from muscle memory. The confirm carries its own label rather than
 * repeating the trigger's: two controls sharing one accessible name is how an "are
 * you sure?" stops being a second decision.
 *
 * A native `<select>` rather than the shadcn `Select`: this control lives inside a
 * confirmation `<form>` whose value must be readable from `FormData`, and a native
 * select is both simpler and directly assertable in jsdom.
 */
export function TransferOwner({ clubId, clubName, candidates }: {
  clubId: string;
  clubName: string;
  candidates: TransferCandidate[];
}) {
  const t = useTranslations('admin');
  const [selected, setSelected] = useState(candidates[0]?.userId ?? '');
  const [open, setOpen] = useState(false);
  // `clubId` is BOUND, not a hidden field: the club is the route this control belongs
  // to, not something a crafted POST gets to choose.
  const [state, formAction] = useActionState<TransferOwnerState | null, FormData>(
    transferOwnershipAction.bind(null, clubId),
    null,
  );
  // Each resolved action produces a fresh state object, so identity is enough to tell
  // "a new result arrived" from "this effect re-ran" — without it, a re-render after an
  // unrelated prop change would re-toast a result the operator already dismissed.
  const handled = useRef<TransferOwnerState | null>(null);

  useEffect(() => {
    if (state === null || state === handled.current) return;
    handled.current = state;
    setOpen(false);
    if (state.ok) toast.success(t('transferred'));
    // Both refusals come from server-side guards and can never succeed on a retry, so
    // they are reported verbatim instead of as the generic "try again".
    else if (state.error === 'target_not_member') toast.error(t('transferErrorNotMember'));
    else if (state.error === 'already_owner') toast.error(t('transferErrorAlreadyOwner'));
    else toast.error(t('actionError'));
  }, [state, t]);

  // No eligible member means no control at all. Rendering a disabled or empty picker
  // would offer a transfer that `transferOwnership` refuses by construction.
  if (candidates.length === 0) return <p className="text-sm text-muted-foreground">{t('transferNoCandidates')}</p>;

  // Falls back to the first candidate so the confirmation can never name nobody.
  const chosen = candidates.find((c) => c.userId === selected) ?? candidates[0];

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={SELECT_ID} className="text-muted-foreground">{t('transferSelect')}</label>
        <select
          id={SELECT_ID}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {candidates.map((c) => (
            <option key={c.userId} value={c.userId}>{c.name} — {c.email}</option>
          ))}
        </select>
      </div>
      <Button size="sm" onClick={() => setOpen(true)}>{t('transferCta')}</Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={formAction}>
            <input type="hidden" name="toUserId" value={chosen.userId} />
            <DialogHeader>
              <DialogTitle>{t('confirmTransferTitle', { name: chosen.name, club: clubName })}</DialogTitle>
            </DialogHeader>
            <p className="mt-2 text-sm text-muted-foreground">{t('confirmTransferBody')}</p>
            <DialogFooter className="mt-4">
              <DialogClose render={<Button type="button" variant="ghost" />}>{t('cancel')}</DialogClose>
              <PendingButton>{t('confirmTransferCta')}</PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
