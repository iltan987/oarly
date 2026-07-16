import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/session';

import { RequestClubForm } from './request-club-form';

export default async function RequestClubPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  await requireUser('/request-club');
  const { submitted } = await searchParams;
  const t = await getTranslations('requestClub');

  if (submitted === '1') {
    return (
      <div className="w-full">
        <h1 className="mb-4 font-heading text-2xl font-bold">{t('submittedTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('submittedBody')}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h1 className="mb-2 font-heading text-2xl font-bold">{t('title')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t('body')}</p>
      <RequestClubForm />
    </div>
  );
}
