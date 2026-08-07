import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetRateLimitState } from '@/lib/rate-limit';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import * as rateLimitGuard from '@/lib/rate-limit-guard';

import { proxy } from '../proxy';

// vitest.config sets APP_URL=http://localhost:3000 -> rootDomain 'localhost:3000'.
function req(url: string, host: string) {
  return new NextRequest(new URL(url), { headers: { host } });
}

// POST requests drive the §17 baseline (proxy.ts's own module-level bucket state via
// enforceBaseline -> enforceRateLimit -> rateLimit). Each call site below gets its own
// x-forwarded-for so tests never share a bucket with each other.
function postReq(ip: string) {
  return new NextRequest(new URL('http://localhost:3000/'), {
    method: 'POST',
    headers: { host: 'localhost:3000', 'x-forwarded-for': ip },
  });
}

function getReq(ip: string) {
  return new NextRequest(new URL('http://localhost:3000/'), {
    method: 'GET',
    headers: { host: 'localhost:3000', 'x-forwarded-for': ip },
  });
}

describe('proxy', () => {
  // proxy() transitively reaches rate-limit.ts's module-level `buckets` map through
  // enforceBaseline -> enforceRateLimit -> rateLimit. Without this reset, tests leak
  // state into each other and pass or fail by file order.
  beforeEach(() => { resetRateLimitState(); });

  it('passes apex home through (no rewrite/redirect)', async () => {
    const res = await proxy(req('http://localhost:3000/', 'localhost:3000'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
  });

  it('rewrites a tenant subdomain into the internal segment and stamps the slug header', async () => {
    const res = await proxy(req('http://demo.localhost:3000/join', 'demo.localhost:3000'));
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(new URL(rewrite!).pathname).toBe('/s/demo/join');
    // The slug header is forwarded on the request.
    expect(res.headers.get('x-middleware-request-x-tenant-slug')).toBe('demo');
  });

  it('301-redirects the path-form apex club link to the subdomain', async () => {
    const res = await proxy(req('http://localhost:3000/demo', 'localhost:3000'));
    expect(res.status).toBe(301);
    // NextResponse.redirect constructs a URL internally; WHATWG URL serialization
    // normalizes an empty path to '/', so the Location header carries a trailing slash.
    expect(res.headers.get('location')).toBe('http://demo.localhost:3000/');
  });

  it('strips an inbound x-tenant-slug on apex pass-through', async () => {
    const request = req('http://localhost:3000/', 'localhost:3000');
    request.headers.set('x-tenant-slug', 'evil');
    const res = await proxy(request);
    // pass-through now forwards request headers via { request: { headers } };
    // a stripped header yields no x-middleware-request-* entry.
    expect(res.headers.get('x-middleware-request-x-tenant-slug')).toBeNull();
  });

  it('ignores a spoofed inbound x-tenant-slug on a tenant rewrite, using the host-derived slug', async () => {
    const request = req('http://demo.localhost:3000/join', 'demo.localhost:3000');
    request.headers.set('x-tenant-slug', 'evil');
    const res = await proxy(request);
    expect(res.headers.get('x-middleware-request-x-tenant-slug')).toBe('demo');
  });
});

describe('proxy — §17 general baseline', () => {
  // Derived from the config rather than hardcoded: this rule is deliberately tuned (it was
  // raised from 100 to 1000 so a whole club behind one NAT cannot exhaust it at slot-open),
  // and a hardcoded count here would turn every future tuning into a spurious test failure.
  const BASELINE = RATE_LIMITS.apiBaselinePerIp.limit;

  beforeEach(() => { resetRateLimitState(); });

  it('allows up to the baseline POSTs/min per IP, then rejects the next one with 429', async () => {
    const ip = '203.0.113.50';
    for (let i = 0; i < BASELINE; i += 1) {
      const res = await proxy(postReq(ip));
      expect(res.status).not.toBe(429);
    }
    const res = await proxy(postReq(ip));
    expect(res.status).toBe(429);
  });

  it('the 429 carries a positive integer Retry-After header no larger than the window', async () => {
    const ip = '203.0.113.51';
    for (let i = 0; i < BASELINE; i += 1) await proxy(postReq(ip));
    const res = await proxy(postReq(ip));
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('retry-after');
    expect(retryAfter).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    // Upper bound too, so a seconds/milliseconds mix-up cannot survive: a `* 1000` would
    // report 60000, which /^\d+$/ and "> 0" both accept.
    expect(Number(retryAfter)).toBeLessThanOrEqual(RATE_LIMITS.apiBaselinePerIp.windowSec);
  });

  it('still routes a GET normally from an IP already exhausted on POST', async () => {
    const ip = '203.0.113.52';
    for (let i = 0; i < BASELINE; i += 1) await proxy(postReq(ip));
    const blocked = await proxy(postReq(ip));
    expect(blocked.status).toBe(429); // sanity: this IP really is exhausted for POST
    const res = await proxy(getReq(ip));
    expect(res.status).not.toBe(429);
  });

  it('fails open when the baseline check throws, so a broken limiter cannot take the proxy down', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const baselineSpy = vi
      .spyOn(rateLimitGuard, 'enforceBaseline')
      .mockRejectedValueOnce(new Error('kv down'));

    const res = await proxy(req('http://localhost:3000/', 'localhost:3000'));

    expect(res.status).not.toBe(429);
    expect(errorSpy).toHaveBeenCalled();

    baselineSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
