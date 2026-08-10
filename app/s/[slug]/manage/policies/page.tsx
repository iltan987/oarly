import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { BackLink } from '@/components/back-link';
import { db } from '@/db';
import { countMultisportOnlyBoats } from '@/lib/boats';
import { requireOwner } from '@/lib/membership';
import { getSchedulingSettings } from '@/lib/scheduling-settings';

import { PoliciesForm } from './policies-form';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PoliciesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/policies');
  const t = await getTranslations('manage.policies');
  const tManage = await getTranslations('manage');
  const [settings, multisportOnlyBoatCount] = await Promise.all([
    getSchedulingSettings(db, club.id),
    countMultisportOnlyBoats(db, club.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <BackLink href="/manage/settings" label={tManage('settings.navLabel')} />
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t(settings.multisportEnabled ? 'intro' : 'introNoMultisport')}</p>
      </div>
      <PoliciesForm
        slug={slug}
        updatedAt={club.updatedAt.getTime()}
        settings={settings}
        labels={{
          save: t('save'), bookingOpen: t('bookingOpen'), bookingOpenAlways: t('bookingOpenAlways'),
          bookingOpenLead: t('bookingOpenLead'), leadDays: t('leadDays'), selfCancel: t('selfCancel'),
          cancelCutoff: t('cancelCutoff'), noshow: t('noshow'), noshowOff: t('noshowOff'), noshow2d: t('noshow2d'),
          noshow1w: t('noshow1w'), noshow2w: t('noshow2w'), noshow1m: t('noshow1m'), noshowNever: t('noshowNever'),
          multisport: t('multisport'), multisportEqual: t('multisportEqual'), multisportPriority: t('multisportPriority'),
          multisportHint: t('multisportHint'), openOnHolidays: t('openOnHolidays'), waitlistCapacity: t('waitlistCapacity'),
          waitlistCapacityHint: t('waitlistCapacityHint'), errorInvalidLead: t('errorInvalidLead'),
          errorInvalidInput: t('errorInvalidInput'), saved: t('saved'),
          multisportEnabled: t('multisportEnabled'), multisportEnabledHint: t('multisportEnabledHint'),
          cancel: t('cancel'), confirmDisableMultisportTitle: t('confirmDisableMultisportTitle'),
          confirmDisableMultisportBody: t('confirmDisableMultisportBody', { count: multisportOnlyBoatCount }),
          confirmDisableMultisportCta: t('confirmDisableMultisportCta'),
        }}
      />
    </div>
  );
}
