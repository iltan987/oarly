import { getTranslations } from 'next-intl/server';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

export default async function Home() {
  const t = await getTranslations('common');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full items-center justify-between">
        <span className="font-heading text-2xl font-bold text-brand">{t('appName')}</span>
        <ThemeToggle />
      </div>
      <Button className="w-full">{t('signIn')}</Button>
    </main>
  );
}
