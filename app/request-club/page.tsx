import { getTranslations } from 'next-intl/server';

import { AppWordmark } from '@/components/app-brand';
import { AppFooter } from '@/components/app-footer';
import { AppShell } from '@/components/app-shell';
import { UserMenu } from '@/components/user-menu';
import { menuSession } from '@/lib/menu-session';
import { requireUser } from '@/lib/session';

import { RequestClubForm } from './request-club-form';

export default async function RequestClubPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const user = await requireUser('/request-club');
  const { submitted } = await searchParams;
  const t = await getTranslations('requestClub');
  const tCommon = await getTranslations('common');

  const shell = {
    width: 'md',
    align: 'center',
    brand: <AppWordmark name={tCommon('appName')} />,
    menu: <UserMenu session={menuSession(user)} />,
    footer: <AppFooter />,
  } as const;

  if (submitted === '1') {
    return (
      <AppShell {...shell}>
        <div className="flex flex-col gap-4">
          <h1 className="font-heading text-2xl font-bold">{t('submittedTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('submittedBody')}</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell {...shell}>
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('body')}</p>
      </div>
      <RequestClubForm />
    </AppShell>
  );
}
