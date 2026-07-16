import { getTranslations } from 'next-intl/server';
import { requireClub } from '@/lib/tenant';

export default async function JoinPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const club = await requireClub(slug);
  const t = await getTranslations('club');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-heading text-2xl font-bold text-brand">{t('joinTitle', { name: club.name })}</h1>
      <p className="text-muted-foreground">{t('joinBody')}</p>
    </main>
  );
}
