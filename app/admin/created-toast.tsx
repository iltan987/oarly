'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { toast } from 'sonner';

export function CreatedToast({ created }: { created: boolean }) {
  const t = useTranslations('admin');
  useEffect(() => {
    if (created) toast.success(t('created'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
