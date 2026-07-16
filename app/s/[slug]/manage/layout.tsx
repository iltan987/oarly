import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { requireOwner } from '@/lib/membership';

export default async function ManageLayout({
  children, params,
}: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireOwner(slug);
  const t = await getTranslations('manage');
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 font-heading text-2xl font-bold text-brand">{t('title')}</h1>
      {children}
    </div>
  );
}
