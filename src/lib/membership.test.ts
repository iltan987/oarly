import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/env', () => ({ env: { APP_URL: 'https://oarly.sbs' } }));
const getClubBySlug = vi.fn();
vi.mock('@/lib/tenant', () => ({ getClubBySlug: (s: string) => getClubBySlug(s) }));
const getCurrentUser = vi.fn();
vi.mock('@/lib/session', () => ({ getCurrentUser: () => getCurrentUser() }));
// getMembership is exported from the module under test; spy via a partial mock:
vi.mock('@/db', () => ({ db: {} }));
const redirectMock = vi.fn<(u: string) => never>(() => { throw new Error('REDIRECT'); });
const notFoundMock = vi.fn(() => { throw new Error('NOT_FOUND'); });
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirectMock(u), notFound: () => notFoundMock() }));

import * as mod from './membership';

beforeEach(() => { vi.restoreAllMocks(); getClubBySlug.mockReset(); getCurrentUser.mockReset(); redirectMock.mockClear(); notFoundMock.mockClear(); });

describe('requireOwner', () => {
  it('redirects to apex sign-in (absolute) when signed out', async () => {
    getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status: 'active' });
    getCurrentUser.mockResolvedValue(null);
    await expect(mod.requireOwner('demo', '/manage/members')).rejects.toThrow('REDIRECT');
    const target = redirectMock.mock.calls[0][0] as string;
    expect(target).toContain('https://oarly.sbs/sign-in?redirect=');
    expect(decodeURIComponent(target)).toContain('https://demo.oarly.sbs/manage/members');
  });
  it('notFound()s when the user is not an approved owner', async () => {
    getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status: 'active' });
    getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
    vi.spyOn(mod, 'getMembership').mockResolvedValue(null);
    await expect(mod.requireOwner('demo')).rejects.toThrow('NOT_FOUND');
  });
});
