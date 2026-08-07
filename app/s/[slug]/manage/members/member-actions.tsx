'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';

import { PendingButton } from '@/components/pending-button';

import type { ManageActionResult } from '../action-result';
import { approveMemberAction, rejectMemberAction } from './actions';

const initial: ManageActionResult | null = null;

export function ApproveButton({ slug, membershipId, label }: { slug: string; membershipId: string; label: string }) {
  const t = useTranslations('manage');
  const [state, formAction] = useActionState(approveMemberAction.bind(null, slug), initial);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) toast.success(t('memberApproved'));
    else toast.error(t('actionError'));
  }, [state, t]);

  return (
    <form action={formAction}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <PendingButton size="sm">{label}</PendingButton>
    </form>
  );
}

export function RejectButton({ slug, membershipId, label }: { slug: string; membershipId: string; label: string }) {
  const t = useTranslations('manage');
  const [state, formAction] = useActionState(rejectMemberAction.bind(null, slug), initial);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) toast.success(t('memberRejected'));
    else toast.error(t('actionError'));
  }, [state, t]);

  return (
    <form action={formAction}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <PendingButton size="sm" variant="destructive">{label}</PendingButton>
    </form>
  );
}
