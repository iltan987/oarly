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
vi.mock('@/lib/clubs-admin', () => ({ listPendingClubRequests }));

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

async function renderRows(rows: Row[]) {
  listPendingClubRequests.mockResolvedValue(rows);
  render(await AdminClubRequestsPage());
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
