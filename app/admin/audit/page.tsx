import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { db } from '@/db';
import { type AuditCursor, listAuditRows } from '@/lib/audit';

import { AuditFilters } from './audit-filters';
import { AuditTable } from './audit-table';

export const metadata = { robots: { index: false, follow: false } };

/**
 * The console is platform-wide, so a single operator timezone is used for every
 * row rather than the club's own — the rows of one page can belong to many clubs,
 * and a list whose timestamps are each in a different zone cannot be read in order.
 */
const ADMIN_TIME_ZONE = 'Europe/Istanbul';

/** `<createdAtISO>~<uuid>`. `~` cannot appear in either half, so a single split is unambiguous. */
function parseCursor(raw: string | undefined): AuditCursor | null {
  if (!raw) return null;
  const sep = raw.indexOf('~');
  if (sep < 0) return null;
  const when = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(when.getTime()) || !id) return null;
  return { createdAt: when, id };
}

export default async function AdminAuditPage({ searchParams }: {
  searchParams: Promise<{ clubId?: string; actorUserId?: string; action?: string; cursor?: string; reset?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('admin');
  const locale = await getLocale();
  // "Clear" is a submit inside the filter form, so the browser still sends the old
  // field values alongside `reset=1`. Ignoring them here is what makes the button work.
  const reset = sp.reset === '1';
  const clubId = reset ? undefined : sp.clubId?.trim() || undefined;
  const actorUserId = reset ? undefined : sp.actorUserId?.trim() || undefined;
  const actionPrefix = reset ? undefined : sp.action?.trim() || undefined;
  const cursor = reset ? null : parseCursor(sp.cursor);

  const { rows, nextCursor } = await listAuditRows(db, {
    filters: { clubId, actorUserId, actionPrefix },
    cursor,
  });

  const query = new URLSearchParams();
  if (clubId) query.set('clubId', clubId);
  if (actorUserId) query.set('actorUserId', actorUserId);
  if (actionPrefix) query.set('action', actionPrefix);
  const firstHref = `/admin/audit${query.toString() ? `?${query}` : ''}`;
  const nextQuery = new URLSearchParams(query);
  if (nextCursor) nextQuery.set('cursor', `${nextCursor.createdAt.toISOString()}~${nextCursor.id}`);

  return (
    <>
      <AuditFilters clubId={clubId} actorUserId={actorUserId} actionPrefix={actionPrefix} />
      <AuditTable
        rows={rows}
        locale={locale}
        timeZone={ADMIN_TIME_ZONE}
        labels={{
          when: t('auditWhen'), actor: t('auditActor'), club: t('auditClub'),
          action: t('auditAction'), target: t('auditTarget'),
          empty: t('auditEmpty'), unknown: t('auditUnknown'),
        }}
      />
      <div className="mt-4 flex justify-between">
        {/* Rendered only when we are actually past the head: a "Newest" control on
            the newest page is a link to the page you are already on. */}
        {cursor ? (
          <Button size="sm" variant="ghost" render={<Link href={firstHref} />}>{t('auditFirst')}</Button>
        ) : <span />}
        {nextCursor && (
          <Button size="sm" variant="ghost" render={<Link href={`/admin/audit?${nextQuery}`} />}>
            {t('auditNext')}
          </Button>
        )}
      </div>
    </>
  );
}
