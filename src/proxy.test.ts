import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

// vitest.config sets APP_URL=http://localhost:3000 -> rootDomain 'localhost:3000'.
function req(url: string, host: string) {
  return new NextRequest(new URL(url), { headers: { host } });
}

describe('proxy', () => {
  it('passes apex home through (no rewrite/redirect)', () => {
    const res = proxy(req('http://localhost:3000/', 'localhost:3000'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
  });

  it('rewrites a tenant subdomain into the internal segment and stamps the slug header', () => {
    const res = proxy(req('http://demo.localhost:3000/join', 'demo.localhost:3000'));
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(new URL(rewrite!).pathname).toBe('/s/demo/join');
    // The slug header is forwarded on the request.
    expect(res.headers.get('x-middleware-request-x-tenant-slug')).toBe('demo');
  });

  it('301-redirects the path-form apex club link to the subdomain', () => {
    const res = proxy(req('http://localhost:3000/demo', 'localhost:3000'));
    expect(res.status).toBe(301);
    // NextResponse.redirect constructs a URL internally; WHATWG URL serialization
    // normalizes an empty path to '/', so the Location header carries a trailing slash.
    expect(res.headers.get('location')).toBe('http://demo.localhost:3000/');
  });

  it('strips an inbound x-tenant-slug on apex pass-through', () => {
    const request = req('http://localhost:3000/', 'localhost:3000');
    request.headers.set('x-tenant-slug', 'evil');
    const res = proxy(request);
    // pass-through now forwards request headers via { request: { headers } };
    // a stripped header yields no x-middleware-request-* entry.
    expect(res.headers.get('x-middleware-request-x-tenant-slug')).toBeNull();
  });

  it('ignores a spoofed inbound x-tenant-slug on a tenant rewrite, using the host-derived slug', () => {
    const request = req('http://demo.localhost:3000/join', 'demo.localhost:3000');
    request.headers.set('x-tenant-slug', 'evil');
    const res = proxy(request);
    expect(res.headers.get('x-middleware-request-x-tenant-slug')).toBe('demo');
  });
});
