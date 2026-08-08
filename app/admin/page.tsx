import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AdminPagination } from '@/components/admin-pagination';
import { type BadgeTone, StatusPill } from '@/components/booking-status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { type AdminClubRow, CLUBS_PAGE_SIZE, listClubsForAdmin } from '@/lib/clubs-admin';
import { normalizePage } from '@/lib/pagination';
import { one } from '@/lib/search-params';

import { ClubStatusButton } from './club-status-button';
import { CreatedToast } from './created-toast';

// The one console route that was still missing this, while `/admin/users`,
// `/admin/audit`, `/admin/requests` and `/admin/clubs/[id]` all declare it. It matters
// more now that the page carries a `?q=` search over club names.
export const metadata = { robots: { index: false, follow: false } };

// Keyed by the enum rather than by `string`, so a new `club_status` value is a type
// error here instead of an unlabelled empty pill on this page.
type ClubStatus = AdminClubRow['status'];

const toneByStatus: Record<ClubStatus, BadgeTone> = {
  active: 'ok',
  pending: 'warn',
  suspended: 'bad',
  // A rejected request is inert, not broken — it reads differently from a
  // suspended club, which is live-but-blocked.
  rejected: 'neutral',
};

export default async function AdminClubsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('admin');
  const q = one(sp.q)?.trim() || undefined;
  // This page used to run `db.select().from(clubs)` with no limit at all (spec §6.4).
  // It is now paged, and `?page=1.5` / `Infinity` / `1e20` are normalized here before
  // they can reach `OFFSET` as a `bigint` — `listClubsForAdmin` clamps again on its
  // own, but a nonsense value should not leave the route in the first place.
  const requestedPage = normalizePage(one(sp.page));
  // `page` is what came BACK, not what was asked for: the library pulls an
  // out-of-range page down to the last one that exists, and the range below plus the
  // pagination links have to describe the page the rows actually came from.
  const { rows, total, page } = await listClubsForAdmin(db, { q, page: requestedPage, pageSize: CLUBS_PAGE_SIZE });
  const from = total === 0 ? 0 : (page - 1) * CLUBS_PAGE_SIZE + 1;
  const to = Math.min(page * CLUBS_PAGE_SIZE, total);

  const statusLabel: Record<ClubStatus, string> = {
    active: t('statusActive'), pending: t('statusPending'), suspended: t('statusSuspended'),
    rejected: t('statusRejected'),
  };

  return (
    <>
      <CreatedToast created={one(sp.created) === '1'} />
      {/* A plain GET form, so the search lands in the URL and is shareable. The submit
          is a plain Button, not PendingButton: `useFormStatus` reports nothing for a
          browser navigation, so it would render a control that never shows progress. */}
      <form method="get" action="/admin" className="mb-6 flex gap-2">
        <Input name="q" defaultValue={q ?? ''} placeholder={t('clubsSearch')} aria-label={t('clubsSearch')} />
        <Button type="submit" size="sm">{t('clubsSearchCta')}</Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('noClubs')}</p>
      ) : (
        <Card className="gap-0 divide-y divide-border py-0">
          {rows.map((c) => {
            const isActive = c.status === 'active';
            // Only a DECIDED club gets the suspend/reinstate toggle. `setClubStatus`
            // refuses `pending` and `rejected` outright (spec §5.3), so offering
            // "Activate" on those rows would be an un-reject button that always
            // errors — and on a rejected row whose slug a live club has since taken,
            // one that could only ever collide with `clubs_slug_uq`. A request is
            // decided in the requests queue, not here.
            const canToggleStatus = isActive || c.status === 'suspended';
            return (
              <div key={c.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex flex-col gap-0.5">
                  <Link href={`/admin/clubs/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                  <span className="text-sm text-muted-foreground">{c.slug}</span>
                  <span className="text-xs text-muted-foreground">{t('clubsMemberCount', { count: c.memberCount })}</span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill tone={toneByStatus[c.status]}>{statusLabel[c.status]}</StatusPill>
                  {canToggleStatus ? (
                    <ClubStatusButton
                      clubId={c.id}
                      clubName={c.name}
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

      <AdminPagination
        basePath="/admin"
        query={{ q }}
        page={page}
        pageSize={CLUBS_PAGE_SIZE}
        total={total}
        prevLabel={t('paginationPrev')}
        nextLabel={t('paginationNext')}
        rangeLabel={t('paginationRange', { from, to, total })}
      />
    </>
  );
}
