import { desc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { clubs } from '@/db/schema';

import { setClubStatusAction } from '../actions';

export default async function AdminClubRequestsPage() {
  const t = await getTranslations('admin');
  const rows = await db.select().from(clubs).where(eq(clubs.status, 'pending')).orderBy(desc(clubs.createdAt));
  if (rows.length === 0) return <p className="text-muted-foreground">{t('noRequests')}</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((c) => (
        <li key={c.id} className="flex items-center justify-between p-3">
          <div>
            <div className="font-medium">{c.name}</div>
            <div className="text-sm text-muted-foreground">{c.slug}</div>
          </div>
          <form action={setClubStatusAction}>
            <input type="hidden" name="clubId" value={c.id} />
            <input type="hidden" name="status" value="active" />
            <button type="submit" className="text-sm text-muted-foreground hover:underline">
              {t('activate')}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
