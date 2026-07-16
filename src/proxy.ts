import { NextResponse } from 'next/server';
import type { NextRequest, ProxyConfig } from 'next/server';
import { env } from '@/env';
import { parseAppOrigin } from '@/lib/urls';
import { routeRequest } from '@/lib/tenant-routing';

const origin = parseAppOrigin(env.APP_URL);

export function proxy(request: NextRequest): NextResponse {
  const host = request.headers.get('host') ?? origin.rootDomain;
  const { pathname, search } = request.nextUrl;
  const decision = routeRequest({ host, pathname, search, origin });

  if (decision.type === 'redirect') {
    return NextResponse.redirect(decision.url, decision.status);
  }

  if (decision.type === 'rewrite') {
    const url = request.nextUrl.clone();
    url.pathname = decision.pathname;
    const headers = new Headers(request.headers);
    headers.set('x-tenant-slug', decision.slug);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  return NextResponse.next();
}

export const config: ProxyConfig = {
  matcher: [
    // Run on everything except API routes, Next internals, and metadata files
    // (those resolve directly and are host-aware where needed).
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
