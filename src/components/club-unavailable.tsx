import { getTranslations } from 'next-intl/server';

export async function ClubUnavailable({ name }: { name: string }) {
  const t = await getTranslations('unavailable');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-heading text-2xl font-bold text-brand">{name}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
    </main>
  );
}
