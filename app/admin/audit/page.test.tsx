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

async function renderPage(sp: Record<string, string | string[]>) {
  render(await AdminAuditPage({ searchParams: Promise.resolve(sp) }));
}

const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NO_FILTERS = { clubId: undefined, actorUserId: undefined, actionPrefix: undefined };

beforeEach(() => {
  listAuditRows.mockReset();
  listAuditRows.mockReturnValue(result(null));
});

describe('AdminAuditPage', () => {
  it('parses the cursor out of the URL and passes the trimmed filters through', async () => {
    await renderPage({ clubId: ' c1 ', actorUserId: 'u1', action: 'boat.', cursor: `2026-08-08T09:00:00.000Z~${UUID}` });

    expect(listAuditRows).toHaveBeenCalledWith({}, {
      filters: { clubId: 'c1', actorUserId: 'u1', actionPrefix: 'boat.' },
      cursor: { createdAt: new Date('2026-08-08T09:00:00.000Z'), id: UUID },
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
    await renderPage({ clubId: 'c1', cursor: `2026-08-08T09:00:00.000Z~${UUID}` });
    const first = screen.getByRole('link', { name: 'auditFirst' });
    expect(first.getAttribute('href')).toBe('/admin/audit?clubId=c1');
  });

  // "Clear" submits the form, so the browser resends every field it still holds.
  it('ignores the resubmitted filters and the cursor when reset=1', async () => {
    await renderPage({ reset: '1', clubId: 'c1', actorUserId: 'u1', action: 'boat.', cursor: `2026-08-08T09:00:00.000Z~${UUID}` });

    expect(listAuditRows).toHaveBeenCalledWith({}, { filters: NO_FILTERS, cursor: null });
  });

  // A malformed cursor is operator- or bot-supplied text, not a crash and not an
  // excuse to fall through to an unfiltered query.
  it.each([
    ['no separator', 'not-a-cursor'],
    ['an unparseable timestamp', `nonsense~${UUID}`],
    // The id half is interpolated into `… < ($ts, $id::uuid)`. Anything that is not
    // uuid-shaped makes Postgres raise `invalid input syntax for type uuid`, which
    // escapes the render as a 500 — a hand-edited URL should not be able to do that.
    ['an id that is not a uuid', '2026-08-08T09:00:00.000Z~abc'],
    ['an empty id', '2026-08-08T09:00:00.000Z~'],
  ])('treats a cursor with %s as the first page', async (_label, cursor) => {
    await renderPage({ cursor });
    expect(listAuditRows).toHaveBeenCalledWith({}, { filters: NO_FILTERS, cursor: null });
  });

  // Next's searchParams are `string | string[]`: any key can repeat. Every filter
  // here is read with a string method, so a repeated key used to throw a TypeError
  // out of the render before a single row was fetched.
  it('survives a repeated query parameter and reads the first occurrence', async () => {
    await renderPage({ clubId: ['c1', 'c2'], actorUserId: ['u1'], action: ['boat.', 'club.'], cursor: ['x', 'y'] });

    expect(listAuditRows).toHaveBeenCalledWith({}, {
      filters: { clubId: 'c1', actorUserId: 'u1', actionPrefix: 'boat.' },
      cursor: null,
    });
  });

  it('honours a repeated reset parameter', async () => {
    await renderPage({ reset: ['1', '0'], clubId: 'c1' });
    expect(listAuditRows).toHaveBeenCalledWith({}, { filters: NO_FILTERS, cursor: null });
  });
});
