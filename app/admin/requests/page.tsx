import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AdminPagination } from '@/components/admin-pagination';
import { StatusPill } from '@/components/booking-status-badge';
import { Card } from '@/components/ui/card';
import { db } from '@/db';
import { CLUB_REQUESTS_PAGE_SIZE, listPendingClubRequests } from '@/lib/clubs-admin';
import { normalizePage } from '@/lib/pagination';
import { one } from '@/lib/search-params';

import { DecisionButtons } from './decision-buttons';

export const metadata = { robots: { index: false, follow: false } };

/**
 * The club-request queue, and the only place in the application where a request can be
 * decided at all.
 *
 * It used to approve with `<ClubStatusButton targetStatus="active">` — the very control
 * the clubs list uses to un-suspend — which is what made a brand-new club and a
 * reinstated one indistinguishable in the audit log (spec §5.3). `setClubStatus` now
 * refuses a `pending` club outright, so that button was hidden rather than left showing
 * an operative-looking approve path that could only fail. `DecisionButtons` replaces it,
 * backed by `decideClubRequest`, which writes `club.approve` / `club.reject` and stamps
 * the reviewer.
 *
 * Paged like every other list in the console, and for the sharpest version of the same
 * reason: nothing expires a `pending` request, nothing but a human decides one, and
 * signup is open — so this list can grow without bound, and every row mounts a client
 * component with its own `useActionState` and `Dialog`. Rendering all of it would leave
 * the §6.4 defect on the one page an admin has to load to clear the backlog.
 */
export default async function AdminClubRequestsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('admin');
  // `listPendingClubRequests` clamps again on its own — a route-only guard does nothing
  // for a direct call — but a nonsense `?page` should not leave the route either.
  const requestedPage = normalizePage(one(sp.page));
  // `page` is what came BACK: the library pulls an out-of-range page down to the last
  // one that exists, and the row range and the links have to describe the rows on screen.
  const { rows, total, page } = await listPendingClubRequests(db, {
    page: requestedPage,
    pageSize: CLUB_REQUESTS_PAGE_SIZE,
  });
  if (total === 0) return <p className="text-muted-foreground">{t('noRequests')}</p>;
  const from = (page - 1) * CLUB_REQUESTS_PAGE_SIZE + 1;
  const to = Math.min(page * CLUB_REQUESTS_PAGE_SIZE, total);

  return (
    <>
      <Card className="gap-0 divide-y divide-border py-0">
        {rows.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex flex-col gap-0.5">
              <Link href={`/admin/clubs/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
              <span className="text-sm text-muted-foreground">{c.slug}</span>
              <span className="text-xs text-muted-foreground">
                {/* `clubs.created_by` is `on delete set null` — a request whose requester
                    deleted their account is still a request, and must still be decidable.
                    Keyed on the email rather than the name because a deleted account
                    leaves both null, and an empty "Requested by" line reads as a bug. */}
                {c.requesterEmail
                  ? t('requestBy', { name: `${c.requesterName ?? ''} <${c.requesterEmail}>`.trim() })
                  : t('requestByUnknown')}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <StatusPill tone="warn">{t('statusPending')}</StatusPill>
              <DecisionButtons clubId={c.id} clubName={c.name} />
            </div>
          </div>
        ))}
      </Card>

      <AdminPagination
        basePath="/admin/requests"
        query={{}}
        page={page}
        pageSize={CLUB_REQUESTS_PAGE_SIZE}
        total={total}
        prevLabel={t('paginationPrev')}
        nextLabel={t('paginationNext')}
        rangeLabel={t('paginationRange', { from, to, total })}
      />
    </>
  );
}
