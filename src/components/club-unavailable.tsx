import { getTranslations } from 'next-intl/server';

import { ClubBrand } from '@/components/app-brand';
import { AppFooter } from '@/components/app-footer';
import { AppShell } from '@/components/app-shell';
import { UserMenu } from '@/components/user-menu';
import { menuSession } from '@/lib/menu-session';
import { getCurrentUser } from '@/lib/session';

export async function ClubUnavailable({ name }: { name: string }) {
  const t = await getTranslations('unavailable');
  const user = await getCurrentUser();
  return (
    // A tenant host (this renders through app/s/[slug]/layout.tsx's status swap, not a
    // route of its own), so every apex target has to be absolute.
    <AppShell
      width="md"
      align="center"
      brand={<ClubBrand name={name} />}
      menu={<UserMenu session={menuSession(user, { tenant: true })} />}
      footer={<AppFooter tenant />}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        {/*
          `unavailable.title`, not the club name: the name is now the header's brand, and
          repeating it as the <h1> would say the club's name twice and the actual problem
          zero times. That key existed and was rendered nowhere until this.
        */}
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('body')}</p>
      </div>
    </AppShell>
  );
}
