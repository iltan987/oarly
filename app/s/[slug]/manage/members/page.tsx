import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { memberships, skillLevels, user } from '@/db/schema';
import { requireOwner } from '@/lib/membership';

import { approveMemberAction, rejectMemberAction } from './actions';
import { SkillLevelSelect } from './skill-level-select';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ManageMembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug);
  const t = await getTranslations('manage');

  const rows = await db
    .select({ membership: memberships, name: user.name, email: user.email })
    .from(memberships)
    .innerJoin(user, eq(memberships.userId, user.id))
    .where(eq(memberships.clubId, club.id));

  const levels = await db.select().from(skillLevels).where(eq(skillLevels.clubId, club.id)).orderBy(skillLevels.rank);

  const pending = rows.filter((r) => r.membership.status === 'pending');
  const approved = rows.filter((r) => r.membership.status === 'approved');

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
          <ul className="divide-y rounded-lg border">
            {pending.map((r) => (
              <li key={r.membership.id} className="flex items-center justify-between gap-4 p-3">
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-sm text-muted-foreground">{r.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <form action={approveMemberAction.bind(null, slug)}>
                    <input type="hidden" name="membershipId" value={r.membership.id} />
                    <button type="submit" className="text-sm text-primary hover:underline">{t('approve')}</button>
                  </form>
                  <form action={rejectMemberAction.bind(null, slug)}>
                    <input type="hidden" name="membershipId" value={r.membership.id} />
                    <button type="submit" className="text-sm text-destructive hover:underline">{t('reject')}</button>
                  </form>
                </div>
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
          <ul className="divide-y rounded-lg border">
            {approved.map((r) => (
              <li key={r.membership.id} className="flex items-center justify-between gap-4 p-3">
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-sm text-muted-foreground">{r.email}</div>
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
