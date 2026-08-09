import { getTranslations } from 'next-intl/server';

import { AppWordmark } from '@/components/app-brand';
import { AppFooter } from '@/components/app-footer';
import { AppShell } from '@/components/app-shell';
import { UserMenu } from '@/components/user-menu';
import { menuSession } from '@/lib/menu-session';
import { getCurrentUser } from '@/lib/session';

export default async function PrivacyPage() {
  const t = await getTranslations('privacy');
  const tCommon = await getTranslations('common');
  const user = await getCurrentUser();
  return (
    <AppShell
      width="2xl"
      brand={<AppWordmark name={tCommon('appName')} />}
      menu={<UserMenu session={menuSession(user)} />}
      footer={<AppFooter />}
    >
      <div className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('stub')}</p>
      </div>
    </AppShell>
  );
}
