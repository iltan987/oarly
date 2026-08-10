// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

type Row = {
  id: string; name: string; slug: string;
  status: 'active' | 'pending' | 'suspended' | 'rejected';
  createdAt: Date; memberCount: number;
};

// One mutable result so each test renders exactly the list it cares about. `total`
// tracks `rows` unless a test sets it, so the pagination arithmetic is exercised with
// numbers that agree with each other.
let result: { rows: Row[]; total: number; page: number; pageSize: number };
// `vi.hoisted`, because `vi.mock`'s factory is lifted above every other statement in
// the file and would otherwise read the spy before it exists.
const { listClubsForAdmin } = vi.hoisted(() => ({ listClubsForAdmin: vi.fn() }));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/clubs-admin', () => ({ CLUBS_PAGE_SIZE: 25, listClubsForAdmin }));

// Keys are asserted on directly rather than resolved through the real catalogs — this
// test is about which controls render and what the page asks the query for, not about
// copy. The catalogs are checked separately below. Interpolated values are echoed so a
// count or a row range that never reaches the message is visible.
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key)),
}));

vi.mock('./club-status-button', () => ({
  ClubStatusButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

vi.mock('./created-toast', () => ({ CreatedToast: () => null }));

import AdminClubsPage from './page';

// Real uuids: `clubs.id` is a `uuid` column and every id this page renders came out of
// it, so a fixture like `c1` is a value the production page cannot serve.
function mkRow(status: Row['status'], over: Partial<Row> = {}): Row {
  return {
    id: randomUUID(), name: 'Boğaziçi Kürek', slug: 'bogazici', status,
    createdAt: new Date('2026-01-01T00:00:00Z'), memberCount: 0, ...over,
  };
}

async function renderPage(rows: Row[], searchParams: Record<string, string | string[] | undefined> = {}, total = rows.length) {
  result = { rows, total, page: 1, pageSize: 25 };
  listClubsForAdmin.mockResolvedValue(result);
  render(await AdminClubsPage({ searchParams: Promise.resolve(searchParams) }));
}

const renderClub = (status: Row['status']) => renderPage([mkRow(status)]);

describe('AdminClubsPage status controls', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // The un-reject hole. `setClubStatus` is id-keyed and now refuses a rejected row, but
  // this page is what decides whether an admin is ever offered the button — and a
  // rejected club may share its slug with a live one, so "Activate" here is a control
  // whose best outcome is a unique-violation.
  it('offers no status control on a rejected club', async () => {
    await renderClub('rejected');
    expect(screen.queryByRole('button', { name: 'activate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'suspend' })).toBeNull();
  });

  // The other half of the same regression: with no `rejected` entry in the label map the
  // pill renders `undefined` — a visibly empty badge next to a real club name. The tone
  // is asserted alongside the label because it is the same bug's visual half: a
  // `rejected` pill painted with the `ok` tone is a green badge reading "Rejected".
  it('labels a rejected club instead of rendering an empty pill, in a non-affirmative tone', async () => {
    await renderClub('rejected');
    const pill = screen.getByText('statusRejected');
    expect(pill).toBeInTheDocument();
    // `neutral` — see `toneClass` in booking-status-badge.
    expect(pill).toHaveClass('bg-muted', 'text-muted-foreground');
    expect(pill).not.toHaveClass('bg-ok-bg');
  });

  // A pending club is decided in the requests queue, never by this toggle: offering
  // "Activate" here would be an approve path that skips the review stamp entirely and
  // now fails with `not_decided`.
  it('offers no status control on a pending club', async () => {
    await renderClub('pending');
    expect(screen.getByText('statusPending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'activate' })).toBeNull();
  });

  it('still offers Suspend on an active club and Activate on a suspended one', async () => {
    await renderClub('active');
    expect(screen.getByRole('button', { name: 'suspend' })).toBeInTheDocument();

    screen.getByText('statusActive'); // sanity: the pill is labelled

    await renderClub('suspended');
    expect(screen.getByRole('button', { name: 'activate' })).toBeInTheDocument();
  });
});

describe('AdminClubsPage search and pagination', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // The whole point of the rewrite (spec §6.4): this page used to run
  // `db.select().from(clubs)` with no limit, so a growing platform turned the console's
  // front door into a full-table render.
  it('asks the library for one page, never for the whole table', async () => {
    await renderPage([mkRow('active')]);
    expect(listClubsForAdmin).toHaveBeenCalledWith({}, { q: undefined, page: 1, pageSize: 25 });
  });

  /**
   * The destination of Task 9's demotion, and until review it was untested at both ends:
   * `_nav.test.tsx` asserts the console offers four tabs and that creating a club is not
   * one of them, so deleting this button left `/admin/clubs/new` unreachable from the UI
   * with the whole suite green — the nav test would have gone on *confirming* the
   * disappearance.
   *
   * Asserted as a LINK, not by class or position: it renders through
   * `Button render={<Link/>}`, and what matters to an operator is that the create page is
   * one click from the list it acts on.
   */
  it('offers the create page beside the search, since it is no longer a tab', async () => {
    await renderPage([mkRow('active')]);
    expect(screen.getByRole('link', { name: 'newClub' })).toHaveAttribute('href', '/admin/clubs/new');
  });

  // It is on the page whether or not the list has anything in it — an empty platform is
  // exactly when an operator needs to create the first club.
  it('offers the create page even when no club exists yet', async () => {
    await renderPage([]);
    expect(screen.getByRole('link', { name: 'newClub' })).toBeInTheDocument();
  });

  /**
   * `getByRole('link')` above is doing real work, so this states why.
   *
   * The control shipped for one commit as `<Button nativeButton={false} render={<Link/>}>`,
   * which was a fix for a Base UI dev-console error and which stamps `role="button"` onto
   * the `<a>`. It looked identical, it navigated identically, and it announced as a button
   * — off the screen-reader links list, with the semantics of something that acts rather
   * than somewhere you go. `getByRole('link')` is what refused it.
   */
  it('announces the create page as a link, not as a button with an href', async () => {
    await renderPage([mkRow('active')]);
    const create = screen.getByRole('link', { name: 'newClub' });
    expect(create.tagName).toBe('A');
    expect(create).not.toHaveAttribute('role');
    // And it still LOOKS like a button — the whole reason it went through buttonVariants.
    expect(create.className).toContain('inline-flex');
  });

  /**
   * No Base UI dev-console error from this page. The primitive logs "expected a native
   * <button>" whenever a `Button` renders a non-button element, and five older call sites
   * elsewhere in this console still do; `/admin` had none before Task 9 and must not have
   * gained one. Spying on `console.error` is the only way to see it from a test — it is a
   * runtime warning, not a thrown error, so nothing else in the suite can fail on it.
   */
  it('logs no Base UI button warning', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await renderPage([mkRow('active')]);
      const messages = spy.mock.calls.map((c) => String(c[0]));
      expect(messages.filter((m) => m.includes('acts as a button'))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('passes the trimmed search term through and keeps it in the box', async () => {
    await renderPage([mkRow('active')], { q: '  boğaz  ' });
    expect(listClubsForAdmin).toHaveBeenCalledWith({}, { q: 'boğaz', page: 1, pageSize: 25 });
    expect(screen.getByRole('textbox', { name: 'clubsSearch' })).toHaveValue('boğaz');
  });

  it('treats a blank search as no search rather than as an empty pattern', async () => {
    await renderPage([mkRow('active')], { q: '   ' });
    expect(listClubsForAdmin).toHaveBeenCalledWith({}, { q: undefined, page: 1, pageSize: 25 });
  });

  // `?page=1.5`, `Infinity` and `1e20` each reached `OFFSET` as a `bigint` and raised
  // `invalid input syntax for type bigint` out of the render — a 500 on a URL anyone
  // can hand-edit. `Math.floor` alone does not save `1e20`.
  it.each(['1.5', 'Infinity', '1e20', '-4', 'abc'])('normalizes ?page=%s before the query', async (page) => {
    await renderPage([mkRow('active')], { page });
    const [, opts] = listClubsForAdmin.mock.calls[0] as unknown as [unknown, { page: number }];
    expect(Number.isSafeInteger(opts.page)).toBe(true);
    expect(opts.page).toBeGreaterThanOrEqual(1);
  });

  // A repeated parameter arrives as `string[]`, and `.trim()` on an array is a
  // TypeError out of the render before a single row is fetched.
  it('survives repeated query parameters', async () => {
    await renderPage([mkRow('active')], { q: ['a', 'b'], page: ['2', '3'], created: ['1', '1'] });
    expect(listClubsForAdmin).toHaveBeenCalledWith({}, { q: 'a', page: 2, pageSize: 25 });
  });

  it('renders the member count and links each club to its detail page', async () => {
    const row = mkRow('active', { memberCount: 7 });
    await renderPage([row]);
    expect(screen.getByText('clubsMemberCount:{"count":7}')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Boğaziçi Kürek' })).toHaveAttribute('href', `/admin/clubs/${row.id}`);
  });

  it('describes the row range using the page the library actually returned', async () => {
    listClubsForAdmin.mockResolvedValue({ rows: [mkRow('active')], total: 60, page: 3, pageSize: 25 });
    render(await AdminClubsPage({ searchParams: Promise.resolve({ page: '3' }) }));
    // 51–60 of 60, not 51–75: the range must not promise rows past the end.
    expect(screen.getByText('paginationRange:{"from":51,"to":60,"total":60}')).toBeInTheDocument();
  });

  it('carries the search term into the pagination links', async () => {
    listClubsForAdmin.mockResolvedValue({ rows: [mkRow('active')], total: 60, page: 1, pageSize: 25 });
    render(await AdminClubsPage({ searchParams: Promise.resolve({ q: 'boğaz' }) }));
    expect(screen.getByRole('link', { name: 'paginationNext' })).toHaveAttribute('href', '/admin?q=bo%C4%9Faz&page=2');
  });

  // "No clubs yet." under a search that matched nothing is a flat false statement
  // about a platform with hundreds of clubs. Two facts, two sentences — as
  // /admin/users already does one nav tab away.
  it('says nothing MATCHED when a search returned nothing', async () => {
    await renderPage([], { q: 'nothing' });
    expect(screen.getByText('clubsNoMatch')).toBeInTheDocument();
    expect(screen.queryByText('noClubs')).toBeNull();
    expect(screen.queryByRole('link', { name: 'paginationNext' })).toBeNull();
  });

  it('says there are no clubs YET only when there is no search', async () => {
    await renderPage([], {});
    expect(screen.getByText('noClubs')).toBeInTheDocument();
    expect(screen.queryByText('clubsNoMatch')).toBeNull();
  });

  // A whitespace-only `?q=` is normalised away by the route, so it is the no-search
  // case and must not claim a search matched nothing.
  it('treats a blank search as no search', async () => {
    await renderPage([], { q: '   ' });
    expect(screen.getByText('noClubs')).toBeInTheDocument();
  });
});

describe('admin message catalogs', () => {
  // NOT superseded by src/i18n/messages-parity.test.ts, and not redundant with it.
  //
  // That test compares the two catalogs against EACH OTHER, so a key deleted from
  // BOTH is invisible to it by construction — parity still holds, and every render
  // of that key silently degrades. Naming keys explicitly is the only thing that
  // catches it, which is why this survives the structural check rather than being
  // replaced by it.
  //
  // Turkish is the app default, so an English-only key ships as a missing-message
  // warning to every real user.
  it.each([['en', en], ['tr', tr]] as const)('%s carries the new admin keys', (_locale, messages) => {
    expect(messages.admin.statusRejected).toBeTruthy();
    expect(messages.admin.errorNotDecided).toBeTruthy();
    expect(messages.admin.clubsSearch).toBeTruthy();
    expect(messages.admin.clubsSearchCta).toBeTruthy();
    expect(messages.admin.clubsMemberCount).toBeTruthy();
  });
});
