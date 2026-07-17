import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { countSkillLevelRefs, listSkillLevels } from '@/lib/skill-levels';

import { SkillLevelsEditor } from './skill-levels-editor';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SkillLevelsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/skill-levels');
  const t = await getTranslations('manage.skillLevels');
  const levels = await listSkillLevels(db, club.id);
  const refs = Object.fromEntries(
    await Promise.all(levels.map(async (l) => [l.id, await countSkillLevelRefs(db, { clubId: club.id, skillLevelId: l.id })] as const)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <SkillLevelsEditor
        slug={slug}
        levels={levels.map((l) => ({ id: l.id, name: l.name, refs: refs[l.id] }))}
        labels={{
          addPlaceholder: t('addPlaceholder'), add: t('add'), moveUp: t('moveUp'), moveDown: t('moveDown'),
          rename: t('rename'), save: t('save'), cancel: t('cancel'), delete: t('delete'),
          deleteConfirmYes: t('deleteConfirmYes'), empty: t('empty'),
        }}
        confirms={Object.fromEntries(levels.map((l) => [l.id, t('deleteConfirm', { members: refs[l.id].members, boats: refs[l.id].boats })]))}
      />
    </div>
  );
}
