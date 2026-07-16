'use client';
import { useTranslations } from 'next-intl';
import { authClient } from '@/auth-client';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const t = useTranslations('common');
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => authClient.signOut().then(() => { window.location.href = '/'; })}
    >
      {t('signOut')}
    </Button>
  );
}
