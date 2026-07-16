import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { SignOutButton } from '@/components/sign-out-button';
import { requireAdmin } from '@/lib/session';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  const t = await getTranslations('admin');
  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/admin" className="font-heading text-lg font-bold">{t('title')}</Link>
          <Link href="/admin" className="text-muted-foreground hover:underline">{t('clubs')}</Link>
          <Link href="/admin/requests" className="text-muted-foreground hover:underline">{t('requests')}</Link>
          <Link href="/admin/clubs/new" className="text-muted-foreground hover:underline">{t('newClub')}</Link>
        </nav>
        <SignOutButton />
      </header>
      {children}
    </div>
  );
}
