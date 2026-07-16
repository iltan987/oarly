import type { AppOrigin } from './urls';
import { clubUrl, apexUrl } from './urls';

/** Subdomains that are never a tenant. `www` redirects to apex; the rest fall through. */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www', 'admin', 'api', 'app', 'static', 'assets',
]);

/**
 * Top-level apex paths that are NOT club slugs. A single-segment apex path not in
 * this set is 301'd to `{seg}.{root}`. ANY new top-level apex route MUST be added here.
 * `s` is the internal tenant rewrite segment.
 */
export const RESERVED_APEX_SEGMENTS: ReadonlySet<string> = new Set([
  's', 'api', 'admin', 'sign-in', 'sign-up', 'sign-out', 'privacy', 'kvkk',
  'favicon.ico', 'robots.txt', 'sitemap.xml', 'opengraph-image', 'icon',
]);

export type HostInfo = { kind: 'apex'; www: boolean } | { kind: 'tenant'; slug: string };

export type RouteDecision =
  | { type: 'next' }
  | { type: 'rewrite'; pathname: string; slug: string }
  | { type: 'redirect'; url: string; status: 301 };

function stripPort(host: string): string {
  return host.split(':')[0].toLowerCase();
}

export function resolveHost(host: string, rootDomain: string): HostInfo {
  const h = stripPort(host);
  const root = stripPort(rootDomain);
  if (h === root) return { kind: 'apex', www: false };
  if (h === `www.${root}`) return { kind: 'apex', www: true };
  if (h.endsWith(`.${root}`)) {
    const sub = h.slice(0, h.length - root.length - 1);
    if (RESERVED_SUBDOMAINS.has(sub)) return { kind: 'apex', www: sub === 'www' };
    return { kind: 'tenant', slug: sub };
  }
  // Unknown host (preview deploys, direct IP, misconfig): treat as apex.
  return { kind: 'apex', www: false };
}

export function routeRequest(input: {
  host: string;
  pathname: string;
  search: string;
  origin: AppOrigin;
}): RouteDecision {
  const { host, pathname, search, origin } = input;
  const info = resolveHost(host, origin.rootDomain);

  if (info.kind === 'apex') {
    if (info.www) {
      return { type: 'redirect', url: apexUrl(`${pathname}${search}`, origin), status: 301 };
    }
    // Never serve the internal tenant segment from the apex host.
    if (pathname === '/s' || pathname.startsWith('/s/')) {
      return { type: 'redirect', url: apexUrl('/', origin), status: 301 };
    }
    // Path-form club link: single non-reserved segment -> canonical subdomain.
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 1 && !segments[0].includes('.') && !RESERVED_APEX_SEGMENTS.has(segments[0])) {
      return { type: 'redirect', url: `${clubUrl(segments[0], origin)}${search}`, status: 301 };
    }
    return { type: 'next' };
  }

  // Tenant host: rewrite the whole subtree under the internal segment.
  const rewritten = pathname === '/' ? `/s/${info.slug}` : `/s/${info.slug}${pathname}`;
  return { type: 'rewrite', pathname: rewritten, slug: info.slug };
}
