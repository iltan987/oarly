import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AppWordmark } from '@/components/app-brand';
import { ConsoleShell } from '@/components/console-shell';
import { UserMenu } from '@/components/user-menu';
import { menuSession } from '@/lib/menu-session';
import { requireAdmin } from '@/lib/session';

import { AdminNav } from './_nav';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAdmin();
  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');
  return (
    <ConsoleShell
      brand={<AppWordmark name={tCommon('appName')} />}
      menu={<UserMenu session={menuSession(user)} />}
      /* An <h1>, not a bare <Link> with heading typography. The console title looked
         like a heading and had none of the semantics, which made /admin the only
         section of the product with no <h1> — nothing for a screen reader's heading
         list, and no document outline on any console page. The link stays inside it:
         "go back to the clubs list" is a real affordance, it just is not what made
         this text a heading.

         It moved out of the chrome row and into the content column when AppShell
         landed, and moving onto ConsoleShell does not touch it: still an <h1>, still
         wrapping the link, still guarded by app/admin/layout.test.tsx unedited. */
      title={
        <h1 className="font-heading text-2xl font-bold text-brand">
          <Link href="/admin">{t('title')}</Link>
        </h1>
      }
      nav={<AdminNav />}
    >
      {children}
    </ConsoleShell>
  );
}
