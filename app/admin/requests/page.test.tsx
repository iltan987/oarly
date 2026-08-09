// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string; name: string; slug: string; createdAt: Date;
  requesterName: string | null; requesterEmail: string | null;
};

const { listPendingClubRequests } = vi.hoisted(() => ({ listPendingClubRequests: vi.fn() }));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/clubs-admin', () => ({ CLUB_REQUESTS_PAGE_SIZE: 25, listPendingClubRequests }));

vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key)),
}));

// The decision pair is stubbed to the two labels it renders, so this file asserts that
// the QUEUE offers a decision at all and wires the right club to it. What the controls
// do once clicked — the confirmations, the required note — is decision-buttons.test.tsx.
vi.mock('./decision-buttons', () => ({
  DecisionButtons: ({ clubId, clubName }: { clubId: string; clubName: string }) => (
    <button type="button" data-club-id={clubId}>decide {clubName}</button>
  ),
}));

// Mocked even though this page must no longer import it: without the mock, re-adding
// the control makes this file die on `@/lib/session` -> `src/auth.ts` reading a
// server-only env var at module load, and the file would then "fail" with zero tests
// run — for a reason that has nothing to do with the control being back. With it, a
// restored button renders and the assertion below is what fails.
vi.mock('../club-status-button', () => ({
  ClubStatusButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

import AdminClubRequestsPage from './page';

// A real uuid: `clubs.id` is a `uuid` column, so `c1` is an id this page could never
// have been handed, and a link built from it is a link the app cannot serve.
function mkRow(over: Partial<Row> = {}): Row {
  return {
    id: randomUUID(), name: 'Boğaziçi Kürek', slug: 'bogazici',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    requesterName: 'Ada', requesterEmail: 'ada@example.com', ...over,
  };
}

async function renderRows(
  rows: Row[],
  searchParams: Record<string, string | string[] | undefined> = {},
  total = rows.length,
) {
  listPendingClubRequests.mockResolvedValue({ rows, total, page: 1, pageSize: 25 });
  render(await AdminClubRequestsPage({ searchParams: Promise.resolve(searchParams) }));
}

describe('AdminClubRequestsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // Before this page was rebuilt there was NO way to approve a club request anywhere in
  // the application, and no way to reject one at all: the old approve control was a
  // `ClubStatusButton targetStatus="active"`, which `setClubStatus` now refuses on a
  // `pending` club, so it was hidden rather than left failing on every click.
  it('offers a decision on each pending request, keyed to that club', async () => {
    const row = mkRow();
    await renderRows([row]);

    expect(screen.getByText('Boğaziçi Kürek')).toBeInTheDocument();
    expect(screen.getByText('statusPending')).toBeInTheDocument();
    const decide = screen.getByRole('button', { name: 'decide Boğaziçi Kürek' });
    expect(decide).toHaveAttribute('data-club-id', row.id);
  });

  // The suspend/reinstate control must not come back here: sharing it is what made
  // approving a new club and un-suspending an old one indistinguishable in the audit
  // log (spec §5.3), and it cannot act on a `pending` club anyway.
  it('offers no suspend/reinstate control', async () => {
    await renderRows([mkRow()]);
    expect(screen.queryByRole('button', { name: 'activate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'suspend' })).toBeNull();
  });

  it('links each request to its club detail page', async () => {
    const row = mkRow();
    await renderRows([row]);
    expect(screen.getByRole('link', { name: 'Boğaziçi Kürek' })).toHaveAttribute('href', `/admin/clubs/${row.id}`);
  });

  it('names the requester', async () => {
    await renderRows([mkRow()]);
    expect(screen.getByText('requestBy:{"name":"Ada <ada@example.com>"}')).toBeInTheDocument();
  });

  // `clubs.created_by` is `on delete set null`. Such a request must still be listed AND
  // still be decidable — the queue is the only place it can leave `pending`, and a club
  // stuck there holds its slug against the partial unique index forever.
  it('still lists and offers a decision on a request whose requester is gone', async () => {
    await renderRows([mkRow({ requesterName: null, requesterEmail: null })]);
    expect(screen.getByText('requestByUnknown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'decide Boğaziçi Kürek' })).toBeInTheDocument();
  });

  it('shows the empty state when nothing is pending', async () => {
    await renderRows([]);
    expect(screen.getByText('noRequests')).toBeInTheDocument();
  });
});

// Nothing expires a `pending` request and nothing but a human decides one, so this
// queue grows without bound — and every row it renders mounts a client component with
// its own `useActionState` and `Dialog`. It must ask for one page, exactly like the
// clubs and users lists.
describe('AdminClubRequestsPage pagination', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('asks the library for one page, never for the whole queue', async () => {
    await renderRows([mkRow()]);
    expect(listPendingClubRequests).toHaveBeenCalledWith({}, { page: 1, pageSize: 25 });
  });

  it.each(['1.5', 'Infinity', '1e20', '-4', 'abc'])('normalizes ?page=%s before the query', async (page) => {
    await renderRows([mkRow()], { page });
    const [, opts] = listPendingClubRequests.mock.calls[0] as unknown as [unknown, { page: number }];
    expect(Number.isSafeInteger(opts.page)).toBe(true);
    expect(opts.page).toBeGreaterThanOrEqual(1);
  });

  // `?page=2&page=9` arrives as `string[]`; `Number(['2','9'])` is `NaN`, and reading it
  // with a string method is a TypeError out of the render.
  it('survives a repeated page parameter', async () => {
    await renderRows([mkRow()], { page: ['2', '9'] });
    expect(listPendingClubRequests).toHaveBeenCalledWith({}, { page: 2, pageSize: 25 });
  });

  it('describes the row range using the page the library actually returned', async () => {
    listPendingClubRequests.mockResolvedValue({ rows: [mkRow()], total: 60, page: 3, pageSize: 25 });
    render(await AdminClubRequestsPage({ searchParams: Promise.resolve({ page: '3' }) }));
    // 51–60 of 60, not 51–75: the range must not promise rows past the end. Page 3 of 3
    // is the last, so there is a Previous link and no Next.
    expect(screen.getByText('paginationRange:{"from":51,"to":60,"total":60}')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'paginationPrev' })).toHaveAttribute('href', '/admin/requests?page=2');
    expect(screen.queryByRole('link', { name: 'paginationNext' })).toBeNull();
  });

  it('renders no pagination bar when the queue fits on one page', async () => {
    await renderRows([mkRow()]);
    expect(screen.queryByRole('link', { name: 'paginationNext' })).toBeNull();
  });

  // The empty state is keyed on the TOTAL, not on this page being empty: keying it on
  // `rows.length` would answer `?page=999` with "No pending requests" while a queue of
  // thousands sat behind it.
  it('does not claim the queue is empty when only this page is', async () => {
    listPendingClubRequests.mockResolvedValue({ rows: [], total: 400, page: 16, pageSize: 25 });
    render(await AdminClubRequestsPage({ searchParams: Promise.resolve({ page: '999' }) }));
    expect(screen.queryByText('noRequests')).toBeNull();
  });
});
