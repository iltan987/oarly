'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { setClubStatusAction, type SetClubStatusState } from './actions';

const initial: SetClubStatusState | null = null;

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
  const [state, formAction, pending] = useActionState(setClubStatusAction, initial);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      toast.success(state.status === 'active' ? t('activated') : t('suspended2'));
    } else {
      toast.error(t('actionError'));
    }
  }, [state, t]);

  return (
    <form action={formAction}>
      <input type="hidden" name="clubId" value={clubId} />
      <input type="hidden" name="status" value={targetStatus === 'active' ? 'active' : 'suspend'} />
      <Button
        type="submit"
        size="sm"
        variant={targetStatus === 'suspended' ? 'destructive' : 'default'}
        disabled={pending}
      >
        {label}
      </Button>
    </form>
  );
}
