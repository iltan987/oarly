// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as UsersAdmin from '@/lib/users-admin';

type AdminUserRow = UsersAdmin.AdminUserRow;

// `@/db` reads server-only env at module load. Left unmocked under jsdom it fails with
// "Attempted to access a server-side environment variable on the client" and takes the
// whole FILE down — `0 test`, which is an absent assertion, not a failing one.
vi.mock('@/db', () => ({ db: {} }));

const searchUsers = vi.fn<
  (db: unknown, opts: { q?: string; page?: number; pageSize?: number }) =>
  Promise<{ rows: AdminUserRow[]; total: number; page: number; pageSize: number }>
>();
// `importOriginal` rather than a hand-written module: `USERS_PAGE_SIZE` is what the
// route divides its row range by, so the assertions below are against the real
// constant and not a copy of it that can drift.
vi.mock('@/lib/users-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof UsersAdmin>()),
  searchUsers: (...args: Parameters<typeof searchUsers>) => searchUsers(...args),
}));

vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve(
    (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  ),
}));

// A client component with its own next-intl boundary; the page's own paging URLs and
// row range are what this file is about.
vi.mock('./admin-toggle', () => ({ AdminToggle: () => null }));

import AdminUsersPage from './page';

async function renderPage(sp: Record<string, string | string[]>) {
  render(await AdminUsersPage({ searchParams: Promise.resolve(sp) }));
}

function result(over: { total?: number; page?: number; rows?: AdminUserRow[] } = {}) {
  return Promise.resolve({
    rows: over.rows ?? [], total: over.total ?? 0, page: over.page ?? 1, pageSize: 25,
  });
}

const pageArg = () => searchUsers.mock.calls[0][1].page;

beforeEach(() => {
  searchUsers.mockReset();
  searchUsers.mockReturnValue(result());
});

describe('AdminUsersPage', () => {
  // Each of these used to reach `OFFSET (page - 1) * 25` and be rejected by Postgres as
  // a bigint, escaping the render as a 500 on a URL anyone can hand-edit. `/admin/audit`
  // hardened its cursor against the same class of input two commits earlier.
  it.each([
    ['a fractional page', '1.5', 1],
    ['a non-finite page', 'Infinity', 1],
    ['a huge exponent', '1e20', 1_000_000],
    ['a negative page', '-2', 1],
    ['a page of zero', '0', 1],
    ['text', 'abc', 1],
  ] as const)('sends a whole, in-range page to the query for %s', async (_label, page, expected) => {
    await renderPage({ page });
    expect(pageArg()).toBe(expected);
    expect(Number.isSafeInteger(pageArg())).toBe(true);
  });

  it('defaults to page 1 with no page parameter', async () => {
    await renderPage({});
    expect(searchUsers).toHaveBeenCalledWith({}, { q: undefined, page: 1, pageSize: 25 });
  });

  it('reads the first occurrence of a repeated parameter', async () => {
    await renderPage({ q: [' ada ', 'bob'], page: ['2', '3'] });
    expect(searchUsers).toHaveBeenCalledWith({}, { q: 'ada', page: 2, pageSize: 25 });
  });

  // The library pulls an out-of-range page back to the last one that exists, and the
  // range and the links have to describe THAT page. Reading the requested page instead
  // rendered "24951-100 of 100" over the empty state, with a Previous link to ?page=998.
  it('renders the range and the Previous link for the page the query actually returned', async () => {
    searchUsers.mockReturnValue(result({ total: 100, page: 4 }));
    await renderPage({ page: '999' });

    expect(screen.getByText('paginationRange:{"from":76,"to":100,"total":100}')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'paginationPrev' }).getAttribute('href'))
      .toBe('/admin/users?page=3');
    expect(screen.queryByRole('link', { name: 'paginationNext' })).toBeNull();
  });

  it('renders the empty state, and no pagination, when nothing matches', async () => {
    searchUsers.mockReturnValue(result({ total: 0, page: 1 }));
    await renderPage({ q: 'nobody' });
    expect(screen.getByText('usersEmpty')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'paginationNext' })).toBeNull();
  });

  it('carries the search term across a page change', async () => {
    searchUsers.mockReturnValue(result({ total: 100, page: 1 }));
    await renderPage({ q: 'ada' });
    const next = screen.getByRole('link', { name: 'paginationNext' }).getAttribute('href');
    const url = new URL(next ?? '', 'http://x');
    expect(url.searchParams.get('q')).toBe('ada');
    expect(url.searchParams.get('page')).toBe('2');
  });
});
