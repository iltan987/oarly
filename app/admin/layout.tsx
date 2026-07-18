import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { env } from '@/env';
import { requireAdmin } from '@/lib/session';
import { apexUrl, parseAppOrigin } from '@/lib/urls';

import { AdminNav } from './_nav';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  const t = await getTranslations('admin');
  const signOutUrl = apexUrl('/sign-in?signedout=1', parseAppOrigin(env.APP_URL));
  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/admin" className="font-heading text-lg font-bold text-brand">{t('title')}</Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <SignOutButton redirectTo={signOutUrl} />
        </div>
      </header>
      <AdminNav />
      {children}
    </div>
  );
}
