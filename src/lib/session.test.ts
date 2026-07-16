import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionMock, redirectMock, notFoundMock } = vi.hoisted(() => {
  const getSessionMock = vi.fn();
  const redirectMock = vi.fn(() => { throw new Error('REDIRECT'); });
  const notFoundMock = vi.fn(() => { throw new Error('NOT_FOUND'); });
  return { getSessionMock, redirectMock, notFoundMock };
});

vi.mock('@/auth', () => ({ auth: { api: { getSession: getSessionMock } } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
  notFound: () => notFoundMock(),
}));

import { getCurrentUser, requireUser, requireAdmin } from './session';

beforeEach(() => { getSessionMock.mockReset(); redirectMock.mockClear(); notFoundMock.mockClear(); });

describe('session guards', () => {
  it('getCurrentUser returns null when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });
  it('requireUser redirects to sign-in with the return path', async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(requireUser('/admin')).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/sign-in?redirect=%2Fadmin');
  });
  it('requireAdmin notFound()s a non-admin user', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false }, session: {} });
    await expect(requireAdmin()).rejects.toThrow('NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
  });
  it('requireAdmin returns an admin user', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true }, session: {} });
    expect((await requireAdmin()).id).toBe('u1');
  });
});
