import { desc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { type BadgeTone, StatusPill } from '@/components/booking-status-badge';
import { Card } from '@/components/ui/card';
import { db } from '@/db';
import { clubs } from '@/db/schema';

import { ClubStatusButton } from './club-status-button';
import { CreatedToast } from './created-toast';

const toneByStatus: Record<string, BadgeTone> = {
  active: 'ok',
  pending: 'warn',
  suspended: 'bad',
};

export default async function AdminClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const { created } = await searchParams;
  const t = await getTranslations('admin');
  const rows = await db.select().from(clubs).orderBy(desc(clubs.createdAt));
  const statusLabel: Record<string, string> = {
    active: t('statusActive'), pending: t('statusPending'), suspended: t('statusSuspended'),
  };
  return (
    <>
      <CreatedToast created={created === '1'} />
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('noClubs')}</p>
      ) : (
        <Card className="gap-0 divide-y divide-border py-0">
          {rows.map((c) => {
            const isActive = c.status === 'active';
            return (
              <div key={c.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm text-muted-foreground">{c.slug}</span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill tone={toneByStatus[c.status] ?? 'neutral'}>{statusLabel[c.status]}</StatusPill>
                  <ClubStatusButton
                    clubId={c.id}
                    targetStatus={isActive ? 'suspended' : 'active'}
                    label={isActive ? t('suspend') : t('activate')}
                  />
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}
