import { cache } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  it.each(['suspended', 'pending'] as const)(
    'notFound()s for an approved owner when the club is %s — server actions must not outlive the layout gate',
    async (status) => {
      getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status });
      getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
      vi.spyOn(mod, 'getMembership').mockResolvedValue(
        { id: 'm1', role: 'owner', status: 'approved', bannedUntil: null } as never,
      );
      await expect(mod.requireOwner('demo')).rejects.toThrow('NOT_FOUND');
    },
  );
  it('returns the club for an approved owner of an active club', async () => {
    getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status: 'active' });
    getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
    vi.spyOn(mod, 'getMembership').mockResolvedValue(
      { id: 'm1', role: 'owner', status: 'approved', bannedUntil: null } as never,
    );
    await expect(mod.requireOwner('demo')).resolves.toMatchObject({ club: { id: 'club1' } });
  });
});

describe('requireMember', () => {
  it.each(['suspended', 'pending'] as const)(
    'notFound()s for an approved member when the club is %s',
    async (status) => {
      getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status });
      getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
      vi.spyOn(mod, 'getMembership').mockResolvedValue(
        { id: 'm1', role: 'member', status: 'approved', bannedUntil: null } as never,
      );
      await expect(mod.requireMember('demo')).rejects.toThrow('NOT_FOUND');
    },
  );
  it('returns the club for an approved member of an active club', async () => {
    getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status: 'active' });
    getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
    vi.spyOn(mod, 'getMembership').mockResolvedValue(
      { id: 'm1', role: 'member', status: 'approved', bannedUntil: null } as never,
    );
    await expect(mod.requireMember('demo')).resolves.toMatchObject({ club: { id: 'club1' } });
  });

  /**
   * The half `requireMemberView` deliberately does NOT do, and — until this test — the
   * only branch of either guard with no coverage at all. A ban gates ACQUISITION: the
   * strict guard has to keep refusing a member serving a live timed pause even though
   * their status is still `approved`, which is the shape a timed penalty leaves behind
   * (`recomputeBan` only writes `status = 'banned'` for a permanent row).
   *
   * A LAPSED ban is asserted alongside it, because "rejects when bannedUntil is set" is
   * satisfied by a guard that ignores the date entirely and refuses anyone who has ever
   * been penalised.
   */
  it('notFound()s for an approved member serving a live timed ban, but not a lapsed one', async () => {
    getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status: 'active' });
    getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
    const spy = vi.spyOn(mod, 'getMembership');

    spy.mockResolvedValue({ id: 'm1', role: 'member', status: 'approved', bannedUntil: new Date(Date.now() + 3600_000) } as never);
    await expect(mod.requireMember('demo')).rejects.toThrow('NOT_FOUND');

    spy.mockResolvedValue({ id: 'm1', role: 'member', status: 'approved', bannedUntil: new Date(Date.now() - 3600_000) } as never);
    await expect(mod.requireMember('demo')).resolves.toMatchObject({ club: { id: 'club1' } });
  });
});

describe('requireMemberView', () => {
  const approvedMembership = { id: 'm1', role: 'member', status: 'approved', bannedUntil: null };

  it('requireMemberView admits a member with an active ban so the page can explain it', async () => {
    // requireMember 404s a banned member, which would leave them staring at a bare
    // "not found" with no idea why. The view guard must let them through.
    getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status: 'active' });
    getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
    vi.spyOn(mod, 'getMembership').mockResolvedValue({
      ...approvedMembership,
      bannedUntil: new Date(Date.now() + 60 * 60 * 1000),
    } as never);
    const result = await mod.requireMemberView('demo', '/book');
    expect(result.membership.bannedUntil).toBeInstanceOf(Date);
  });

  it('requireMemberView admits a permanently banned membership', async () => {
    getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status: 'active' });
    getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
    vi.spyOn(mod, 'getMembership').mockResolvedValue({ ...approvedMembership, status: 'banned' } as never);
    const result = await mod.requireMemberView('demo', '/book');
    expect(result.membership.status).toBe('banned');
  });

  it('requireMemberView still rejects a pending membership', async () => {
    getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status: 'active' });
    getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
    vi.spyOn(mod, 'getMembership').mockResolvedValue({ ...approvedMembership, status: 'pending' } as never);
    await expect(mod.requireMemberView('demo', '/book')).rejects.toThrow('NOT_FOUND');
  });

  it.each(['suspended', 'pending'] as const)(
    'notFound()s for an approved member when the club is %s — server actions must not outlive the layout gate',
    async (status) => {
      getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status });
      getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
      vi.spyOn(mod, 'getMembership').mockResolvedValue(approvedMembership as never);
      await expect(mod.requireMemberView('demo')).rejects.toThrow('NOT_FOUND');
    },
  );

  it('notFound()s when there is no membership at all', async () => {
    getClubBySlug.mockResolvedValue({ id: 'club1', slug: 'demo', status: 'active' });
    getCurrentUser.mockResolvedValue({ id: 'u1', isAdmin: false });
    vi.spyOn(mod, 'getMembership').mockResolvedValue(null);
    await expect(mod.requireMemberView('demo')).rejects.toThrow('NOT_FOUND');
  });
});

/**
 * Why the cases below use a distinct (userId, clubId) pair each — and what this file can
 * and cannot say about `cache()`.
 *
 * NOT because reusing a pair risks a stale cached Promise. `getMembership` is
 * `cache()`-wrapped, and in production that memoizes per RSC render and NOT outside one —
 * for the reason set out on `getMembership` itself, which is the store
 * `DefaultAsyncDispatcher.getCacheForType` hands back (a fresh `Map` whenever
 * `resolveRequest()` is null), not the absence of a dispatcher.
 *
 * NONE OF THAT IS OBSERVABLE FROM HERE, and the check below exists to say so mechanically
 * rather than in prose. This test file has never run an RSC render, but that is not even
 * the reason: vitest resolves `react` WITHOUT the `react-server` export condition
 * (`node_modules/react/package.json` `exports["."]`), so the `cache` in this process is
 * the CLIENT build's — `exports.cache = function (fn) { return function () { return
 * fn.apply(null, arguments); }; }` (`node_modules/react/cjs/react.development.js:917-921`),
 * a passthrough that consults no dispatcher and memoizes nothing under any conditions. A
 * counter that increments twice here is that passthrough, and it is compatible with every
 * hypothesis about production; it distinguishes nothing.
 *
 * So distinct pairs are used only so each case reads standalone.
 */
describe('what this process can observe about cache()', () => {
  it('resolves react to the client build, whose cache() ignores a dispatcher entirely', async () => {
    const React = (await import('react')) as unknown as Record<string, unknown>;
    const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as
      { A: unknown } | undefined;
    // Undefined means `react` now resolves to the react-server build in this process, and
    // the paragraph above no longer describes it — the note has to be re-derived, not the
    // assertion relaxed.
    expect(internals).toBeDefined();

    let calls = 0;
    const counted = cache((key: string) => { calls += 1; return `${key}:${calls}`; });

    // A real memoizing dispatcher, the shape `getCacheForType` is called with. Under the
    // react-server build this makes `cache()` memoize; under the client build's
    // passthrough it changes nothing, which is the whole point.
    const store = new Map<unknown, unknown>();
    const previous = internals!.A;
    internals!.A = {
      getCacheForType: (resourceType: () => unknown) => {
        if (!store.has(resourceType)) store.set(resourceType, resourceType());
        return store.get(resourceType);
      },
      cacheSignal: () => null,
    };
    try {
      counted('same-key');
      counted('same-key');
    } finally {
      internals!.A = previous;
    }

    expect(calls).toBe(2);
  });
});

describe('getMemberRestriction', () => {
  it('is none for a visitor with no membership row, without reaching getRestriction\'s query', async () => {
    vi.spyOn(mod, 'getMembership').mockResolvedValue(null);
    await expect(mod.getMemberRestriction('no-member-user', 'club-a')).resolves.toEqual({ state: 'none' });
  });

  // An unrestricted membership: `getRestriction` short-circuits before touching the DB
  // (see its own doc comment), so this exercises the composition without needing a
  // real `db`.
  it('delegates to getRestriction for an existing, unrestricted membership', async () => {
    vi.spyOn(mod, 'getMembership').mockResolvedValue(
      { id: 'm-unrestricted', status: 'approved', bannedUntil: null } as never,
    );
    await expect(mod.getMemberRestriction('healthy-user', 'club-b')).resolves.toEqual({ state: 'none' });
  });

  it('looks the membership up by the userId and clubId it was given', async () => {
    const spy = vi.spyOn(mod, 'getMembership').mockResolvedValue(null);
    await mod.getMemberRestriction('lookup-user', 'club-c');
    expect(spy).toHaveBeenCalledWith(expect.anything(), 'lookup-user', 'club-c');
  });
});
