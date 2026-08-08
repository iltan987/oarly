import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { type BadgeTone, StatusPill } from '@/components/booking-status-badge';
import { Card } from '@/components/ui/card';
import { db } from '@/db';
import type { clubs } from '@/db/schema';
import { listAuditRows } from '@/lib/audit';
import { getClubAdminDetail } from '@/lib/clubs-admin';
import { isUuid } from '@/lib/uuid';

import { AuditTable } from '../../audit/audit-table';
import { ClubStatusButton } from '../../club-status-button';
import { TransferOwner } from './transfer-owner';

export const metadata = { robots: { index: false, follow: false } };

/** The last N audit rows for this club — `audit_log_club_created_at_id_idx` serves it. */
const AUDIT_ROWS = 20;

// Keyed by the enum rather than by `string`, so a new `club_status` value is a type
// error here instead of an unlabelled empty pill on this page.
type ClubStatus = typeof clubs.$inferSelect['status'];

const toneByStatus: Record<ClubStatus, BadgeTone> = {
  active: 'ok', pending: 'warn', suspended: 'bad', rejected: 'neutral',
};

/**
 * Keyed by ID, not slug (spec §6.1). Slug uniqueness is a PARTIAL index that exempts
 * rejected rows, so a rejected club and a live club can legitimately share a slug —
 * a slug-keyed route would be ambiguous for exactly the clubs an admin most needs to
 * inspect. `clubs.id` is a uuid primary key and always resolves to one row.
 */
export default async function AdminClubDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Shape FIRST, existence second — they are two different failures and only the
  // second one is survivable inside the query. `id` is bound into `clubs.id = $1`
  // against a uuid PRIMARY KEY, so `/admin/clubs/foo` raised
  // `invalid input syntax for type uuid: "foo"` (22P02) out of the render as a 500,
  // and `listAuditRows({ clubId: 'foo' })` below raised it identically. Both are a
  // 404 here: a string that cannot be a club id names no club, which is exactly what
  // a well-formed id matching nothing means. (`/admin/audit` renders an EMPTY list
  // for the same bad input instead, because there the id is a filter over a log that
  // still exists — dropping or 404ing a filter would be the wrong answer there.)
  if (!isUuid(id)) notFound();

  const detail = await getClubAdminDetail(db, id);
  // A stale or guessed-but-well-formed id is the second case: `getClubAdminDetail`
  // returns null rather than throwing precisely so this stays a routing decision.
  if (!detail) notFound();

  const t = await getTranslations('admin');
  const locale = await getLocale();
  // Club-scoped on purpose: `audit_log_club_created_at_id_idx` exists for this exact
  // call, and an unfiltered read here would merge every club's history.
  const { rows } = await listAuditRows(db, { filters: { clubId: id }, limit: AUDIT_ROWS });

  const statusLabel: Record<ClubStatus, string> = {
    active: t('statusActive'), pending: t('statusPending'),
    suspended: t('statusSuspended'), rejected: t('statusRejected'),
  };
  const { club } = detail;
  const decided = club.status === 'active' || club.status === 'suspended';

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin" className="text-sm text-brand hover:underline">{t('detailBack')}</Link>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-heading text-lg font-semibold">{club.name}</span>
            <span className="text-sm text-muted-foreground">{club.slug}</span>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill tone={toneByStatus[club.status]}>{statusLabel[club.status]}</StatusPill>
            {/* Only a DECIDED club can be suspended or reinstated — a pending one is
                decided on /admin/requests, and a rejection is final (spec §5.3). */}
            {decided && (
              <ClubStatusButton
                clubId={club.id}
                clubName={club.name}
                targetStatus={club.status === 'active' ? 'suspended' : 'active'}
                label={club.status === 'active' ? t('suspend') : t('activate')}
              />
            )}
          </div>
        </div>
        {detail.reviewedByName && (
          <p className="text-xs text-muted-foreground">{t('detailReviewedBy', { name: detail.reviewedByName })}</p>
        )}
        {club.reviewNote && (
          <p className="text-sm">
            <span className="text-muted-foreground">{t('detailReviewNote')}: </span>
            {club.reviewNote}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="font-heading text-sm font-semibold">{t('detailOwners')}</h2>
        {detail.owners.length === 0 ? (
          // The exact hole this page closes: a club whose owner left could not be
          // reassigned by anyone before `transferOwnership` existed (spec §6.3).
          <p className="text-sm text-muted-foreground">{t('detailNoOwner')}</p>
        ) : (
          <ul className="text-sm">
            {detail.owners.map((o) => <li key={o.userId}>{o.name} — {o.email}</li>)}
          </ul>
        )}
        <h2 className="mt-3 font-heading text-sm font-semibold">{t('transferTitle')}</h2>
        <TransferOwner
          clubId={club.id}
          clubName={club.name}
          candidates={detail.transferCandidates}
          truncated={detail.transferCandidatesTruncated}
        />
      </Card>

      <Card className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-3">
        <div>
          <div className="text-muted-foreground">{t('detailMembers')}</div>
          <div>{t('detailMemberBreakdown', detail.memberCounts)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">{t('detailBoats')}</div>
          <div>{detail.boatCount}</div>
        </div>
        <div>
          <div className="text-muted-foreground">{t('detailWindows')}</div>
          <div>{detail.windowCount}</div>
        </div>
      </Card>

      <section>
        <h2 className="mb-3 font-heading text-sm font-semibold">{t('detailRecentAudit')}</h2>
        {/* This page is about ONE club, so its own timezone is the right frame — unlike
            /admin/audit, whose rows span many clubs and use one operator zone. */}
        <AuditTable
          rows={rows}
          locale={locale}
          timeZone={club.timezone}
          labels={{
            when: t('auditWhen'), actor: t('auditActor'), club: t('auditClub'),
            action: t('auditAction'), target: t('auditTarget'),
            empty: t('auditEmpty'), unknown: t('auditUnknown'),
          }}
        />
      </section>
    </div>
  );
}
