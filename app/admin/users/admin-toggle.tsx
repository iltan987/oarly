'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { setPlatformAdminAction, type SetPlatformAdminState } from './actions';

/**
 * Granting or removing platform admin is irreversible from the subject's side —
 * a removed admin cannot restore themselves — so it goes behind a confirmation
 * that NAMES the user. An unnamed confirm is what let a double-click land on the
 * wrong row and destroy real data in this codebase before.
 *
 * The confirm carries its own label rather than repeating the trigger's: two
 * controls sharing one accessible name is exactly how a "are you sure?" stops
 * being a second decision.
 */
export function AdminToggle({ userId, userName, isAdmin }: { userId: string; userName: string; isAdmin: boolean }) {
  const t = useTranslations('admin');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<SetPlatformAdminState | null, FormData>(setPlatformAdminAction, null);
  // Each resolved action produces a fresh state object, so identity is enough to tell
  // "a new result arrived" from "this effect re-ran" — without it, a re-render after an
  // unrelated prop change would re-toast a result the operator already dismissed.
  const handled = useRef<SetPlatformAdminState | null>(null);

  useEffect(() => {
    if (state === null || state === handled.current) return;
    handled.current = state;
    setOpen(false);
    if (state.ok) toast.success(state.isAdmin ? t('usersGranted') : t('usersRevoked'));
    // Both refusals come from server-side guards and can never succeed on a retry, so
    // they are reported verbatim instead of as the generic "try again".
    else if (state.error === 'self_revoke') toast.error(t('usersErrorSelfRevoke'));
    else if (state.error === 'last_admin') toast.error(t('usersErrorLastAdmin'));
    // `actionError` reads "Couldn't update the club" — the wrong noun on a page whose
    // subject is a person, so this page carries its own generic failure.
    else toast.error(t('usersActionError'));
  }, [state, t]);

  const next = !isAdmin;
  const triggerLabel = isAdmin ? t('usersRevoke') : t('usersGrant');
  const confirmLabel = isAdmin ? t('confirmRevokeCta') : t('confirmGrantCta');

  return (
    <>
      <Button size="sm" variant={isAdmin ? 'destructive' : 'default'} onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={formAction}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="isAdmin" value={String(next)} />
            <DialogHeader>
              <DialogTitle>
                {isAdmin ? t('confirmRevokeTitle', { name: userName }) : t('confirmGrantTitle', { name: userName })}
              </DialogTitle>
            </DialogHeader>
            <p className="mt-2 text-sm text-muted-foreground">
              {isAdmin ? t('confirmRevokeBody') : t('confirmGrantBody')}
            </p>
            <DialogFooter className="mt-4">
              <DialogClose render={<Button type="button" variant="ghost" />}>{t('cancel')}</DialogClose>
              <PendingButton variant={isAdmin ? 'destructive' : 'default'}>{confirmLabel}</PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
