import { beforeEach, describe, expect, it, vi } from 'vitest';

// Type-only, so it is erased before the module graph is built and never defeats the
// `vi.mock` below.
import type { enforceRateLimit as EnforceRateLimit } from '@/lib/rate-limit-guard';

const cookieSet = vi.fn();
const getCurrentUser = vi.fn();
const setUserLocaleMock = vi.fn();
const revalidatePath = vi.fn();
// Typed against the real export rather than a hand-copied shape, so the stand-in cannot
// drift from the contract it replaces (`RateVerdict` is a discriminated union — a loose
// `{ limited: boolean }` would let a test configure a verdict the real guard can never
// return). It also gives the forwarding wrapper below a tuple parameter list, which is
// what `tsc --noEmit` requires of a spread argument.
const enforceRateLimit = vi.fn<typeof EnforceRateLimit>(async () => ({ limited: false }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/session', () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock('@/lib/user-locale', () => ({
  setUserLocale: (...a: unknown[]) => setUserLocaleMock(...a),
}));
vi.mock('@/lib/rate-limit-guard', () => ({
  enforceRateLimit: (...a: Parameters<typeof enforceRateLimit>) => enforceRateLimit(...a),
}));
vi.mock('@/lib/request-ip', () => ({ getClientIp: async () => '203.0.113.7' }));

import { setLocale } from './set-locale';

beforeEach(() => {
  vi.clearAllMocks();
  // `vi.clearAllMocks()` only clears call history, not implementations set via
  // `mockRejectedValue`/`mockResolvedValue` — and this config sets no
  // `restoreMocks`/`mockReset`. Reset explicitly any mock a test gives a one-off
  // implementation to, so a rejection configured in one test cannot leak into the next.
  setUserLocaleMock.mockReset();
  enforceRateLimit.mockResolvedValue({ limited: false });
  getCurrentUser.mockResolvedValue(null);
});

describe('setLocale', () => {
  it('writes the locale cookie with the attributes the app depends on', async () => {
    await setLocale('en');
    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, value, options] = cookieSet.mock.calls[0];
    expect(name).toBe('locale');
    expect(value).toBe('en');
    expect(options).toMatchObject({
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
    });
  });

  it('omits `domain` entirely when COOKIE_DOMAIN is unset', async () => {
    // Not `domain: undefined` — a present-but-undefined key is a different object, and
    // some cookie serializers stringify it as the literal "undefined".
    await setLocale('en');
    expect('domain' in cookieSet.mock.calls[0][2]).toBe(false);
  });

  it('marks the cookie Secure only when the app origin is https', async () => {
    // The vitest config pins APP_URL to http://localhost:3000.
    await setLocale('en');
    expect(cookieSet.mock.calls[0][2].secure).toBe(false);
  });

  it('rejects an unsupported locale before doing anything at all', async () => {
    // A Server Action's argument is attacker-controlled regardless of its TypeScript type.
    await setLocale('de' as never);
    await setLocale('../../etc/passwd' as never);
    expect(cookieSet).not.toHaveBeenCalled();
    expect(setUserLocaleMock).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('writes nothing when rate limited', async () => {
    enforceRateLimit.mockResolvedValue({ limited: true, retryAfterSec: 30 });
    await setLocale('en');
    expect(cookieSet).not.toHaveBeenCalled();
    expect(setUserLocaleMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('mirrors the choice onto the signed-in user row', async () => {
    getCurrentUser.mockResolvedValue({ id: 'user-1' });
    await setLocale('en');
    expect(setUserLocaleMock).toHaveBeenCalledWith(expect.anything(), 'user-1', 'en');
  });

  it('writes no user row when signed out', async () => {
    await setLocale('en');
    expect(setUserLocaleMock).not.toHaveBeenCalled();
  });

  it('still switches the UI when the user-row write fails', async () => {
    // The cookie is already set and the page is about to re-render in the new language;
    // a database error must not throw back into the switcher, which has no error surface.
    getCurrentUser.mockResolvedValue({ id: 'user-1' });
    setUserLocaleMock.mockRejectedValue(new Error('db down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(setLocale('en')).resolves.toBeUndefined();
    expect(cookieSet).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('still switches the UI when reading the session fails', async () => {
    // `getCurrentUser()` is itself a DB query (through the same pool as everything
    // else) and must be inside the same protected region as the `setUserLocale` write:
    // a transient session-query failure must not throw back into a control that has no
    // error surface, after the cookie has already been staged.
    getCurrentUser.mockRejectedValue(new Error('session down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(setLocale('en')).resolves.toBeUndefined();
    expect(cookieSet).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('revalidates the root layout, not just the current route', async () => {
    // `router.refresh()` would re-render only the current route and leave every other
    // entry in the client Router Cache rendered in the previous language.
    await setLocale('en');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });
});
