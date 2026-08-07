import type { NextRequest, ProxyConfig } from 'next/server';
import { NextResponse } from 'next/server';

import { env } from '@/env';
import { enforceBaseline } from '@/lib/rate-limit-guard';
import { routeRequest } from '@/lib/tenant-routing';
import { parseAppOrigin } from '@/lib/urls';

const origin = parseAppOrigin(env.APP_URL);

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // §17's general baseline. POST-only, so browsing costs nothing; see enforceBaseline.
  // A raw 429 is not an RSC payload, so React surfaces it as a generic failure rather
  // than a toast — accepted, because at 100/min this only trips for scripted abuse and
  // every named action carries a much tighter limit that DOES produce a toast.
  try {
    const baseline = await enforceBaseline(request);
    if (baseline.limited) {
      return new NextResponse(null, {
        status: 429,
        headers: { 'Retry-After': String(baseline.retryAfterSec) },
      });
    }
  } catch (error) {
    // A rate limiter must never be able to take the site down. `enforceBaseline` already
    // fails open internally (it bottoms out in `rateLimit`'s own try/catch), but this is
    // the proxy's hottest code path — every POST to the app runs through it — so it gets
    // its own safety net rather than trusting that guarantee to hold two modules away.
    console.error('proxy: enforceBaseline threw, allowing request through', error);
  }

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
