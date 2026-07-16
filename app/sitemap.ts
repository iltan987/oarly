import { eq } from 'drizzle-orm';
import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';

import { db } from '@/db';
import { clubs } from '@/db/schema';
import { env } from '@/env';
import { buildApexSitemap, buildTenantSitemap } from '@/lib/seo';
import { getClubBySlug } from '@/lib/tenant';
import { resolveHost } from '@/lib/tenant-routing';
import { parseAppOrigin } from '@/lib/urls';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = parseAppOrigin(env.APP_URL);
  const host = (await headers()).get('host') ?? origin.rootDomain;
  const info = resolveHost(host, origin.rootDomain);
  const now = new Date();

  if (info.kind === 'tenant') {
    const club = await getClubBySlug(info.slug);
    if (!club) return [];
    return buildTenantSitemap({ club, origin, now });
  }

  const active = await db.select({ slug: clubs.slug }).from(clubs).where(eq(clubs.status, 'active'));
  return buildApexSitemap({ clubs: active, origin, now });
}
