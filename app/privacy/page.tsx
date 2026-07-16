import { getTranslations } from 'next-intl/server';

export default async function PrivacyPage() {
  const t = await getTranslations('privacy');
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-4 font-heading text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('stub')}</p>
    </main>
  );
}
