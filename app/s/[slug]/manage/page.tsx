import { Check, Circle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { db } from '@/db';
import { listBoats } from '@/lib/boats';
import { requireOwner } from '@/lib/membership';
import { listWindowsWithBoats } from '@/lib/schedule';
import { listSkillLevels } from '@/lib/skill-levels';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ManageOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug);
  const t = await getTranslations('manage');
  const [levels, boats, windows] = await Promise.all([
    listSkillLevels(db, club.id),
    listBoats(db, club.id),
    listWindowsWithBoats(db, club.id),
  ]);

  // Public-facing links: the tenant subdomain rewrites `/manage/...` to `/s/{slug}/manage/...`
  // internally (see proxy.ts / tenant-routing.ts), but the browser URL — and any client-side
  // navigation from a `<Link>` — must use the public `/manage/...` form (slug is in the
  // hostname, not the path). Linking to `/s/${slug}/manage/...` here would double-prefix on
  // the next request and 404.
  const checklist = [
    { done: levels.length > 0, label: t('setupSkill'), href: '/manage/skill-levels' },
    { done: boats.some((b) => b.active), label: t('setupBoats'), href: '/manage/boats' },
    { done: windows.length > 0, label: t('setupSchedule'), href: '/manage/schedule' },
    { done: Boolean(club.tagline || club.description), label: t('setupProfile'), href: '/manage/profile' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('setupTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('setupIntro')}</p>
      </div>
      <Card size="sm">
        <CardContent className="flex flex-col divide-y divide-border p-0">
          {checklist.map((item) => (
            <div key={item.href} className="flex items-center justify-between gap-3 p-3 first:pt-0 last:pb-0">
              <span className="flex items-center gap-2">
                {item.done
                  ? <Check aria-hidden className="size-4 shrink-0 text-ok" />
                  : <Circle aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
                <span className={item.done ? 'text-muted-foreground line-through' : 'font-medium'}>{item.label}</span>
              </span>
              <Button size="sm" variant={item.done ? 'ghost' : 'outline'} render={<Link href={item.href} />}>
                {item.done ? t('setupDone') : t('setupTodo')}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
