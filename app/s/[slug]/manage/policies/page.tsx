import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { requireOwner } from '@/lib/membership';
import { getSchedulingSettings } from '@/lib/scheduling-settings';

import { PoliciesForm } from './policies-form';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PoliciesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/policies');
  const t = await getTranslations('manage.policies');
  const settings = await getSchedulingSettings(db, club.id);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <PoliciesForm
        key={club.updatedAt.getTime()}
        slug={slug}
        settings={settings}
        labels={{
          save: t('save'), bookingOpen: t('bookingOpen'), bookingOpenAlways: t('bookingOpenAlways'),
          bookingOpenLead: t('bookingOpenLead'), leadDays: t('leadDays'), selfCancel: t('selfCancel'),
          cancelCutoff: t('cancelCutoff'), noshow: t('noshow'), noshowOff: t('noshowOff'), noshow2d: t('noshow2d'),
          noshow1w: t('noshow1w'), noshow2w: t('noshow2w'), noshow1m: t('noshow1m'), noshowNever: t('noshowNever'),
          multisport: t('multisport'), multisportEqual: t('multisportEqual'), multisportPriority: t('multisportPriority'),
          multisportHint: t('multisportHint'), openOnHolidays: t('openOnHolidays'), errorInvalidLead: t('errorInvalidLead'),
        }}
      />
    </div>
  );
}
