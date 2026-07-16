import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>{t('home')}</Link>
    </main>
  );
}
