import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';

import { env } from '@/env';
import { buildRobots } from '@/lib/seo';
import { resolveHost } from '@/lib/tenant-routing';
import { parseAppOrigin } from '@/lib/urls';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = parseAppOrigin(env.APP_URL);
  const host = (await headers()).get('host') ?? origin.rootDomain;
  const info = resolveHost(host, origin.rootDomain);
  return buildRobots({ kind: info.kind, origin, host });
}
