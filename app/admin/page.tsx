import { getTranslations } from 'next-intl/server';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { clubs } from '@/db/schema';

export default async function AdminClubsPage() {
  const t = await getTranslations('admin');
  const rows = await db.select().from(clubs).orderBy(desc(clubs.createdAt));
  const statusLabel: Record<string, string> = {
    active: t('statusActive'), pending: t('statusPending'), suspended: t('statusSuspended'),
  };
  if (rows.length === 0) return <p className="text-muted-foreground">{t('noClubs')}</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((c) => (
        <li key={c.id} className="flex items-center justify-between p-3">
          <div>
            <div className="font-medium">{c.name}</div>
            <div className="text-sm text-muted-foreground">{c.slug} · {statusLabel[c.status]}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
