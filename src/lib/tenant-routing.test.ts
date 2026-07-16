import { describe, it, expect } from 'vitest';
import { resolveHost, routeRequest } from './tenant-routing';

const PROD = { protocol: 'https:', rootDomain: 'oarly.sbs' };
const DEV = { protocol: 'http:', rootDomain: 'lvh.me:3000' };

describe('resolveHost', () => {
  it('treats the bare root as apex', () => {
    expect(resolveHost('oarly.sbs', 'oarly.sbs')).toEqual({ kind: 'apex', www: false });
  });
  it('treats www as apex (www flag set)', () => {
    expect(resolveHost('www.oarly.sbs', 'oarly.sbs')).toEqual({ kind: 'apex', www: true });
  });
  it('extracts a tenant slug from a subdomain', () => {
    expect(resolveHost('demo.oarly.sbs', 'oarly.sbs')).toEqual({ kind: 'tenant', slug: 'demo' });
  });
  it('ignores ports when comparing', () => {
    expect(resolveHost('demo.lvh.me:3000', 'lvh.me:3000')).toEqual({ kind: 'tenant', slug: 'demo' });
    expect(resolveHost('lvh.me:3000', 'lvh.me:3000')).toEqual({ kind: 'apex', www: false });
  });
  it('treats reserved subdomains as apex', () => {
    expect(resolveHost('api.oarly.sbs', 'oarly.sbs')).toEqual({ kind: 'apex', www: false });
    expect(resolveHost('admin.oarly.sbs', 'oarly.sbs')).toEqual({ kind: 'apex', www: false });
  });
  it('treats an unknown host (e.g. vercel preview) as apex', () => {
    expect(resolveHost('oarly-abc123.vercel.app', 'oarly.sbs')).toEqual({ kind: 'apex', www: false });
  });
});

describe('routeRequest — apex host', () => {
  const base = { host: 'oarly.sbs', search: '', origin: PROD };
  it('serves the marketing home as-is', () => {
    expect(routeRequest({ ...base, pathname: '/' })).toEqual({ type: 'next' });
  });
  it('serves reserved apex routes as-is', () => {
    expect(routeRequest({ ...base, pathname: '/admin' })).toEqual({ type: 'next' });
    expect(routeRequest({ ...base, pathname: '/privacy' })).toEqual({ type: 'next' });
  });
  it('301-redirects the path-form club link to the subdomain', () => {
    expect(routeRequest({ ...base, pathname: '/demo' })).toEqual({
      type: 'redirect', url: 'https://demo.oarly.sbs', status: 301,
    });
  });
  it('preserves the query string on the path-form redirect', () => {
    expect(routeRequest({ ...base, pathname: '/demo', search: '?ref=x' })).toEqual({
      type: 'redirect', url: 'https://demo.oarly.sbs?ref=x', status: 301,
    });
  });
  it('does not treat a multi-segment path as a club link', () => {
    expect(routeRequest({ ...base, pathname: '/demo/book' })).toEqual({ type: 'next' });
  });
  it('does not treat a dotted single-segment path (asset request) as a club link', () => {
    expect(routeRequest({ ...base, pathname: '/apple-touch-icon.png' })).toEqual({ type: 'next' });
    expect(routeRequest({ ...base, pathname: '/logo.png' })).toEqual({ type: 'next' });
  });
  it('redirects www to the bare apex, preserving the path', () => {
    expect(routeRequest({ host: 'www.oarly.sbs', pathname: '/privacy', search: '', origin: PROD })).toEqual({
      type: 'redirect', url: 'https://oarly.sbs/privacy', status: 301,
    });
  });
  it('guards the internal tenant segment from apex access', () => {
    expect(routeRequest({ ...base, pathname: '/s/demo' })).toEqual({
      type: 'redirect', url: 'https://oarly.sbs/', status: 301,
    });
  });
});

describe('routeRequest — tenant host', () => {
  it('rewrites the subdomain root to the internal segment', () => {
    expect(routeRequest({ host: 'demo.oarly.sbs', pathname: '/', search: '', origin: PROD })).toEqual({
      type: 'rewrite', pathname: '/s/demo', slug: 'demo',
    });
  });
  it('rewrites a nested subdomain path', () => {
    expect(routeRequest({ host: 'demo.lvh.me:3000', pathname: '/join', search: '', origin: DEV })).toEqual({
      type: 'rewrite', pathname: '/s/demo/join', slug: 'demo',
    });
  });
});
