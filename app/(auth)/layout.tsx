import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AppWordmark } from '@/components/app-brand';
import { AppFooter } from '@/components/app-footer';
import { AppShell } from '@/components/app-shell';
import { UserMenu } from '@/components/user-menu';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('common');
  return (
    // No `session`: every page in this group redirects a signed-in visitor away
    // (see sign-in/page.tsx), so the guest trigger is the only one reachable here.
    <AppShell
      width="sm"
      align="center"
      brand={<AppWordmark name={t('appName')} />}
      menu={<UserMenu />}
      footer={<AppFooter />}
    >
      <div className="flex flex-col items-center gap-6">{children}</div>
    </AppShell>
  );
}
