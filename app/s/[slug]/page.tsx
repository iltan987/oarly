import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { env } from '@/env';
import { parseAppOrigin } from '@/lib/urls';
import { requireClub } from '@/lib/tenant';
import { buildClubMetadata } from '@/lib/seo';
import { buttonVariants } from '@/components/ui/button';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const club = await requireClub(slug);
  const t = await getTranslations('club');
  return buildClubMetadata({
    club,
    description: t('metaDescription', { name: club.name }),
    origin: parseAppOrigin(env.APP_URL),
  });
}

export default async function ClubPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const club = await requireClub(slug);
  const t = await getTranslations('club');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-8 text-center">
      {club.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={club.logoUrl} alt={club.name} className="h-20 w-20 rounded-full object-cover" />
      ) : null}
      <h1 className="font-heading text-3xl font-bold text-brand">{club.name}</h1>
      <p className="text-muted-foreground">{t('joinBody')}</p>
      {club.phone ? <p className="text-sm text-muted-foreground">{club.phone}</p> : null}
      <Link href="/join" className={buttonVariants({ className: 'w-full' })}>
        {t('joinCta')}
      </Link>
    </main>
  );
}
