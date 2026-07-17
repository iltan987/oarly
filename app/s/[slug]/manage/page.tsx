import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { listBoats } from '@/lib/boats';
import { requireOwner } from '@/lib/membership';
import { listSkillLevels } from '@/lib/skill-levels';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ManageOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug);
  const t = await getTranslations('manage');
  const [levels, boats] = await Promise.all([listSkillLevels(db, club.id), listBoats(db, club.id)]);

  // Public-facing links: the tenant subdomain rewrites `/manage/...` to `/s/{slug}/manage/...`
  // internally (see proxy.ts / tenant-routing.ts), but the browser URL — and any client-side
  // navigation from a `<Link>` — must use the public `/manage/...` form (slug is in the
  // hostname, not the path). Linking to `/s/${slug}/manage/...` here would double-prefix on
  // the next request and 404.
  const checklist = [
    { done: levels.length > 0, label: t('setupSkill'), href: '/manage/skill-levels' },
    { done: boats.some((b) => b.active), label: t('setupBoats'), href: '/manage/boats' },
    { done: Boolean(club.tagline || club.description), label: t('setupProfile'), href: '/manage/profile' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('setupTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('setupIntro')}</p>
      </div>
      <ul className="divide-y rounded-lg border">
        {checklist.map((item) => (
          <li key={item.href} className="flex items-center justify-between p-3">
            <span className="flex items-center gap-2">
              <span aria-hidden className={item.done ? 'text-brand' : 'text-muted-foreground'}>{item.done ? '✓' : '○'}</span>
              <span className={item.done ? 'text-muted-foreground line-through' : 'font-medium'}>{item.label}</span>
            </span>
            <Link href={item.href} className="text-sm text-primary hover:underline">
              {item.done ? t('setupDone') : t('setupTodo')}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
