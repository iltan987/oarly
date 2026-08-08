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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `<createdAtISO>~<uuid>`. `~` cannot appear in either half, so a single split is
 * unambiguous.
 *
 * The id half is bound into `… < ($ts, $id::uuid)`, so it is checked for uuid SHAPE
 * here rather than handed to Postgres to reject: `?cursor=…~abc` otherwise raises
 * `invalid input syntax for type uuid` from inside the render, which reaches the
 * user as a 500 on a URL anyone can hand-edit. A cursor that cannot be trusted is
 * not an error condition — it just means "start at the newest page".
 */
function parseCursor(raw: string | undefined): AuditCursor | null {
  if (!raw) return null;
  const sep = raw.indexOf('~');
  if (sep < 0) return null;
  const when = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(when.getTime()) || !UUID_RE.test(id)) return null;
  return { createdAt: when, id };
}

/**
 * Any query parameter can repeat — `?clubId=a&clubId=b` arrives as an array, and
 * every filter on this page is read with a string method, so an unguarded value
 * throws a TypeError out of the render before a row is ever fetched. First
 * occurrence wins, matching `URLSearchParams.get`, which is what builds these
 * links on the way back out.
 */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminAuditPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('admin');
  const locale = await getLocale();
  // "Clear" is a submit inside the filter form, so the browser still sends the old
  // field values alongside `reset=1`. Ignoring them here is what makes the button work.
  const reset = one(sp.reset) === '1';
  const clubId = reset ? undefined : one(sp.clubId)?.trim() || undefined;
  const actorUserId = reset ? undefined : one(sp.actorUserId)?.trim() || undefined;
  const actionPrefix = reset ? undefined : one(sp.action)?.trim() || undefined;
  const cursor = reset ? null : parseCursor(one(sp.cursor));

  // `clubId` is bound into `club_id = $1` against a `uuid` column, so a value that is
  // not uuid-shaped raises `invalid input syntax for type uuid` out of the render —
  // and unlike the cursor, this one is a free-text `<Input>` an operator types into,
  // so `abc` was a 500 on the ordinary path. The query is skipped rather than the
  // filter dropped: dropping it would answer "which rows belong to club abc" with the
  // entire unfiltered log, which is a worse answer than none.
  const clubIdIsUsable = clubId === undefined || UUID_RE.test(clubId);
  const { rows, nextCursor } = clubIdIsUsable
    ? await listAuditRows(db, { filters: { clubId, actorUserId, actionPrefix }, cursor })
    : { rows: [], nextCursor: null };

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
