import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `set-locale.test.ts` covers the http/no-domain branch using the vitest-config-pinned
 * `APP_URL=http://localhost:3000` and an unset `COOKIE_DOMAIN`. It cannot also cover the
 * https/domain branch: `@/env` is imported once at module load, so a single test file
 * can only pin it to one shape. This file exists to exercise the other shape — a
 * production-like origin with a cookie domain configured — which is the entire reason
 * `secure` and `domain` exist on the cookie in the first place.
 */
vi.mock('@/env', () => ({
  env: { APP_URL: 'https://oarly.app', COOKIE_DOMAIN: '.oarly.app' as string | undefined },
}));

const cookieSet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => null }));
vi.mock('@/lib/user-locale', () => ({ setUserLocale: vi.fn() }));
vi.mock('@/lib/rate-limit-guard', () => ({ enforceRateLimit: async () => ({ limited: false }) }));
vi.mock('@/lib/request-ip', () => ({ getClientIp: async () => '203.0.113.7' }));

import { env } from '@/env';

import { setLocale } from './set-locale';

beforeEach(() => {
  cookieSet.mockClear();
  env.APP_URL = 'https://oarly.app';
  env.COOKIE_DOMAIN = '.oarly.app';
});

describe('setLocale cookie attributes on an https origin with a cookie domain configured', () => {
  it('marks the cookie Secure and scopes it to COOKIE_DOMAIN', async () => {
    await setLocale('en');
    expect(cookieSet).toHaveBeenCalledTimes(1);
    const options = cookieSet.mock.calls[0][2];
    expect(options.secure).toBe(true);
    expect(options.domain).toBe('.oarly.app');
  });

  it('omits `domain` when COOKIE_DOMAIN is the empty string', async () => {
    // `src/env.ts` sets `emptyStringAsUndefined: true`, so a real `COOKIE_DOMAIN=''`
    // never reaches `env.COOKIE_DOMAIN` as `''` in production — but `set-locale.ts`'s
    // own `env.COOKIE_DOMAIN ? {...} : {}` guard is what actually enforces this, and
    // that guard is cheap to pin directly regardless of where the empty string came from.
    env.COOKIE_DOMAIN = '';
    await setLocale('en');
    expect('domain' in cookieSet.mock.calls[0][2]).toBe(false);
  });
});
