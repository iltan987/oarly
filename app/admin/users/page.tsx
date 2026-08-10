import { getTranslations } from 'next-intl/server';

import { AdminPagination } from '@/components/admin-pagination';
import { StatusPill } from '@/components/booking-status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { normalizePage } from '@/lib/pagination';
import { one } from '@/lib/search-params';
import { searchUsers, type UserMembershipSummary, USERS_PAGE_SIZE } from '@/lib/users-admin';

import { AdminToggle } from './admin-toggle';

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminUsersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('admin');
  const q = one(sp.q)?.trim() || undefined;
  // `?page=1.5` reached `OFFSET` as `12.5` and raised `invalid input syntax for type
  // bigint` out of the render — the same hand-edited-URL 500 `/admin/audit` fixed in
  // its cursor. `searchUsers` clamps again on its own; this keeps a nonsense value
  // from ever leaving the route.
  const requestedPage = normalizePage(one(sp.page));
  // `page` is what came BACK, not what was asked for: the library pulls an
  // out-of-range page down to the last one that exists, and the range below plus the
  // pagination links have to describe the page the rows actually came from.
  const { rows, total, page } = await searchUsers(db, { q, page: requestedPage, pageSize: USERS_PAGE_SIZE });
  const from = total === 0 ? 0 : (page - 1) * USERS_PAGE_SIZE + 1;
  const to = Math.min(page * USERS_PAGE_SIZE, total);

  // Each membership line used to render `{m.role} / {m.status}` — the raw Postgres
  // enums. A Turkish operator read "Kayıkhane — owner / approved" on an otherwise
  // fully Turkish page, and these were the only hardcoded user-visible strings in
  // app/admin. Keyed by the union rather than by `string`, so a new
  // `membership_role` or `membership_status` value is a type error here instead of
  // another untranslated word on the page.
  const roleLabel: Record<UserMembershipSummary['role'], string> = {
    // `owner` is a CLUB owner and `admin` is a PLATFORM admin — two different
    // authorities that Turkish rendered with one noun (`yönetici`) until this cycle.
    owner: t('roleOwner'), member: t('roleMember'), admin: t('roleAdmin'),
  };
  const memberStatusLabel: Record<UserMembershipSummary['status'], string> = {
    pending: t('memberStatusPending'), approved: t('memberStatusApproved'),
    rejected: t('memberStatusRejected'), banned: t('memberStatusBanned'),
  };

  return (
    <>
      {/* A plain GET form, so the search lands in the URL and is shareable. The submit
          is a plain Button, not PendingButton: `useFormStatus` reports nothing for a
          browser navigation, so it would render a control that never shows progress. */}
      {/* `max-w-md` for the same reason as `/admin` and `/manage/members`: without it the
          <Input> grows to the whole 1024px canvas for a name-or-email search. */}
      <form method="get" action="/admin/users" className="mb-6 flex max-w-md gap-2">
        <Input name="q" defaultValue={q ?? ''} placeholder={t('usersSearch')} aria-label={t('usersSearch')} />
        <Button type="submit" size="sm">{t('usersSearchCta')}</Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('usersEmpty')}</p>
      ) : (
        <Card className="gap-0 divide-y divide-border py-0">
          {rows.map((u) => (
            /*
              The memberships list is the tallest thing on this page — a user in six clubs
              is six lines — and below `lg:` it sits UNDER the identity, so every row is as
              tall as its longest club list. At `lg:` it moves BESIDE the identity in a
              `1fr` column, which is roughly 40% off the height of the page with nothing
              removed and no row truncated.

              `lg:contents` on the identity wrapper is what promotes its two children into
              the row's grid; without it they stay one stacked cell in the `18rem` column
              and the layout is unchanged, which is why it is pinned in page.test.tsx
              rather than left to the grid template. The `18rem` first column is the fixed
              one, so the club lists share a left edge down the whole page however long a
              name or an email is.

              The LAST track is fixed too, and for a measured reason: each row is its own
              grid, so an `auto` there is sized by that row's own toggle — 93.9px for "make
              admin" and 122.2px for "remove admin" — and `1fr` absorbs the difference, so
              the toggle column lands somewhere else on the rows that already have an admin
              (a 28.297px spread at 1440px). `9rem` is the widest of those rounded up and
              takes it to 0.000px.
            */
            <div key={u.id} className="flex flex-wrap items-start justify-between gap-3 p-4 lg:grid lg:grid-cols-[18rem_1fr_9rem] lg:items-start lg:gap-4">
              <div className="flex min-w-0 flex-col gap-1 lg:contents">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-2 font-medium">
                    {u.name}
                    {u.isAdmin && <StatusPill tone="accent">{t('usersAdminBadge')}</StatusPill>}
                  </span>
                  <span className="text-sm break-words text-muted-foreground">{u.email}</span>
                </div>
                {/*
                  Its own cell in BOTH branches, so a user in no club leaves the column
                  empty rather than collapsing the row to two columns and pulling the
                  admin toggle left on exactly the rows that read as ordinary — the defect
                  `/manage/members` fixed for its status cell.
                */}
                {u.memberships.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t('usersNoMemberships')}</span>
                ) : (
                  <ul className="min-w-0 text-xs break-words text-muted-foreground">
                    {u.memberships.map((m) => (
                      <li key={m.clubId}>{m.clubName} — {roleLabel[m.role]} / {memberStatusLabel[m.status]}</li>
                    ))}
                  </ul>
                )}
              </div>
              <AdminToggle userId={u.id} userName={u.name} isAdmin={u.isAdmin} />
            </div>
          ))}
        </Card>
      )}

      <AdminPagination
        basePath="/admin/users"
        query={{ q }}
        page={page}
        pageSize={USERS_PAGE_SIZE}
        total={total}
        prevLabel={t('paginationPrev')}
        nextLabel={t('paginationNext')}
        rangeLabel={t('paginationRange', { from, to, total })}
      />
    </>
  );
}
