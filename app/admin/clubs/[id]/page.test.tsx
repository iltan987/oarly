// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClubAdminDetail } from '@/lib/clubs-admin';

// `@/db` reads server-only env at module load. Left unmocked under jsdom it fails with
// "Attempted to access a server-side environment variable on the client" and takes the
// whole FILE down — `0 test`, which is not a failing assertion but an absent one.
vi.mock('@/db', () => ({ db: {} }));

const getClubAdminDetail = vi.fn<(db: unknown, id: string) => Promise<ClubAdminDetail | null>>();
vi.mock('@/lib/clubs-admin', () => ({
  getClubAdminDetail: (...args: Parameters<typeof getClubAdminDetail>) => getClubAdminDetail(...args),
}));

const listAuditRows = vi.fn(() => Promise.resolve({ rows: [], nextCursor: null }));
vi.mock('@/lib/audit', () => ({ listAuditRows: (...args: unknown[]) => listAuditRows(...args as []) }));

vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key)),
  getLocale: () => Promise.resolve('en'),
}));

class NotFound extends Error {}
vi.mock('next/navigation', () => ({ notFound: () => { throw new NotFound(); } }));

// Both are client components whose own behaviour is covered by their own suites; here
// they are stand-ins so this file can assert WHICH props the page hands them.
vi.mock('../../club-status-button', () => ({
  ClubStatusButton: ({ targetStatus, label }: { targetStatus: string; label: string }) =>
    <div data-testid="status-button" data-target={targetStatus}>{label}</div>,
}));
vi.mock('./transfer-owner', () => ({
  TransferOwner: ({ clubName, candidates }: { clubName: string; candidates: unknown[] }) =>
    <div data-testid="transfer" data-club={clubName} data-count={candidates.length} />,
}));

import AdminClubDetailPage from './page';

const CLUB_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function detail(overrides: Partial<ClubAdminDetail> = {}, club: Record<string, unknown> = {}): ClubAdminDetail {
  return {
    club: {
      id: CLUB_ID, slug: 'bogazici', name: 'Boğaziçi', status: 'active',
      timezone: 'Europe/Istanbul', reviewNote: null, reviewedBy: null,
      ...club,
    } as ClubAdminDetail['club'],
    reviewedByName: null,
    owners: [{ userId: 'u1', name: 'Ada', email: 'ada@example.com' }],
    memberCounts: { pending: 1, approved: 2, rejected: 0, banned: 3 },
    transferCandidates: [{ userId: 'u2', name: 'Bora', email: 'bora@example.com' }],
    boatCount: 4,
    windowCount: 5,
    ...overrides,
  };
}

async function renderPage() {
  render(await AdminClubDetailPage({ params: Promise.resolve({ id: CLUB_ID }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  listAuditRows.mockReturnValue(Promise.resolve({ rows: [], nextCursor: null }));
});

describe('AdminClubDetailPage', () => {
  // Keyed by id, not slug: `clubs_slug_uq` is a PARTIAL index that exempts rejected
  // rows, so a slug can name two clubs at once (spec §6.1).
  it('looks the club up by the route id and scopes the audit read to it', async () => {
    getClubAdminDetail.mockResolvedValue(detail());
    await renderPage();

    expect(getClubAdminDetail).toHaveBeenCalledWith({}, CLUB_ID);
    // Club-scoped and bounded — `audit_log_club_created_at_id_idx` exists for this
    // call, and an unfiltered read would merge every club's history onto this page.
    expect(listAuditRows).toHaveBeenCalledWith({}, { filters: { clubId: CLUB_ID }, limit: 20 });
  });

  it('404s on an unknown id instead of rendering an empty club', async () => {
    getClubAdminDetail.mockResolvedValue(null);
    await expect(renderPage()).rejects.toBeInstanceOf(NotFound);
  });

  it('hands the transfer control the club name and only the eligible candidates', async () => {
    getClubAdminDetail.mockResolvedValue(detail());
    await renderPage();

    const transfer = screen.getByTestId('transfer');
    expect(transfer).toHaveAttribute('data-club', 'Boğaziçi');
    expect(transfer).toHaveAttribute('data-count', '1');
  });

  it('reports a club with no owner rather than rendering an empty list', async () => {
    getClubAdminDetail.mockResolvedValue(detail({ owners: [] }));
    await renderPage();
    expect(screen.getByText('detailNoOwner')).toBeInTheDocument();
  });

  // Only a DECIDED club may be suspended or reinstated; `setClubStatus` refuses
  // `pending` and `rejected` outright, so offering the control there is a button that
  // can only ever error (spec §5.3).
  it.each([
    ['active', 'suspended'],
    ['suspended', 'active'],
  ] as const)('offers the status toggle on a %s club, targeting %s', async (status, target) => {
    getClubAdminDetail.mockResolvedValue(detail({}, { status }));
    await renderPage();
    expect(screen.getByTestId('status-button')).toHaveAttribute('data-target', target);
  });

  it.each(['pending', 'rejected'] as const)('offers no status toggle on a %s club', async (status) => {
    getClubAdminDetail.mockResolvedValue(detail({}, { status }));
    await renderPage();
    expect(screen.queryByTestId('status-button')).toBeNull();
    // …but the status is still labelled, so a rejected club is not a blank pill.
    expect(screen.getByText(status === 'pending' ? 'statusPending' : 'statusRejected')).toBeInTheDocument();
  });

  it('shows the reviewer and the review note when the club was decided', async () => {
    getClubAdminDetail.mockResolvedValue(detail({ reviewedByName: 'Ece' }, { reviewNote: 'Duplicate' }));
    await renderPage();
    expect(screen.getByText('detailReviewedBy:{"name":"Ece"}')).toBeInTheDocument();
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
  });
});
