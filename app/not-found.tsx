import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AppWordmark } from '@/components/app-brand';
import { AppFooter } from '@/components/app-footer';
import { AppShell } from '@/components/app-shell';
import { buttonVariants } from '@/components/ui/button';
import { UserMenu } from '@/components/user-menu';
import { menuSession } from '@/lib/menu-session';
import { getCurrentUser } from '@/lib/session';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  const tCommon = await getTranslations('common');
  const user = await getCurrentUser();
  return (
    // `tenant` unconditionally, even though this page also serves the apex host: a 404 on
    // a club subdomain rewrites to /s/{slug}/… and lands here too (see proxy.ts), so this
    // is the one surface whose host is genuinely unknown at render time. Absolute apex
    // hrefs are correct on both hosts; relative ones would 404 again on a tenant. The
    // only cost on apex is a full page load instead of a client-side navigation.
    <AppShell
      width="md"
      align="center"
      brand={<AppWordmark name={tCommon('appName')} />}
      menu={<UserMenu session={menuSession(user, { tenant: true })} />}
      footer={<AppFooter tenant />}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('body')}</p>
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>{t('home')}</Link>
      </div>
    </AppShell>
  );
}
