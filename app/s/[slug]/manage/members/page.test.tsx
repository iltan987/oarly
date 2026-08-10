// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../../../messages/en.json';
import tr from '../../../../../messages/tr.json';

type Row = {
  membershipId: string; userId: string; name: string; email: string;
  status: 'pending' | 'approved' | 'banned';
  skillLevelId: string | null; bannedUntil: Date | null;
};

// `vi.hoisted`, because `vi.mock`'s factory is lifted above every other statement in the
// file and would otherwise read these before they exist.
const { listPendingMembers, searchClubMembers, levels } = vi.hoisted(() => ({
  listPendingMembers: vi.fn(),
  searchClubMembers: vi.fn(),
  levels: { rows: [] as { id: string; name: string }[] },
}));

// The skill-levels read is the one query the page still issues directly. Stubbed as the
// chain the page calls rather than as a whole drizzle, so a query added here is a
// TypeError in the test rather than a silent pass.
vi.mock('@/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve(levels.rows) }) }) }) },
}));

vi.mock('@/lib/members-admin', () => ({
  MEMBERS_PAGE_SIZE: 25, PENDING_CAP: 25, listPendingMembers, searchClubMembers,
}));

vi.mock('@/lib/membership', () => ({
  requireOwner: () => Promise.resolve({
    club: { id: 'club-1', slug: 'demo', timezone: 'Europe/Istanbul' },
    user: { id: 'owner-1' },
  }),
}));

// Keys are asserted on directly rather than resolved through the real catalogs — this
// test is about which controls render and what the page asks the query for. Interpolated
// values are echoed so a count or a row range that never reaches the message is visible.
// `getFormatter` is stubbed to a marker rather than a date, so a revert to
// `toLocaleDateString('en-GB', …)` — the hardcoded locale this page carried, on a page
// whose default locale is Turkish — renders "12 August" where the marker is expected.
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key)),
  getFormatter: () => Promise.resolve({ dateTime: () => 'INTL-DATE' }),
}));

// The queue's own behaviour — the reject gate, the row dimming — is
// `pending-members.test.tsx`'s. What this file asserts about it is what the PAGE
// decides: whether the section exists at all, and which rows it is handed.
vi.mock('./pending-members', () => ({
  PendingMembers: ({ rows }: { rows: { membershipId: string; name: string }[] }) => (
    <ul aria-label="pending-queue">{rows.map((r) => <li key={r.membershipId}>{r.name}</li>)}</ul>
  ),
}));

vi.mock('./skill-level-select', () => ({
  SkillLevelSelect: ({ membershipId }: { membershipId: string }) => (
    <button type="button">skill-{membershipId}</button>
  ),
}));

import ManageMembersPage from './page';

// Real uuids: `memberships.id` is a `uuid` column, so a fixture like `m1` is a value the
// production page cannot serve.
function mkRow(over: Partial<Row> = {}): Row {
  const id = randomUUID();
  return {
    membershipId: id, userId: `u-${id}`, name: 'Ada Lovelace', email: 'ada@example.com',
    status: 'approved', skillLevelId: null, bannedUntil: null, ...over,
  };
}

async function renderPage(opts: {
  rows?: Row[]; total?: number; page?: number;
  pending?: Row[]; pendingTotal?: number;
  searchParams?: Record<string, string | string[] | undefined>;
  skillLevels?: { id: string; name: string }[];
} = {}) {
  const rows = opts.rows ?? [];
  const pendingRows = opts.pending ?? [];
  levels.rows = opts.skillLevels ?? [{ id: randomUUID(), name: 'Başlangıç' }];
  listPendingMembers.mockResolvedValue({ rows: pendingRows, total: opts.pendingTotal ?? pendingRows.length });
  searchClubMembers.mockResolvedValue({
    rows, total: opts.total ?? rows.length, page: opts.page ?? 1, pageSize: 25,
  });
  render(await ManageMembersPage({
    params: Promise.resolve({ slug: 'demo' }),
    searchParams: Promise.resolve(opts.searchParams ?? {}),
  }));
}

/** The row `<div>` a member's name sits in: name span -> identity column -> row. */
function rowOf(name: string): HTMLElement {
  const el = screen.getByText(name).parentElement?.parentElement;
  if (!el) throw new Error(`no row for ${name}`);
  return el;
}

describe('ManageMembersPage search and pagination', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // The whole point of the rewrite: this page used to select every membership in the
  // club with no limit, so a 200-member club rendered 200 cards.
  it('asks for one page of the roster, never for the whole club', async () => {
    await renderPage({ rows: [mkRow()] });
    expect(searchClubMembers).toHaveBeenCalledWith(expect.anything(), {
      clubId: 'club-1', q: undefined, page: 1, pageSize: 25,
    });
  });

  it('passes the trimmed search term through and keeps it in the box', async () => {
    await renderPage({ rows: [mkRow()], searchParams: { q: '  ada  ' } });
    expect(searchClubMembers).toHaveBeenCalledWith(expect.anything(), { clubId: 'club-1', q: 'ada', page: 1, pageSize: 25 });
    expect(screen.getByRole('textbox', { name: 'membersSearch' })).toHaveValue('ada');
  });

  it('treats a blank search as no search rather than as an empty pattern', async () => {
    await renderPage({ rows: [mkRow()], searchParams: { q: '   ' } });
    expect(searchClubMembers).toHaveBeenCalledWith(expect.anything(), { clubId: 'club-1', q: undefined, page: 1, pageSize: 25 });
  });

  // `?page=1.5`, `Infinity` and `1e20` each reach `OFFSET` as a `bigint` and raise
  // `invalid input syntax for type bigint` out of the render. `Math.floor` alone does not
  // save `1e20`.
  it.each(['1.5', 'Infinity', '1e20', '-4', 'abc'])('normalizes ?page=%s before the query', async (page) => {
    await renderPage({ rows: [mkRow()], searchParams: { page } });
    const [, opts] = searchClubMembers.mock.calls[0] as unknown as [unknown, { page: number }];
    expect(Number.isSafeInteger(opts.page)).toBe(true);
    expect(opts.page).toBeGreaterThanOrEqual(1);
  });

  // A repeated parameter arrives as `string[]`, and `.trim()` on an array is a TypeError
  // out of the render before a single row is fetched.
  it('survives repeated query parameters', async () => {
    await renderPage({ rows: [mkRow()], searchParams: { q: ['a', 'b'], page: ['2', '3'] } });
    expect(searchClubMembers).toHaveBeenCalledWith(expect.anything(), { clubId: 'club-1', q: 'a', page: 2, pageSize: 25 });
  });

  it('describes the row range using the page the library actually returned', async () => {
    await renderPage({ rows: [mkRow()], total: 60, page: 3, searchParams: { page: '3' } });
    // 51–60 of 60, not 51–75: the range must not promise rows past the end.
    expect(screen.getByText('paginationRange:{"from":51,"to":60,"total":60}')).toBeInTheDocument();
  });

  /**
   * The pagination link is the one place the internal route shape leaks. `<Link>` and
   * `usePathname()` on a tenant must use the PUBLIC `/manage/...` form: the slug is in
   * the hostname, and `/s/demo/manage/members` would be rewritten a second time by the
   * proxy on the next client navigation and 404.
   */
  it('carries the search term into a pagination link on the public tenant path', async () => {
    await renderPage({ rows: [mkRow()], total: 60, searchParams: { q: 'ada' } });
    expect(screen.getByRole('link', { name: 'paginationNext' }))
      .toHaveAttribute('href', '/manage/members?q=ada&page=2');
  });

  it('posts the search form to the public tenant path too', async () => {
    await renderPage({ rows: [mkRow()] });
    const form = screen.getByRole('button', { name: 'membersSearchCta' }).closest('form');
    expect(form).toHaveAttribute('action', '/manage/members');
    expect(form).toHaveAttribute('method', 'get');
  });

  // `useFormStatus` reports nothing for a browser navigation, so a PendingButton here
  // would render a control that never shows progress.
  it('renders no pending-aware submit in the search form', async () => {
    await renderPage({ rows: [mkRow()] });
    expect(screen.getByRole('button', { name: 'membersSearchCta' })).not.toHaveAttribute('data-pending');
  });
});

describe('ManageMembersPage pending queue', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /**
   * The rule Deliverable A encodes, asserted where it is observable: the queue is loaded
   * WITHOUT the search term, and its rows are on the page under a search that matched
   * none of the roster. Threading `q` into `listPendingMembers` — the obvious symmetry —
   * is how a join request disappears from under an owner who typed a name to find
   * somebody else.
   */
  it('shows every pending request under a search that matched nothing', async () => {
    const waiting = mkRow({ name: 'Burak Bekleyen', email: 'burak@example.com', status: 'pending' });
    await renderPage({ rows: [], pending: [waiting], searchParams: { q: 'nobody' } });

    expect(listPendingMembers).toHaveBeenCalledWith(expect.anything(), { clubId: 'club-1', cap: 25 });
    expect(listPendingMembers.mock.calls[0][1]).not.toHaveProperty('q');
    expect(screen.getByText('Burak Bekleyen')).toBeInTheDocument();
    expect(screen.getByText('noMatchTitle')).toBeInTheDocument();
  });

  /**
   * An empty work queue occupies zero pixels — not a heading over a sentence. A standing
   * "nothing is waiting" is a reminder of work that does not exist, on the page an owner
   * opens to find work that does.
   */
  it('renders no heading and no sentence at all when nothing is waiting', async () => {
    await renderPage({ rows: [mkRow()], pending: [] });
    expect(screen.queryByText('pendingHeading')).toBeNull();
    // Not just the heading: the queue itself is not mounted, so there is no empty list,
    // no stray gap and nothing for a screen reader to walk into.
    expect(screen.queryByRole('list', { name: 'pending-queue' })).toBeNull();
  });

  it('renders a count, not a pager, for requests past the cap', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => mkRow({ name: `Waiting ${i}`, status: 'pending' }));
    await renderPage({ rows: [mkRow()], pending: rows, pendingTotal: 31 });
    expect(screen.getByText('pendingMore:{"count":6}')).toBeInTheDocument();
    // And no navigation out of the queue at all: a "next page" here is where the 26th
    // request goes to be forgotten. Asserted over the whole section rather than by
    // label, so a pager under any wording fails this.
    const section = screen.getByText('pendingHeading').closest('section');
    expect(section?.querySelectorAll('a')).toHaveLength(0);
  });

  it('says nothing about extra requests when the queue fits under the cap', async () => {
    await renderPage({ rows: [mkRow()], pending: [mkRow({ name: 'Solo', status: 'pending' })] });
    expect(screen.queryByText(/^pendingMore/)).toBeNull();
    expect(screen.getByText('pendingHeading')).toBeInTheDocument();
  });
});

describe('ManageMembersPage empty states', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // Three facts, three sentences. The shared string this replaces said "No members yet"
  // to a club with 200 people in it whenever a search missed — the exact bug
  // `app/admin/page.tsx:69-73` documents being fixed once already.
  it('says nothing MATCHED when a search returned nothing', async () => {
    await renderPage({ rows: [], searchParams: { q: 'zzz' } });
    expect(screen.getByText('noMatchTitle')).toBeInTheDocument();
    expect(screen.queryByText('noMembersTitle')).toBeNull();
    expect(screen.queryByText('noApprovedTitle')).toBeNull();
  });

  it('points at the queue above when there are requests but nobody approved yet', async () => {
    await renderPage({ rows: [], pending: [mkRow({ name: 'Waiting', status: 'pending' })] });
    expect(screen.getByText('noApprovedTitle')).toBeInTheDocument();
    expect(screen.queryByText('noMembersTitle')).toBeNull();
    expect(screen.queryByText('noMatchTitle')).toBeNull();
  });

  it('offers the club page when nobody has joined at all', async () => {
    await renderPage({ rows: [], pending: [] });
    expect(screen.getByText('noMembersTitle')).toBeInTheDocument();
    // The club's public page is `/` on a tenant host — where a would-be member joins.
    expect(screen.getByRole('link', { name: 'viewPublicPage' })).toHaveAttribute('href', '/');
    expect(screen.queryByText('noApprovedTitle')).toBeNull();
  });

  // A whitespace-only `?q=` is normalised away by the route, so it is the no-search case
  // and must not claim a search matched nothing.
  it('treats a blank search as no search', async () => {
    await renderPage({ rows: [], searchParams: { q: '   ' } });
    expect(screen.getByText('noMembersTitle')).toBeInTheDocument();
    expect(screen.queryByText('noMatchTitle')).toBeNull();
  });
});

describe('ManageMembersPage roster density', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /**
   * One Card with `divide-y` rows, not one Card per member — 25 cards at `gap-2` is 25
   * shadows and 25 gutters. Asserted as "both rows share one parent, and that parent is
   * the divided container", rather than by querying for a class anywhere on the page:
   * a bare `.divide-y` selector would happily match a nested shadcn primitive and pass
   * against 25 separate cards.
   */
  it('renders every member as a row of one divided card', async () => {
    await renderPage({ rows: [mkRow({ name: 'Ada' }), mkRow({ name: 'Bahar' })] });
    const card = rowOf('Ada').parentElement;
    expect(card).toBe(rowOf('Bahar').parentElement);
    expect(card).toHaveClass('divide-y', 'gap-0', 'py-0');
  });

  /**
   * The alignment the width buys. jsdom cannot lay out, so what is pinned here is the
   * declaration; the measurement — every select sharing one `left` at 1440px — is in the
   * task report. The fixed last column is the load-bearing half: `1fr` absorbs every
   * difference in name length and badge width, so the select column cannot drift.
   */
  it('lays the row out as identity / status / select at lg, with a fixed select column', async () => {
    await renderPage({ rows: [mkRow({ name: 'Ada' })] });
    expect(rowOf('Ada')).toHaveClass('lg:grid', 'lg:grid-cols-[1fr_auto_12rem]');
  });

  it('gives every member a skill-level control', async () => {
    const rows = [mkRow({ name: 'Ada' }), mkRow({ name: 'Bahar' })];
    await renderPage({ rows });
    for (const r of rows) {
      expect(screen.getByRole('button', { name: `skill-${r.membershipId}` })).toBeInTheDocument();
    }
  });

  /**
   * With no levels defined the hint is rendered ONCE above the list. Per row it was 25
   * identical sentences down the column the eye scans for levels — which is the density
   * this task exists to fix, reintroduced by the empty case.
   */
  it('states the missing-levels hint once for the whole list, not once per row', async () => {
    await renderPage({ rows: [mkRow({ name: 'Ada' }), mkRow({ name: 'Bahar' })], skillLevels: [] });
    expect(screen.getAllByText('noSkillLevels')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^skill-/ })).toBeNull();
  });

  /**
   * The two restriction states are `restrictionState`'s call, not this page's: a second
   * copy of that predicate is how the owner's roster and the member's own page start
   * disagreeing about who is restricted. A permanent penalty sets `status = 'banned'`
   * and leaves `banned_until` null, which is why the suspended fixture below carries no
   * date — read the date first and an expulsion reports itself as unrestricted.
   */
  it('tells a suspension from a pause, and leaves an unrestricted member unbadged', async () => {
    await renderPage({
      rows: [
        mkRow({ name: 'Ada', status: 'approved' }),
        mkRow({ name: 'Askıdaki', status: 'banned', bannedUntil: null }),
        mkRow({ name: 'Duraklatılan', status: 'approved', bannedUntil: new Date('2099-08-12T09:00:00Z') }),
      ],
    });
    expect(rowOf('Askıdaki')).toHaveTextContent('suspendedBadge');
    expect(rowOf('Duraklatılan')).toHaveTextContent('pausedBadge');
    expect(rowOf('Ada')).not.toHaveTextContent('Badge');
  });

  // The date in the pause badge goes through the request's locale. Hardcoded `'en-GB'`
  // put "12 August" in the middle of a Turkish sentence on a Turkish-default page.
  it('formats the pause date through the request locale, not a hardcoded en-GB', async () => {
    await renderPage({
      rows: [mkRow({ name: 'Duraklatılan', status: 'approved', bannedUntil: new Date('2099-08-12T09:00:00Z') })],
    });
    expect(screen.getByText('pausedBadge:{"date":"INTL-DATE"}')).toBeInTheDocument();
  });
});

describe('manage message catalogs', () => {
  // NOT superseded by src/i18n/messages-parity.test.ts: that test compares the two
  // catalogs against EACH OTHER, so a key deleted from BOTH is invisible to it by
  // construction. Naming keys explicitly is the only thing that catches it.
  it.each([['en', en], ['tr', tr]] as const)('%s carries the new members keys', (_locale, messages) => {
    for (const key of [
      'membersSearch', 'membersSearchCta', 'pendingMore',
      'paginationPrev', 'paginationNext', 'paginationRange',
      'noMembersTitle', 'noMembersBody', 'noApprovedTitle', 'noApprovedBody',
      'noMatchTitle', 'noMatchBody',
    ] as const) {
      expect(messages.manage[key]).toBeTruthy();
    }
  });

  // The orphan, asserted gone. `manage.empty` served three different situations, and the
  // parity test compares the catalogs to each other — a dead key present in BOTH is
  // invisible to it forever. Re-adding it is how the collapsed empty state comes back.
  it.each([['en', en], ['tr', tr]] as const)('%s no longer carries the one-string empty state', (_locale, messages) => {
    expect((messages.manage as Record<string, unknown>).empty).toBeUndefined();
  });
});
