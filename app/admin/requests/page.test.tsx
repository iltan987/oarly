// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

type Row = { id: string; name: string; slug: string; status: string };

let rows: Row[] = [];

vi.mock('@/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }) }) },
}));

vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));

// Mocked even though this page no longer imports it: without the mock, re-adding the
// control makes this file die on `@/lib/session` -> `src/auth.ts` reading a server-only
// env var, and the test would then "fail" for a reason that has nothing to do with the
// control being present. With it, a restored button renders and the assertion below is
// what fails.
vi.mock('../club-status-button', () => ({
  ClubStatusButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

import AdminClubRequestsPage from './page';

describe('AdminClubRequestsPage', () => {
  // `setClubStatus` refuses a `pending` club, so the old `<ClubStatusButton
  // targetStatus="active">` here could not approve anything — it was an approve path
  // that failed every time, under copy written for the clubs list ("Only an approved
  // club can be suspended or reinstated") that reads as nonsense on this page. The
  // queue lists requests until the real decide UI replaces it; it must not offer a
  // control it cannot honour.
  it('lists a pending request without offering any status control', async () => {
    rows = [{ id: 'c1', name: 'Boğaziçi Kürek', slug: 'bogazici', status: 'pending' }];
    render(await AdminClubRequestsPage());

    expect(screen.getByText('Boğaziçi Kürek')).toBeInTheDocument();
    expect(screen.getByText('statusPending')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows the empty state when nothing is pending', async () => {
    rows = [];
    render(await AdminClubRequestsPage());
    expect(screen.getByText('noRequests')).toBeInTheDocument();
  });
});
