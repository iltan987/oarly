'use client';
import { useTranslations } from 'next-intl';

import { authClient } from '@/auth-client';
import { Button } from '@/components/ui/button';

export function SignOutButton({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations('common');
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => authClient.signOut().then(() => { window.location.href = redirectTo; })}
    >
      {t('signOut')}
    </Button>
  );
}
