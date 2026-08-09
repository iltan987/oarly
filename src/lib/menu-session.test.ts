import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({ env: { APP_URL: 'https://oarly.test' } }));

import { menuSession } from './menu-session';

const USER = { name: 'İltan Caner', email: 'icaner@example.test', image: null };

describe('menuSession', () => {
  it('is undefined for a guest', () => {
    // `UserMenu` reads an absent `session` as "signed out"; a half-filled object would
    // make "signed out but somehow has an accountUrl" representable.
    expect(menuSession(null)).toBeUndefined();
    expect(menuSession(undefined)).toBeUndefined();
  });

  it('keeps the account link relative on the apex host', () => {
    // Relative so it stays a client-side navigation where that is possible at all.
    expect(menuSession(USER)?.accountUrl).toBe('/account');
  });

  it('makes the account link absolute on a tenant host', () => {
    // /account exists only on the apex. A relative href on a club subdomain stays on the
    // tenant host and 404s — the hazard this whole helper exists to make unmissable.
    expect(menuSession(USER, { tenant: true })?.accountUrl).toBe('https://oarly.test/account');
  });

  it.each([[false], [true]])('always signs out through the apex (tenant=%s)', (tenant) => {
    // Sign-out is apex-only on BOTH hosts: the session cookie is set on the apex, and the
    // sign-in page that receives `signedout=1` lives there too. Unlike accountUrl, this
    // one has no correct relative form.
    expect(menuSession(USER, { tenant })?.signOutUrl).toBe('https://oarly.test/sign-in?signedout=1');
  });

  it('carries the identity through verbatim', () => {
    expect(menuSession({ ...USER, image: 'https://cdn.test/a.png' })).toMatchObject({
      name: 'İltan Caner',
      email: 'icaner@example.test',
      image: 'https://cdn.test/a.png',
    });
  });
});
