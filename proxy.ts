import type { NextRequest, ProxyConfig } from 'next/server';
import { NextResponse } from 'next/server';

import { env } from '@/env';
import { routeRequest } from '@/lib/tenant-routing';
import { parseAppOrigin } from '@/lib/urls';

const origin = parseAppOrigin(env.APP_URL);

export function proxy(request: NextRequest): NextResponse {
  const host = request.headers.get('host') ?? origin.rootDomain;
  const { pathname, search } = request.nextUrl;
  const decision = routeRequest({ host, pathname, search, origin });

  // Never trust an inbound tenant header — strip it on every request.
  const headers = new Headers(request.headers);
  headers.delete('x-tenant-slug');

  if (decision.type === 'redirect') {
    return NextResponse.redirect(decision.url, decision.status);
  }

  if (decision.type === 'rewrite') {
    const url = request.nextUrl.clone();
    url.pathname = decision.pathname;
    headers.set('x-tenant-slug', decision.slug);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  return NextResponse.next({ request: { headers } });
}

export const config: ProxyConfig = {
  matcher: [
    // Run on everything except API routes, Next internals, and metadata files
    // (those resolve directly and are host-aware where needed).
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
