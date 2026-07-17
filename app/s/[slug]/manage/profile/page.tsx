import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { db } from '@/db';
import { listSocials } from '@/lib/club-profile';
import { requireOwner } from '@/lib/membership';

import { ProfileForm } from './profile-form';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/profile');
  const t = await getTranslations('manage.profile');
  const socials = await listSocials(db, club.id);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <ProfileForm
        slug={slug}
        club={{ name: club.name, tagline: club.tagline, description: club.description, phone: club.phone, brandAccent: club.brandAccent, headingFont: club.headingFont, logoUrl: club.logoUrl, updatedAt: club.updatedAt }}
        socials={socials.map((s) => ({ id: s.id, platform: s.platform, handle: s.handle }))}
      />
    </div>
  );
}
