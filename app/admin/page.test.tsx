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
   * What these three cases do NOT catch, said plainly rather than papered over with a test
   * that looks like it does.
   *
   * `<Button render={<Link/>}>` — no `nativeButton` prop at all — passes every assertion
   * above, and rightly: Base UI leaves the `<a>` alone, so it is still a link and still
   * announces as one. Its only defect is a dev-console error on every render, and that is
   * genuinely unguardable here. `@base-ui/utils/error` dedupes by message in a module-level
   * `Set` and exposes `reset()` to clear it, so a `console.error` spy in this file reports
   * nothing once any earlier test in the same file has rendered the same warning — a spy
   * assertion here would pass while the warning fired, which is worse than no assertion.
   * `@base-ui/utils` is a transitive package and does not resolve from this project, so
   * `reset()` is not reachable without adding a dependency for a test.
   *
   * `buttonVariants` is therefore chosen on its merits — a control that navigates should be
   * a link, with no primitive in between — and the absence of the warning is a consequence,
   * not something this file proves.
   */

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

describe('AdminClubsPage list density', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /** `[row, identity wrapper]` for a club, walked UP from its name link. */
  function rowOf(name: string): [HTMLElement, HTMLElement] {
    const identity = screen.getByRole('link', { name }).parentElement;
    const row = identity?.parentElement;
    if (!identity || !row) throw new Error(`no row for ${name}`);
    return [row, identity];
  }

  /**
   * jsdom cannot lay out, so the declaration is what is pinned here; the measurement —
   * one distinct `left` per column down the page at 1440px — is in the task report.
   * `toHaveClass` matches exact tokens, so `9rem → 7rem` fails this.
   *
   * Asserted on the row element, reached from the club's own link, rather than by
   * querying for the class: `Card` and `StatusPill` are shadcn primitives with their own
   * layout classes, and a `.lg\:grid` selector would match a nested one just as happily.
   */
  it('un-stacks the club row into four aligned columns at lg', async () => {
    await renderPage([mkRow('active')]);
    const [row] = rowOf('Boğaziçi Kürek');
    expect(row).toHaveClass('lg:grid', 'lg:grid-cols-[1fr_9rem_7rem_auto]', 'lg:items-center');
    // Below `lg:` the row is unchanged: identity stacked left, controls right.
    expect(row).toHaveClass('flex', 'items-center', 'justify-between');
  });

  /**
   * The half the grid template cannot show. A grid lays out its OWN children, and the
   * name/slug/count are children of a wrapper — so without `lg:contents` on that wrapper
   * the four-track template is fed exactly two items: the stack in `1fr` and the
   * status/action pair in `9rem`, with `7rem` and `auto` empty. The page then renders
   * precisely as it did before this task, and the template assertion above still passes.
   *
   * Asserted on the wrapper element, and paired with the arity that makes the four tracks
   * add up: three promoted children plus the controls cell.
   */
  it('promotes name, slug and count into the row grid so all four columns are fed', async () => {
    await renderPage([mkRow('active', { memberCount: 7 })]);
    const [row, identity] = rowOf('Boğaziçi Kürek');
    expect(identity).toHaveClass('lg:contents');
    expect(identity.children).toHaveLength(3);
    expect(row.children).toHaveLength(2);
    // …and those three are the three facts, in the order the columns are sized for.
    expect(identity.children[0]).toHaveTextContent('Boğaziçi Kürek');
    expect(identity.children[1]).toHaveTextContent('bogazici');
    expect(identity.children[2]).toHaveTextContent('clubsMemberCount:{"count":7}');
  });

  /**
   * The status cell is present on a row with no toggle, so the `auto` column is fed on
   * every row. Wrapping the whole controls div in `{canToggleStatus && …}` would collapse
   * a pending or rejected row to three columns and pull its pill left, out of the column
   * every other row's pill sits in.
   */
  it('keeps the controls cell on a row that has no status toggle', async () => {
    await renderPage([mkRow('rejected')]);
    const [row] = rowOf('Boğaziçi Kürek');
    expect(row.children).toHaveLength(2);
    expect(row.children[1]).toHaveTextContent('statusRejected');
    // `shrink-0` on that cell: below `lg:` it is a flex item beside a long club name, and
    // without it the pill and the toggle are squeezed by the name rather than the name
    // wrapping.
    expect(row.children[1]).toHaveClass('shrink-0');
  });

  /**
   * The two classes that let a long club name wrap inside a `1fr` column instead of
   * forcing the row wider.
   *
   * Pinned here rather than left to a browser measurement, because the obvious measurement
   * cannot fail: `Card` carries `overflow-hidden` (`ui/card.tsx:16`), so an over-wide name
   * is CLIPPED, never scrolled, and `documentElement.scrollWidth` is unchanged with both
   * classes deleted and the name silently truncated. A grid item's automatic minimum size
   * is its CONTENT, so `min-w-0` is what lets the name column narrow at all; `break-words`
   * is what breaks a single unbroken token, which a name containing spaces never
   * exercises. The slug carries both for the same reason in a fixed `9rem` column.
   */
  it('lets a long club name and a long slug wrap rather than force the row wider', async () => {
    const long = 'Boğaziçi Üniversitesi Kürek ve Yelken İhtisas Kulübüıı';
    await renderPage([mkRow('active', { name: long, slug: 'bogazici-universitesi-kurek-yelken' })]);
    const name = screen.getByRole('link', { name: long });
    expect(name).toHaveClass('min-w-0', 'break-words');
    expect(screen.getByText('bogazici-universitesi-kurek-yelken')).toHaveClass('min-w-0', 'break-words');
  });

  /**
   * The unbounded-canvas defect in miniature, and the one the product owner named: the
   * form is `flex-1` inside the controls row, so with no cap the <Input> became a
   * 1024px-wide box for a 20-character club name.
   *
   * Deliberate break: delete `max-w-md` and this fails.
   */
  it('caps the search box rather than letting it take the whole canvas', async () => {
    await renderPage([mkRow('active')]);
    const form = screen.getByRole('textbox', { name: 'clubsSearch' }).closest('form');
    expect(form).toHaveClass('max-w-md');
    // The cap is on the form, not on the Input: capping the Input alone would leave the
    // submit button stranded at the far right of the canvas.
    expect(screen.getByRole('textbox', { name: 'clubsSearch' })).not.toHaveClass('max-w-md');
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
