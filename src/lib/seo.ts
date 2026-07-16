import type { Metadata, MetadataRoute } from 'next';

import type { Club } from '@/lib/tenant';
import { apexUrl, type AppOrigin, clubUrl } from '@/lib/urls';

const TENANT_DISALLOW = ['/join', '/book', '/bookings', '/settings'];
const APEX_DISALLOW = ['/admin'];

export function buildClubMetadata(args: {
  club: Pick<Club, 'slug' | 'name' | 'status' | 'logoUrl'>;
  description: string;
  origin: AppOrigin;
}): Metadata {
  const { club, description, origin } = args;
  const canonical = clubUrl(club.slug, origin);
  const indexable = club.status === 'active';
  return {
    title: club.name,
    description,
    alternates: { canonical },
    robots: { index: indexable, follow: indexable },
    openGraph: {
      title: club.name,
      description,
      url: canonical,
      images: club.logoUrl ? [club.logoUrl] : [],
    },
  };
}

export function buildRobots(args: {
  kind: 'apex' | 'tenant';
  origin: AppOrigin;
  host: string;
}): MetadataRoute.Robots {
  const { kind, origin, host } = args;
  const sitemap = `${origin.protocol}//${host}/sitemap.xml`;
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: kind === 'tenant' ? TENANT_DISALLOW : APEX_DISALLOW,
    },
    sitemap,
  };
}

export function buildApexSitemap(args: {
  clubs: Pick<Club, 'slug'>[];
  origin: AppOrigin;
  now: Date;
}): MetadataRoute.Sitemap {
  const { clubs, origin, now } = args;
  return [
    { url: apexUrl('/', origin), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    ...clubs.map((c) => ({ url: clubUrl(c.slug, origin), lastModified: now })),
  ];
}

export function buildTenantSitemap(args: {
  club: Pick<Club, 'slug' | 'status'>;
  origin: AppOrigin;
  now: Date;
}): MetadataRoute.Sitemap {
  const { club, origin, now } = args;
  if (club.status !== 'active') return [];
  return [{ url: clubUrl(club.slug, origin), lastModified: now }];
}
