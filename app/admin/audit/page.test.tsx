// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditCursor, AuditRow } from '@/lib/audit';

// `@/db` reads server-only env at module load. Left unmocked under jsdom it fails
// with "Attempted to access a server-side environment variable on the client" and
// takes the whole FILE down — `0 test`, which is not a failing assertion but an
// absent one. Mocked so that an assertion, not an import, decides this file.
vi.mock('@/db', () => ({ db: {} }));

const listAuditRows = vi.fn<
  (db: unknown, opts: { filters?: unknown; cursor?: AuditCursor | null; limit?: number }) =>
  Promise<{ rows: AuditRow[]; nextCursor: AuditCursor | null }>
>();
vi.mock('@/lib/audit', () => ({ listAuditRows: (...args: Parameters<typeof listAuditRows>) => listAuditRows(...args) }));

vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
  getLocale: () => Promise.resolve('en'),
}));

// An async Server Component cannot be rendered as a child in jsdom; the page's own
// links are what this file is about.
vi.mock('./audit-filters', () => ({ AuditFilters: () => null }));

import AdminAuditPage from './page';

const NEXT: AuditCursor = { createdAt: new Date('2026-08-08T09:00:00.000Z'), id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };

function result(nextCursor: AuditCursor | null) {
  return Promise.resolve({ rows: [], nextCursor });
}

async function renderPage(sp: Record<string, string>) {
  render(await AdminAuditPage({ searchParams: Promise.resolve(sp) }));
}

beforeEach(() => {
  listAuditRows.mockReset();
  listAuditRows.mockReturnValue(result(null));
});

describe('AdminAuditPage', () => {
  it('parses the cursor out of the URL and passes the trimmed filters through', async () => {
    await renderPage({ clubId: ' c1 ', actorUserId: 'u1', action: 'boat.', cursor: '2026-08-08T09:00:00.000Z~abc' });

    expect(listAuditRows).toHaveBeenCalledWith({}, {
      filters: { clubId: 'c1', actorUserId: 'u1', actionPrefix: 'boat.' },
      cursor: { createdAt: new Date('2026-08-08T09:00:00.000Z'), id: 'abc' },
    });
  });

  // A cursor that does not round-trip is the failure that looks like success:
  // "Older" would keep returning the newest page and the tail of the log becomes
  // unreachable.
  it('encodes the next cursor into the Older link and carries the filters with it', async () => {
    listAuditRows.mockReturnValue(result(NEXT));
    await renderPage({ clubId: 'c1', action: 'boat.' });

    const older = screen.getByRole('link', { name: 'auditNext' });
    const url = new URL(older.getAttribute('href') ?? '', 'http://x');
    expect(url.pathname).toBe('/admin/audit');
    expect(url.searchParams.get('clubId')).toBe('c1');
    expect(url.searchParams.get('action')).toBe('boat.');
    expect(url.searchParams.get('cursor')).toBe(`${NEXT.createdAt.toISOString()}~${NEXT.id}`);
  });

  it('offers no Older link on the last page, and no Newest link on the first', async () => {
    await renderPage({});
    expect(screen.queryByRole('link', { name: 'auditNext' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'auditFirst' })).toBeNull();
  });

  it('drops the cursor from the Newest link so it lands on the head of the filtered log', async () => {
    await renderPage({ clubId: 'c1', cursor: '2026-08-08T09:00:00.000Z~abc' });
    const first = screen.getByRole('link', { name: 'auditFirst' });
    expect(first.getAttribute('href')).toBe('/admin/audit?clubId=c1');
  });

  // "Clear" submits the form, so the browser resends every field it still holds.
  it('ignores the resubmitted filters and the cursor when reset=1', async () => {
    await renderPage({ reset: '1', clubId: 'c1', actorUserId: 'u1', action: 'boat.', cursor: '2026-08-08T09:00:00.000Z~abc' });

    expect(listAuditRows).toHaveBeenCalledWith({}, {
      filters: { clubId: undefined, actorUserId: undefined, actionPrefix: undefined },
      cursor: null,
    });
  });

  // A malformed cursor is operator- or bot-supplied text, not a crash and not an
  // excuse to fall through to an unfiltered query.
  it('treats an unparseable cursor as the first page', async () => {
    await renderPage({ cursor: 'not-a-cursor' });
    expect(listAuditRows).toHaveBeenCalledWith({}, {
      filters: { clubId: undefined, actorUserId: undefined, actionPrefix: undefined },
      cursor: null,
    });
  });
});
