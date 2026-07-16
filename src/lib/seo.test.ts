import { describe, expect, it } from 'vitest';

import { buildApexSitemap, buildClubMetadata, buildRobots, buildTenantSitemap } from './seo';

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
  it('apex: allows root, disallows admin, points at apex sitemap', () => {
    const r = buildRobots({ kind: 'apex', origin: ORIGIN, host: 'oarly.sbs' });
    expect(r.rules).toMatchObject({ userAgent: '*', allow: '/' });
    expect(r.rules && (r.rules as { disallow?: string[] }).disallow).toContain('/admin');
    expect(r.sitemap).toBe('https://oarly.sbs/sitemap.xml');
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
