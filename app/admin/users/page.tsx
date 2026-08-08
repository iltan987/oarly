import { getTranslations } from 'next-intl/server';

import { AdminPagination } from '@/components/admin-pagination';
import { StatusPill } from '@/components/booking-status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { searchUsers, USERS_PAGE_SIZE } from '@/lib/users-admin';

import { AdminToggle } from './admin-toggle';

export const metadata = { robots: { index: false, follow: false } };

/**
 * Any query parameter can repeat — `?q=a&q=b` arrives as an array, and every value
 * here is read with a string method, so an unguarded value throws a TypeError out of
 * the render before a row is fetched. First occurrence wins, matching
 * `URLSearchParams.get`, which is what builds these links on the way back out.
 */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminUsersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('admin');
  const q = one(sp.q)?.trim() || undefined;
  const page = Math.max(1, Number(one(sp.page) ?? '1') || 1);
  const { rows, total } = await searchUsers(db, { q, page, pageSize: USERS_PAGE_SIZE });
  const from = total === 0 ? 0 : (page - 1) * USERS_PAGE_SIZE + 1;
  const to = Math.min(page * USERS_PAGE_SIZE, total);

  return (
    <>
      {/* A plain GET form, so the search lands in the URL and is shareable. The submit
          is a plain Button, not PendingButton: `useFormStatus` reports nothing for a
          browser navigation, so it would render a control that never shows progress. */}
      <form method="get" action="/admin/users" className="mb-6 flex gap-2">
        <Input name="q" defaultValue={q ?? ''} placeholder={t('usersSearch')} aria-label={t('usersSearch')} />
        <Button type="submit" size="sm">{t('usersSearchCta')}</Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('usersEmpty')}</p>
      ) : (
        <Card className="gap-0 divide-y divide-border py-0">
          {rows.map((u) => (
            <div key={u.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 font-medium">
                  {u.name}
                  {u.isAdmin && <StatusPill tone="accent">{t('usersAdminBadge')}</StatusPill>}
                </span>
                <span className="text-sm text-muted-foreground">{u.email}</span>
                {u.memberships.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t('usersNoMemberships')}</span>
                ) : (
                  <ul className="text-xs text-muted-foreground">
                    {u.memberships.map((m) => (
                      <li key={m.clubId}>{m.clubName} — {m.role} / {m.status}</li>
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
