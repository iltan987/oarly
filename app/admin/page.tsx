import { desc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { clubs } from '@/db/schema';

import { setClubStatusAction } from './actions';

export default async function AdminClubsPage() {
  const t = await getTranslations('admin');
  const rows = await db.select().from(clubs).orderBy(desc(clubs.createdAt));
  const statusLabel: Record<string, string> = {
    active: t('statusActive'), pending: t('statusPending'), suspended: t('statusSuspended'),
  };
  if (rows.length === 0) return <p className="text-muted-foreground">{t('noClubs')}</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((c) => {
        const isActive = c.status === 'active';
        return (
          <li key={c.id} className="flex items-center justify-between p-3">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-sm text-muted-foreground">{c.slug} · {statusLabel[c.status]}</div>
            </div>
            <form action={setClubStatusAction}>
              <input type="hidden" name="clubId" value={c.id} />
              <input type="hidden" name="status" value={isActive ? 'suspend' : 'active'} />
              <button type="submit" className="text-sm text-muted-foreground hover:underline">
                {isActive ? t('suspend') : t('activate')}
              </button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
