import { desc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { type BadgeTone, StatusPill } from '@/components/booking-status-badge';
import { Card } from '@/components/ui/card';
import { db } from '@/db';
import { clubs } from '@/db/schema';

import { ClubStatusButton } from './club-status-button';
import { CreatedToast } from './created-toast';

// Keyed by the enum rather than by `string`, so a new `club_status` value is a type
// error here instead of an unlabelled empty pill on this page.
type ClubStatus = typeof clubs.$inferSelect['status'];

const toneByStatus: Record<ClubStatus, BadgeTone> = {
  active: 'ok',
  pending: 'warn',
  suspended: 'bad',
  // A rejected request is inert, not broken — it reads differently from a
  // suspended club, which is live-but-blocked.
  rejected: 'neutral',
};

export default async function AdminClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const { created } = await searchParams;
  const t = await getTranslations('admin');
  const rows = await db.select().from(clubs).orderBy(desc(clubs.createdAt));
  const statusLabel: Record<ClubStatus, string> = {
    active: t('statusActive'), pending: t('statusPending'), suspended: t('statusSuspended'),
    rejected: t('statusRejected'),
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
            // Only a DECIDED club gets the suspend/reinstate toggle. `setClubStatus`
            // now refuses `pending` and `rejected` outright (spec §5.3), so offering
            // "Activate" on those rows would be an un-reject button that always
            // errors — and on a rejected row whose slug a live club has since taken,
            // one that could only ever collide with `clubs_slug_uq`. A request is
            // decided in the requests queue, not here.
            const canToggleStatus = isActive || c.status === 'suspended';
            return (
              <div key={c.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm text-muted-foreground">{c.slug}</span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill tone={toneByStatus[c.status]}>{statusLabel[c.status]}</StatusPill>
                  {canToggleStatus ? (
                    <ClubStatusButton
                      clubId={c.id}
                      targetStatus={isActive ? 'suspended' : 'active'}
                      label={isActive ? t('suspend') : t('activate')}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}
