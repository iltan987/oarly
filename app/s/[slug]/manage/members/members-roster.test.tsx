// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import enMessages from '../../../../../messages/en.json';
import trMessages from '../../../../../messages/tr.json';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('./actions', () => ({
  liftSuspensionAction: vi.fn(),
  assignSkillAction: vi.fn(),
}));

// The select has its own file. What matters here is that every row still gets one, and
// that the roster's own control is distinguishable from it.
vi.mock('./skill-level-select', () => ({
  SkillLevelSelect: ({ membershipId }: { membershipId: string }) => (
    <button type="button">skill-{membershipId}</button>
  ),
}));

import { toast } from 'sonner';

import { liftSuspensionAction } from './actions';
import { MembersRoster, type RosterLabels, type RosterRow } from './members-roster';

// React entangles in-flight async actions on a module-global lane, so a promise left
// unresolved when a test ends blocks state updates in every LATER test in this file — and
// it survives Testing Library's per-test unmount. Tests that defer a resolution push their
// resolver here so an assertion throwing early cannot hang the rest of the file.
const pendingResolvers: Array<() => void> = [];
afterEach(() => { pendingResolvers.splice(0).forEach((r) => r()); });

const LABELS: RosterLabels = {
  skillLevel: 'skillLevel', none: 'none',
  lift: 'liftSuspension', liftDone: 'suspensionLifted', error: 'actionError',
};

// Real uuids: `memberships.id` is a `uuid` column, so `m1` is a value production cannot
// serve — and the id is what the action is asserted on below.
function mkRow(name: string, restriction: RosterRow['restriction']): RosterRow {
  return {
    membershipId: randomUUID(),
    name,
    email: `${name.toLowerCase()}@example.com`,
    skillLevelId: null,
    restriction,
    badgeLabel: restriction === 'none' ? null : `${restriction}Badge`,
    // Shaped like the real catalog string (`Askıyı kaldır: {name}`), so the fixture
    // cannot pass a test that the production copy would fail.
    liftLabel: `${LABELS.lift}: ${name}`,
  };
}

const SUSPENDED = mkRow('Askıdaki', 'suspended');
// A SECOND suspended row, so "one hoisted dispatcher must not reach the other rows'
// controls" is a claim this fixture can actually falsify. With one, there is no other
// lift button to check.
const SUSPENDED_TWO = mkRow('İkinci Askıdaki', 'suspended');
const PAUSED = mkRow('Duraklatılan', 'paused');
const PLAIN = mkRow('Serbest', 'none');
const ROWS = [SUSPENDED, SUSPENDED_TWO, PAUSED, PLAIN];

function renderRoster(rows: RosterRow[] = ROWS) {
  return render(
    <MembersRoster slug="demo" rows={rows} skillLevels={[{ id: 'lvl', name: 'Başlangıç' }]} labels={LABELS} />,
  );
}

const rowOf = (name: string) => {
  const el = screen.getByText(name).parentElement?.parentElement;
  if (!el) throw new Error(`no row for ${name}`);
  return el;
};

describe('MembersRoster: where the lift appears', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /**
   * The control exists for the state that has no other way out. A pause ends by itself on
   * a date the badge next to it already names, so a lift there offers to undo something
   * that is undoing itself; an unrestricted member has nothing to lift at all. Asserted as
   * a count over the whole list, not per row, so adding it everywhere fails here.
   */
  it('offers the lift on a suspension and on nothing else', () => {
    renderRoster();
    // Counted over the whole list, not per row: exactly as many lift forms as there are
    // suspended members, so rendering it everywhere fails here.
    expect(screen.getAllByRole('button', { name: /^liftSuspension: / })).toHaveLength(2);
    expect(rowOf('Duraklatılan')).toHaveTextContent('pausedBadge');
    expect(rowOf('Duraklatılan').querySelector('form')).toBeNull();
    expect(rowOf('Serbest').querySelector('form')).toBeNull();
  });

  /**
   * Its accessible name names the member, AND contains the visible label.
   *
   * The second half is the one that is easy to lose: an `aria-label` REPLACES the visible
   * text, so an accessible name that merely mentions the member ("{name} adlı üyenin
   * askısını kaldırın") leaves a voice-control user saying "click Askıyı kaldır" with
   * nothing to click — WCAG 2.5.3, the rule `restriction-notice.tsx:127-133` already
   * states for the club's phone link. Checked here as wiring; the catalog strings that
   * have to satisfy it are checked at the bottom of this file.
   */
  it('names the member in the control’s accessible name without hiding the visible one', () => {
    renderRoster();
    const lift = screen.getByRole('button', { name: SUSPENDED.liftLabel });
    expect(lift).toHaveTextContent(LABELS.lift);
    expect(lift.getAttribute('aria-label')).toContain(LABELS.lift);
    expect(rowOf('Askıdaki')).toContainElement(lift);
  });

  /**
   * Restorative, so it does not confirm — `app/admin/club-status-button.tsx:13-30` is the
   * rule, and `pending-members.tsx` is the destructive half of it one section above. What
   * has to be asserted is that ONE submit reaches the server: a test that only checks
   * "the action was called" passes with a confirmation added in front of it.
   */
  it('lifts in one submit, with no question in between', async () => {
    vi.mocked(liftSuspensionAction).mockResolvedValue({ ok: true });
    renderRoster();

    fireEvent.submit(screen.getByRole('button', { name: SUSPENDED.liftLabel }).closest('form')!);

    await waitFor(() => expect(liftSuspensionAction).toHaveBeenCalledTimes(1));
    expect((vi.mocked(liftSuspensionAction).mock.calls[0][2] as FormData).get('membershipId'))
      .toBe(SUSPENDED.membershipId);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  /**
   * Not `destructive`, which is the variant on Reject. The two controls are one careless
   * tap apart in muscle memory and only one of them ends a membership; giving the
   * restorative one the red treatment teaches the wrong thing about red buttons here and
   * everywhere else in the product.
   */
  it('does not wear the destructive treatment that Reject wears', () => {
    renderRoster();
    expect(screen.getByRole('button', { name: SUSPENDED.liftLabel }).className)
      .not.toMatch(/bg-destructive/);
  });
});

describe('MembersRoster in-flight feedback', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('dims the row through the has-data-pending bridge, and only that row', async () => {
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(liftSuspensionAction).mockImplementation(
      () => new Promise((r) => { resolve = r; pendingResolvers.push(() => r({ ok: true })); }),
    );
    renderRoster();

    const row = rowOf('Askıdaki');
    expect(row).toHaveClass('has-data-pending:opacity-40', 'transition-opacity');

    // Both captured BEFORE the submit: `PendingButton` renders a spinner alongside its
    // label while pending, which changes that button's accessible name — so a second
    // lookup after the dispatch would silently return nothing and assert on `undefined`.
    const lift = screen.getByRole('button', { name: SUSPENDED.liftLabel });
    const otherLift = screen.getByRole('button', { name: SUSPENDED_TWO.liftLabel });
    fireEvent.submit(lift.closest('form')!);
    await waitFor(() => expect(lift).toHaveAttribute('data-pending'));

    // The SECOND suspended row's lift, which is the assertion that needed a second row to
    // exist at all. One row's `<form>` is one `useFormStatus` scope, so the single hoisted
    // dispatcher must not reach it — reuse one `pending` flag across the list and every
    // lift on the page greys out together, the defect `PendingButton` exists to prevent.
    expect(otherLift).not.toHaveAttribute('data-pending');
    expect(otherLift).not.toBeDisabled();
    // …and only the acting row dims. The bridge is `:has()` over the row's own subtree.
    expect(rowOf('İkinci Askıdaki').querySelector('[data-pending]')).toBeNull();

    resolve?.({ ok: true });
    await waitFor(() => expect(lift).not.toHaveAttribute('data-pending'));
  });

  /**
   * THE reason `useActionState` is hoisted to the list.
   *
   * A successful lift revalidates, and the control is rendered only while the member is
   * suspended — so by the time the result lands, the button that dispatched it is gone.
   * The re-render below happens WHILE the action is still in flight, exactly as
   * revalidation would, and the toast still has to fire. A row-local `useActionState`
   * inside the conditional would be unmounted here and its effect would never run.
   */
  it('still reports success after the control has disappeared from the row', async () => {
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(liftSuspensionAction).mockImplementation(
      () => new Promise((r) => { resolve = r; pendingResolvers.push(() => r({ ok: true })); }),
    );
    const { rerender } = renderRoster();

    fireEvent.submit(screen.getByRole('button', { name: SUSPENDED.liftLabel }).closest('form')!);
    await waitFor(() => expect(liftSuspensionAction).toHaveBeenCalledTimes(1));

    const lifted: RosterRow[] = [{ ...SUSPENDED, restriction: 'none', badgeLabel: null }, SUSPENDED_TWO, PAUSED, PLAIN];
    rerender(
      <MembersRoster slug="demo" rows={lifted} skillLevels={[{ id: 'lvl', name: 'Başlangıç' }]} labels={LABELS} />,
    );
    expect(screen.queryByRole('button', { name: SUSPENDED.liftLabel })).toBeNull();

    resolve?.({ ok: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(LABELS.liftDone));
  });

  it('reports a refused lift as an error and clears the dim', async () => {
    vi.mocked(liftSuspensionAction).mockResolvedValue({ ok: false });
    renderRoster();

    fireEvent.submit(screen.getByRole('button', { name: SUSPENDED.liftLabel }).closest('form')!);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(LABELS.error));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: SUSPENDED.liftLabel })).not.toHaveAttribute('data-pending');
  });
});

describe('MembersRoster layout, which the lift must not disturb', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /**
   * The status cell is rendered for every row, badge or no badge. With the cell gone an
   * unrestricted row is a TWO-column grid, `auto` and `12rem` collapse together, and the
   * select jumps left on every row that reads as normal — the ragged column the roster
   * rewrite removed. Counted as element children, because what has to hold is the arity
   * of the grid, not what any one cell contains.
   */
  it('keeps three cells in every row, including the one with no badge and no lift', () => {
    renderRoster();
    for (const name of ['Askıdaki', 'İkinci Askıdaki', 'Duraklatılan', 'Serbest']) {
      expect(rowOf(name).children).toHaveLength(3);
    }
    expect(rowOf('Serbest').children[1]).toBeEmptyDOMElement();
  });

  it('renders every member as a row of one divided card, with a skill control each', () => {
    renderRoster();
    const card = rowOf('Askıdaki').parentElement;
    expect(card).toBe(rowOf('Serbest').parentElement);
    expect(card).toHaveClass('divide-y', 'gap-0', 'py-0');
    for (const r of ROWS) {
      expect(screen.getByRole('button', { name: `skill-${r.membershipId}` })).toBeInTheDocument();
    }
  });
});

describe('the lift copy', () => {
  // Component tests in this repo mock next-intl and assert on KEY NAMES, so not one of
  // them can see a word of this copy. The vocabulary itself (askı vs durakla vs yasak) is
  // guarded in `src/i18n/tr-restriction-vocabulary.test.ts`; what is checked here is that
  // the keys exist in both catalogs and carry the placeholder the page interpolates.
  const KEYS = ['liftSuspension', 'liftSuspensionFor', 'suspensionLifted'] as const;

  it.each([['tr', trMessages], ['en', enMessages]] as const)('%s defines every lift key', (_locale, messages) => {
    const manage = messages.manage as unknown as Record<string, string>;
    expect(KEYS.filter((k) => typeof manage[k] !== 'string')).toEqual([]);
  });

  it.each([['tr', trMessages], ['en', enMessages]] as const)('%s names the member in the accessible label', (_locale, messages) => {
    const manage = messages.manage as unknown as Record<string, string>;
    // Dropped from BOTH catalogs, the parity test cannot see it — and the label silently
    // becomes the same string on all 25 rows.
    expect(manage.liftSuspensionFor).toContain('{name}');
    expect(manage.liftSuspension).not.toContain('{name}');
  });

  /**
   * WCAG 2.5.3, Label in Name — the rule `src/components/restriction-notice.tsx:127-133`
   * states for the club's phone link, and this was the only control in the codebase
   * breaking it. An `aria-label` REPLACES the visible text, so an accessible name that
   * merely mentions the member ("{name} adlı üyenin askısını kaldırın") leaves a
   * voice-control user saying "click Askıyı kaldır" with nothing to click.
   *
   * Asserted against the CATALOGS, not against a fixture: this is a property of the
   * copy, and a translator rewriting `liftSuspensionFor` is exactly who would break it.
   */
  it.each([['tr', trMessages], ['en', enMessages]] as const)('%s keeps the visible label inside the accessible one', (_locale, messages) => {
    const manage = messages.manage as unknown as Record<string, string>;
    expect(manage.liftSuspensionFor).toContain(manage.liftSuspension);
  });
});
