import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AdminPagination } from '@/components/admin-pagination';
import { type BadgeTone, StatusPill } from '@/components/booking-status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
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
      {/* "New club" was a fifth nav tab until Task 9. A nav names places you can be, and
          creating a club is something you do TO the list you are already looking at — so
          it sits beside the search, on the page it acts on, and both consoles are left
          with four destinations.

          The form is a plain GET, so the search lands in the URL and is shareable. Its
          submit is a plain Button, not PendingButton: `useFormStatus` reports nothing for
          a browser navigation, so it would render a control that never shows progress. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {/* `max-w-md`, not `flex-1` alone: the console canvas is 1024px wide at `lg:`, and
            an unbounded input turned all of it into one box for a 20-character club name.
            `flex-1` still lets it take the row below `md`, where the cap is inert. */}
        <form method="get" action="/admin" className="flex min-w-0 max-w-md flex-1 gap-2">
          <Input name="q" defaultValue={q ?? ''} placeholder={t('clubsSearch')} aria-label={t('clubsSearch')} />
          <Button type="submit" size="sm">{t('clubsSearchCta')}</Button>
        </form>
        {/* A LINK wearing the button's clothes — `buttonVariants`, not `<Button render={
            <Link/>}>`. This control navigates; it does not act. It must announce as a link,
            keep the browser's open-in-new-tab and copy-address affordances, and be in the
            links list of a screen reader.

            Both Base UI shapes get that wrong, and the second one only looked right:
            `<Button render={<Link/>}>` logs "expected a native <button>" on every render,
            and `nativeButton={false}` silences that by stamping `role="button"` onto the
            <a> — which trades a dev-console line for a real accessibility change, turning
            the create-club link into a button that happens to have an href. This call site
            shipped in the second shape until `app/admin/page.test.tsx`'s
            `getByRole('link')` refused to find it.

            Composing the variants directly involves no Base UI component at all, so there
            is nothing to warn and nothing to re-role. */}
        <Link href="/admin/clubs/new" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('newClub')}
        </Link>
      </div>

      {rows.length === 0 ? (
        // Two different facts, two different sentences. "No clubs yet." under a search
        // that matched nothing is a flat false statement about a platform with hundreds
        // of clubs — and `/admin/users`, one nav tab away, already gets this right.
        <p className="text-muted-foreground">{q ? t('clubsNoMatch') : t('noClubs')}</p>
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
              /*
                Below `lg:` this is unchanged: a stacked identity on the left, status and
                action on the right. At `lg:` the stack UN-stacks into four columns, so
                name, slug, member count, status and control each share one left edge down
                the whole page — the alignment the canvas width buys, in the shape
                `/manage/members` established. `1fr` absorbs every difference in club-name
                length, so the three fixed columns to its right cannot drift.

                All three of them ARE fixed, and the last one is fixed for a measured
                reason. Each row is its own grid — the Card is not one — so an `auto` last
                track is sized by that ROW's content, and the status pill plus the toggle
                is 85.5px on a pending club, 135.8px on an active one and 155.3px on a
                suspended one (171.1px in English). `1fr` then absorbs the difference and
                every column except the first lands somewhere else on every row: measured
                at 1440px, a 69.766px spread down columns 2, 3 and 4. `12rem` is the widest
                of those rounded up, and takes the spread to 0.000px.

                `lg:contents` on the identity wrapper is what makes that possible: a grid
                only lays out its OWN children, so without it the three spans stay a stack
                in column 1 and the status/action pair sits in column 2, leaving `7rem` and
                `auto` empty and the page looking exactly as it did before. Pinned in
                page.test.tsx for that reason — the grid template alone cannot show it.
              */
              <div key={c.id} className="flex items-center justify-between gap-3 p-4 lg:grid lg:grid-cols-[1fr_9rem_7rem_12rem] lg:items-center lg:gap-4">
                <div className="flex min-w-0 flex-col gap-0.5 lg:contents">
                  <Link href={`/admin/clubs/${c.id}`} className="min-w-0 font-medium break-words hover:underline">{c.name}</Link>
                  <span className="min-w-0 text-sm break-words text-muted-foreground">{c.slug}</span>
                  <span className="text-xs text-muted-foreground">{t('clubsMemberCount', { count: c.memberCount })}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
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
