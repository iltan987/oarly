import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { ThemeToggle } from '@/components/theme-toggle';
import { buttonVariants } from '@/components/ui/button';

export default async function Home() {
  const t = await getTranslations('common');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full items-center justify-between">
        <span className="font-heading text-2xl font-bold text-brand">{t('appName')}</span>
        <ThemeToggle />
      </div>
      <Link href="/sign-in" className={buttonVariants({ className: 'w-full' })}>{t('signIn')}</Link>
    </main>
  );
}
