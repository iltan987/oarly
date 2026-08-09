import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { StatusPill } from '@/components/booking-status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { db } from '@/db';
import { memberships, skillLevels, user } from '@/db/schema';
import { requireOwner } from '@/lib/membership';
import { restrictionState } from '@/lib/restriction';

import { ApproveButton, RejectButton } from './member-actions';
import { SkillLevelSelect } from './skill-level-select';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ManageMembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug);
  const t = await getTranslations('manage');
  const now = new Date();

  const rows = await db
    .select({ membership: memberships, name: user.name, email: user.email })
    .from(memberships)
    .innerJoin(user, eq(memberships.userId, user.id))
    .where(eq(memberships.clubId, club.id));

  const levels = await db.select().from(skillLevels).where(eq(skillLevels.clubId, club.id)).orderBy(skillLevels.rank);

  const pending = rows.filter((r) => r.membership.status === 'pending');
  /*
    The suspended/paused split is `restrictionState`'s, not this page's. It was
    hand-rolled here — `status === 'banned'` for the red badge, `bannedUntil > now` for
    the amber one — which is the module's whole job, including the strict `>` at the
    boundary. Two copies of that predicate is how the owner's roster and the member's own
    page start disagreeing about who is restricted.

    `bannedUntil!` under `'paused'` is that state's invariant, not an assumption: the
    model returns `paused` only when the date is non-null and in the future.
  */
  const approved = rows
    .filter((r) => r.membership.status === 'approved' || r.membership.status === 'banned')
    .map((r) => ({ ...r, restriction: restrictionState(r.membership, now) }));

  if (rows.length === 0) {
    return <p className="text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold">{t('pendingHeading')}</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pending.map((r) => (
              <li key={r.membership.id} className="transition-opacity has-data-pending:opacity-40">
                <Card size="sm">
                  <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-heading text-sm font-semibold">{r.name}</span>
                      <span className="text-xs text-muted-foreground">{r.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ApproveButton slug={slug} membershipId={r.membership.id} label={t('approve')} />
                      <RejectButton slug={slug} membershipId={r.membership.id} label={t('reject')} />
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold">{t('approvedHeading')}</h2>
        {approved.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {approved.map((r) => (
              <li key={r.membership.id}>
                <Card size="sm">
                  <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-heading text-sm font-semibold">{r.name}</span>
                      <span className="text-xs text-muted-foreground">{r.email}</span>
                      {r.restriction === 'suspended' ? (
                        <StatusPill tone="bad">{t('bookings.bannedBadge')}</StatusPill>
                      ) : r.restriction === 'paused' ? (
                        <StatusPill tone="warn">{t('bookings.bannedUntilBadge', { date: r.membership.bannedUntil!.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: club.timezone }) })}</StatusPill>
                      ) : null}
                    </div>
                    {levels.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('noSkillLevels')}</p>
                    ) : (
                      <SkillLevelSelect
                        slug={slug}
                        membershipId={r.membership.id}
                        skillLevels={levels}
                        currentSkillLevelId={r.membership.skillLevelId}
                        label={t('skillLevel')}
                        noneLabel={t('none')}
                      />
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
