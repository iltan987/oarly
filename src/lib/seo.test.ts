import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildApexSitemap, buildClubMetadata, buildRobots, buildTenantSitemap } from './seo';

/**
 * `APEX_DISALLOW` is a hand-written list (it has to be — `buildRobots` takes no
 * filesystem access), so nothing forces it to keep up with new apex routes. This derives
 * the set it *should* contain straight from `app/`: every apex route sitting behind
 * `requireUser`, directly or transitively through `requireAdmin` (which calls it), rather
 * than every route that merely isn't public marketing. That distinction is why `/privacy`
 * — deliberately crawlable — is not expected here even though it isn't the home page.
 *
 * Deriving this from `APEX_DISALLOW` itself would pass with the constant empty, so this
 * reads `app/`'s `page.tsx`/`layout.tsx` files instead and never touches `seo.ts`.
 */
const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url));

/** `app/(auth)/sign-in/page.tsx` -> `sign-in`; a route group in parens is not a URL segment. */
function firstUrlSegment(segments: string[]): string | undefined {
  return segments.find((s) => !s.startsWith('('));
}

/** Every apex `page.tsx`/`layout.tsx` under `app/`, paired with its first real URL segment. */
function collectApexRouteFiles(dir: string, segments: string[] = []): { file: string; topSegment: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) {
      if (entry.name !== 'page.tsx' && entry.name !== 'layout.tsx') return [];
      const topSegment = firstUrlSegment(segments);
      return topSegment ? [{ file: path.join(dir, entry.name), topSegment }] : [];
    }
    // `app/s` is the tenant tree (its own `TENANT_DISALLOW`) and `app/api` has no pages.
    if (segments.length === 0 && (entry.name === 's' || entry.name === 'api')) return [];
    return collectApexRouteFiles(path.join(dir, entry.name), [...segments, entry.name]);
  });
}

/** Top URL segments whose `page.tsx` or `layout.tsx` calls `requireUser`/`requireAdmin`. */
function segmentsRequiringSession(): string[] {
  const gated = new Set<string>();
  for (const { file, topSegment } of collectApexRouteFiles(APP_DIR)) {
    const source = readFileSync(file, 'utf8');
    if (/\brequireUser\(|\brequireAdmin\(/.test(source)) gated.add(topSegment);
  }
  return [...gated].sort();
}

const ORIGIN = { protocol: 'https:', rootDomain: 'oarly.sbs' };
const NOW = new Date('2026-07-16T00:00:00.000Z');

const activeClub = { slug: 'demo', name: 'Demo Rowing', status: 'active', logoUrl: 'https://cdn/x.png' } as never;
const pendingClub = { slug: 'demo', name: 'Demo Rowing', status: 'pending', logoUrl: null } as never;

describe('buildClubMetadata', () => {
  it('sets a self-canonical subdomain URL and indexes an active club', () => {
    const m = buildClubMetadata({ club: activeClub, description: 'Kürek seansları', origin: ORIGIN });
    expect(m.alternates?.canonical).toBe('https://demo.oarly.sbs');
    expect(m.title).toBe('Demo Rowing');
    expect(m.robots).toMatchObject({ index: true, follow: true });
    expect(m.openGraph?.images).toEqual(['https://cdn/x.png']);
  });
  it('noindexes a non-active club', () => {
    const m = buildClubMetadata({ club: pendingClub, description: 'x', origin: ORIGIN });
    expect(m.robots).toMatchObject({ index: false, follow: false });
    expect(m.openGraph?.images).toEqual([]);
  });
  it('emits no hreflang language alternates', () => {
    const m = buildClubMetadata({ club: activeClub, description: 'x', origin: ORIGIN });
    expect(m.alternates?.languages).toBeUndefined();
  });
  it('uses the provided description and the club logo for OpenGraph', () => {
    const meta = buildClubMetadata({
      club: { slug: 'bebek', name: 'Bebek', status: 'active', logoUrl: 'https://blob/logo.png' } as never,
      description: 'Boğaz’da kürek',
      origin: ORIGIN,
    });
    expect(meta.description).toBe('Boğaz’da kürek');
    expect(meta.openGraph?.images).toEqual(['https://blob/logo.png']);
  });
});

describe('buildRobots', () => {
  it('apex: allows root, disallows every requireUser-gated route, points at apex sitemap', () => {
    const r = buildRobots({ kind: 'apex', origin: ORIGIN, host: 'oarly.sbs' });
    expect(r.rules).toMatchObject({ userAgent: '*', allow: '/' });
    const disallow = (r.rules as { disallow?: string[] }).disallow ?? [];
    expect(disallow.slice().sort()).toEqual(['/account', '/admin', '/request-club']);
    expect(r.sitemap).toBe('https://oarly.sbs/sitemap.xml');
  });
  it('apex: does not disallow /privacy, which is deliberately public despite requiring no session', () => {
    const r = buildRobots({ kind: 'apex', origin: ORIGIN, host: 'oarly.sbs' });
    const disallow = (r.rules as { disallow?: string[] }).disallow ?? [];
    expect(disallow).not.toContain('/privacy');
  });
  it('apex: matches exactly the set of routes app/ gates behind requireUser or requireAdmin', () => {
    const r = buildRobots({ kind: 'apex', origin: ORIGIN, host: 'oarly.sbs' });
    const disallow = ((r.rules as { disallow?: string[] }).disallow ?? []).slice().sort();
    const derived = segmentsRequiringSession().map((s) => `/${s}`);
    // The control: if this ever comes back empty, every assertion above is vacuous.
    expect(derived.length).toBeGreaterThan(0);
    expect(disallow).toEqual(derived);
  });
  it('tenant: disallows authenticated surfaces, sitemap on same host', () => {
    const r = buildRobots({ kind: 'tenant', origin: ORIGIN, host: 'demo.oarly.sbs' });
    const disallow = (r.rules as { disallow?: string[] }).disallow ?? [];
    expect(disallow).toEqual(expect.arrayContaining(['/join', '/book', '/bookings', '/settings']));
    expect(r.sitemap).toBe('https://demo.oarly.sbs/sitemap.xml');
  });
});

describe('sitemaps', () => {
  it('apex lists home + active clubs', () => {
    const s = buildApexSitemap({ clubs: [{ slug: 'demo' }, { slug: 'foo' }], origin: ORIGIN, now: NOW });
    const urls = s.map((e) => e.url);
    expect(urls).toContain('https://oarly.sbs/');
    expect(urls).toContain('https://demo.oarly.sbs');
    expect(urls).toContain('https://foo.oarly.sbs');
  });
  it('tenant lists its home when active, empty otherwise', () => {
    expect(buildTenantSitemap({ club: { slug: 'demo', status: 'active' }, origin: ORIGIN, now: NOW })).toEqual([
      { url: 'https://demo.oarly.sbs', lastModified: NOW },
    ]);
    expect(buildTenantSitemap({ club: { slug: 'demo', status: 'pending' }, origin: ORIGIN, now: NOW })).toEqual([]);
  });
});
