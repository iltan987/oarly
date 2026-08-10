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
// row range are what this file is about. It renders a marker rather than `null` because
// the row's grid arity is asserted below — a cell that renders nothing is still a cell,
// but a component returning `null` produces no element at all and would make the row look
// one column short for reasons that have nothing to do with the page.
vi.mock('./admin-toggle', () => ({
  AdminToggle: ({ userName }: { userName: string }) => <button type="button">toggle-{userName}</button>,
}));

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

describe('AdminUsersPage membership lines', () => {
  /**
   * These were the only hardcoded user-visible strings in app/admin: each membership
   * line rendered `{m.role} / {m.status}`, the raw Postgres enums, so a Turkish
   * operator read "Kayıkhane — owner / approved" on an otherwise fully Turkish page.
   */
  it('localizes the membership role and status instead of rendering the enums', async () => {
    searchUsers.mockReturnValue(result({
      total: 1,
      rows: [{
        id: 'u1', name: 'Ayşe', email: 'ayse@example.com', isAdmin: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        memberships: [{ clubId: 'c1', clubName: 'Kayıkhane', role: 'owner', status: 'approved' }],
      }],
    }));
    await renderPage({});
    expect(screen.getByText('Kayıkhane — roleOwner / memberStatusApproved')).toBeInTheDocument();
    expect(screen.queryByText(/owner \/ approved/)).toBeNull();
  });

  it.each([
    ['member', 'pending', 'roleMember', 'memberStatusPending'],
    ['admin', 'banned', 'roleAdmin', 'memberStatusBanned'],
    ['member', 'rejected', 'roleMember', 'memberStatusRejected'],
  ] as const)('localizes %s / %s', async (role, status, roleKey, statusKey) => {
    searchUsers.mockReturnValue(result({
      total: 1,
      rows: [{
        id: 'u1', name: 'Ayşe', email: 'ayse@example.com', isAdmin: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        memberships: [{ clubId: 'c1', clubName: 'Kayıkhane', role, status }],
      }],
    }));
    await renderPage({});
    expect(screen.getByText(`Kayıkhane — ${roleKey} / ${statusKey}`)).toBeInTheDocument();
  });
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

describe('AdminUsersPage list density', () => {
  function mkUser(over: Partial<AdminUserRow> = {}): AdminUserRow {
    return {
      id: 'u1', name: 'Ayşe', email: 'ayse@example.com', isAdmin: false,
      createdAt: new Date('2026-01-01T00:00:00Z'), memberships: [], ...over,
    };
  }

  const club = (clubId: string, clubName: string): AdminUserRow['memberships'][number] =>
    ({ clubId, clubName, role: 'member', status: 'approved' });

  /** `[row, identity wrapper]` for a user, walked UP from their admin toggle. */
  function rowOf(name: string): [HTMLElement, HTMLElement] {
    const row = screen.getByRole('button', { name: `toggle-${name}` }).parentElement;
    const identity = row?.children[0] as HTMLElement | undefined;
    if (!row || !identity) throw new Error(`no row for ${name}`);
    return [row, identity];
  }

  async function renderUser(over: Partial<AdminUserRow> = {}) {
    searchUsers.mockReturnValue(result({ total: 1, rows: [mkUser(over)] }));
    await renderPage({});
  }

  /**
   * The memberships list is the tallest element on this page — a user in six clubs is six
   * lines — and it sat UNDER the identity, so every row was as tall as its own club list.
   * Beside it, in a `1fr` column, the page is roughly 40% shorter with nothing removed.
   *
   * jsdom cannot lay out; the declaration is what is pinned, and the measurement is in the
   * task report. `toHaveClass` matches exact tokens, so `18rem → 12rem` fails this.
   * Asserted on the row element rather than by class query — `Card` and `StatusPill` are
   * shadcn primitives carrying their own layout classes.
   */
  it('puts the club list beside the identity at lg instead of under it', async () => {
    await renderUser({ memberships: [club('c1', 'Kayıkhane'), club('c2', 'Bebek')] });
    const [row] = rowOf('Ayşe');
    expect(row).toHaveClass('lg:grid', 'lg:grid-cols-[18rem_1fr_9rem]', 'lg:items-start');
    // Below `lg:` the row is unchanged: the wrapping stack this page already had.
    expect(row).toHaveClass('flex', 'flex-wrap', 'items-start');
  });

  /**
   * The half the grid template cannot show. The identity and the club list are children of
   * a wrapper, and a grid lays out only its OWN children — so without `lg:contents` the
   * three-track template is fed two items, the whole stack lands in `18rem`, `1fr` goes
   * empty and the page renders exactly as it did before. The template assertion above
   * passes either way, which is why this is asserted separately, on the wrapper element.
   */
  it('promotes the identity and the club list into the row grid', async () => {
    await renderUser({ memberships: [club('c1', 'Kayıkhane')] });
    const [row, identity] = rowOf('Ayşe');
    expect(identity).toHaveClass('lg:contents');
    expect(identity.children).toHaveLength(2);
    expect(identity.children[0]).toHaveTextContent('ayse@example.com');
    expect(identity.children[1]).toHaveTextContent('Kayıkhane');
    // Identity, club list, toggle — the three tracks, all fed.
    expect(row.children).toHaveLength(2);
  });

  /**
   * A user in no club still occupies the middle cell. Rendering nothing there — the
   * obvious tidy-up, since the sentence is only a placeholder — collapses those rows to
   * two columns and pulls the admin toggle left on exactly the users who look ordinary,
   * which is the ragged column this task removes. The same defect `/manage/members` fixed
   * for its always-present status cell.
   */
  it('keeps the club-list cell for a user who belongs to no club', async () => {
    await renderUser({ memberships: [] });
    const [, identity] = rowOf('Ayşe');
    expect(identity.children).toHaveLength(2);
    expect(identity.children[1]).toHaveTextContent('usersNoMemberships');
  });

  /**
   * What lets a long email and a long club name wrap inside their columns instead of
   * forcing the row wider. Pinned in jsdom rather than measured: `Card` carries
   * `overflow-hidden` (`ui/card.tsx:16`), so an over-wide value is CLIPPED, never
   * scrolled, and `documentElement.scrollWidth` is identical with these deleted. A grid
   * item's automatic minimum size is its CONTENT, which is what `min-w-0` caps.
   */
  it('lets a long email and a long club name wrap rather than force the row wider', async () => {
    await renderUser({
      email: 'cok.uzun.bir.eposta.adresi@bogazici-universitesi-kurek.example.com',
      memberships: [club('c1', 'Boğaziçi Üniversitesi Kürek ve Yelken İhtisas Kulübü')],
    });
    const [, identity] = rowOf('Ayşe');
    expect(identity.children[0]).toHaveClass('min-w-0');
    expect(screen.getByText('cok.uzun.bir.eposta.adresi@bogazici-universitesi-kurek.example.com'))
      .toHaveClass('break-words');
    expect(identity.children[1]).toHaveClass('min-w-0', 'break-words');
  });

  /**
   * `flex gap-2` with no cap let the <Input> grow to the full 1024px canvas — a
   * console-wide box for a name-or-email search.
   *
   * Deliberate break: delete `max-w-md` and this fails.
   */
  it('caps the search box rather than letting it take the whole canvas', async () => {
    await renderPage({});
    const form = screen.getByRole('textbox', { name: 'usersSearch' }).closest('form');
    expect(form).toHaveClass('max-w-md');
    // On the form, not on the Input: capping the Input alone strands the submit button at
    // the far right of the canvas.
    expect(screen.getByRole('textbox', { name: 'usersSearch' })).not.toHaveClass('max-w-md');
  });
});
