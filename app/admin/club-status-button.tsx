'use client';

import { useTranslations } from 'next-intl';
import { useOptimistic } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';

import { setClubStatusAction } from './actions';

export function ClubStatusButton({
  clubId,
  targetStatus,
  label,
}: {
  clubId: string;
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
    setOptimistic(
      optimistic.targetStatus === 'active'
        ? { targetStatus: 'suspended', label: t('suspend') }
        : { targetStatus: 'active', label: t('activate') },
    );
    const result = await setClubStatusAction(null, formData);
    if (result.ok) {
      toast.success(result.status === 'active' ? t('activated') : t('suspended2'));
    } else {
      toast.error(t('actionError'));
    }
  }

  return (
    <form action={handleSubmit}>
      <input type="hidden" name="clubId" value={clubId} />
      <input type="hidden" name="status" value={optimistic.targetStatus === 'active' ? 'active' : 'suspend'} />
      <PendingButton
        size="sm"
        variant={optimistic.targetStatus === 'suspended' ? 'destructive' : 'default'}
      >
        {optimistic.label}
      </PendingButton>
    </form>
  );
}
