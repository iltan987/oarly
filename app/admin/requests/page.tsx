import { desc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { StatusPill } from '@/components/booking-status-badge';
import { Card } from '@/components/ui/card';
import { db } from '@/db';
import { clubs } from '@/db/schema';

import { ClubStatusButton } from '../club-status-button';

export default async function AdminClubRequestsPage() {
  const t = await getTranslations('admin');
  const rows = await db.select().from(clubs).where(eq(clubs.status, 'pending')).orderBy(desc(clubs.createdAt));
  if (rows.length === 0) return <p className="text-muted-foreground">{t('noRequests')}</p>;
  return (
    <Card className="gap-0 divide-y divide-border py-0">
      {rows.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 p-4">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{c.name}</span>
            <span className="text-sm text-muted-foreground">{c.slug}</span>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill tone="warn">{t('statusPending')}</StatusPill>
            <ClubStatusButton clubId={c.id} targetStatus="active" label={t('activate')} />
          </div>
        </div>
      ))}
    </Card>
  );
}
