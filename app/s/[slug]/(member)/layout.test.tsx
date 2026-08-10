// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireClub, getCurrentUser, getMemberRestriction } = vi.hoisted(() => ({
  requireClub: vi.fn(),
  getCurrentUser: vi.fn(),
  getMemberRestriction: vi.fn(),
}));
vi.mock('@/lib/tenant', () => ({ requireClub }));
vi.mock('@/lib/session', () => ({ getCurrentUser }));
vi.mock('@/lib/membership', () => ({ getMemberRestriction }));
vi.mock('@/components/user-menu', () => ({ UserMenu: () => null }));
vi.mock('@/env', () => ({ env: { APP_URL: 'http://localhost:3000' } }));
/*
  A stub that EXPOSES `restricted`, not one that ignores it — a stub that ignores its
  props cannot see this layout failing to thread the value, which is exactly how the
  last one shipped (see `src/lib/membership.ts`'s doc comment on `getMemberRestriction`).
*/
vi.mock('@/components/member-tabs', () => ({
  MemberTabs: ({ restricted }: { restricted: boolean }) => <nav data-testid="tabs" data-restricted={String(restricted)} />,
}));

import MemberLayout from './layout';

const CLUB = { id: 'club-1', name: 'Demo', logoUrl: null };
const USER = { id: 'u1', name: 'A', email: 'a@b.test', image: null };

const render_ = async () => render(await MemberLayout({
  children: <p>body</p>,
  params: Promise.resolve({ slug: 'demo' }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  requireClub.mockResolvedValue(CLUB);
  getCurrentUser.mockResolvedValue(USER);
  getMemberRestriction.mockResolvedValue({ state: 'none' });
});

describe('MemberLayout', () => {
  it('tells the tabs an unrestricted member is unrestricted', async () => {
    await render_();
    expect(screen.getByTestId('tabs')).toHaveAttribute('data-restricted', 'false');
  });

  it.each(['paused', 'suspended'] as const)('tells the tabs a %s member is restricted', async (state) => {
    getMemberRestriction.mockResolvedValue({ state });
    await render_();
    expect(screen.getByTestId('tabs')).toHaveAttribute('data-restricted', 'true');
  });

  // Threaded, not recomputed: the layout's own gate for the tab comes from one call,
  // through the request-memoized helper — not a second, ad hoc getRestriction.
  it('asks for the restriction exactly once, keyed on the signed-in user and this club', async () => {
    await render_();
    expect(getMemberRestriction).toHaveBeenCalledTimes(1);
    expect(getMemberRestriction).toHaveBeenCalledWith(USER.id, CLUB.id);
  });

  // A guest browsing a club's tenant pages has no membership to be restricted from —
  // not "unknown", `'none'`, and reached without asking the request-memoized helper
  // for a user id that does not exist.
  it('treats a signed-out visitor as unrestricted without calling getMemberRestriction', async () => {
    getCurrentUser.mockResolvedValue(null);
    await render_();
    expect(screen.getByTestId('tabs')).toHaveAttribute('data-restricted', 'false');
    expect(getMemberRestriction).not.toHaveBeenCalled();
  });

  it('still renders the page content beneath the tabs', async () => {
    await render_();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});
