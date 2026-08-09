import { getTranslations } from 'next-intl/server';

import { AppControls } from '@/components/app-controls';

export async function ClubUnavailable({ name }: { name: string }) {
  const t = await getTranslations('unavailable');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-8">
      <div className="flex justify-end">
        <AppControls />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <h1 className="font-heading text-2xl font-bold text-brand">{name}</h1>
        <p className="text-muted-foreground">{t('body')}</p>
      </div>
    </main>
  );
}
