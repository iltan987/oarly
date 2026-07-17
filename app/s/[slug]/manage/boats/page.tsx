import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { listBoats } from '@/lib/boats';
import { requireOwner } from '@/lib/membership';
import { listSkillLevels } from '@/lib/skill-levels';

import { BoatsEditor } from './boats-editor';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function BoatsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/boats');
  const t = await getTranslations('manage.boats');
  const [boats, levels] = await Promise.all([listBoats(db, club.id), listSkillLevels(db, club.id)]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <BoatsEditor
        slug={slug}
        boats={boats.map((b) => ({ id: b.id, name: b.name, seats: b.seats, minSkillLevelId: b.minSkillLevelId, allowedPayment: b.allowedPayment, minAttendance: b.minAttendance, active: b.active }))}
        levels={levels.map((l) => ({ id: l.id, name: l.name }))}
        labels={{
          name: t('name'), seats: t('seats'), minSkill: t('minSkill'), noMinSkill: t('noMinSkill'),
          payment: t('payment'), paymentRegular: t('paymentRegular'), paymentMultisport: t('paymentMultisport'),
          paymentBoth: t('paymentBoth'), minAttendance: t('minAttendance'), add: t('add'), edit: t('edit'),
          save: t('save'), cancel: t('cancel'), deactivate: t('deactivate'), activate: t('activate'),
          inactive: t('inactive'), empty: t('empty'), needSkillLevels: t('needSkillLevels'),
        }}
      />
    </div>
  );
}
