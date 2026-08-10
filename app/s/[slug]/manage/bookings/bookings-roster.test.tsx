// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The translation keys are asserted on directly (with interpolated values appended)
// rather than resolved through real message files — this test is about wiring, not copy.
// `useFormatter` is stubbed to report WHICH shape it was asked for rather than a date, so
// a revert to `new Intl.DateTimeFormat('en-GB', …)` — the hardcoded locale this file
// carried on a Turkish-default page — renders "12 August" where a marker is expected and
// the two tests below fail.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    (values ? `${key}:${JSON.stringify(values)}` : key),
  // The marker echoes `timeZone` as well as the shape asked for. Without that half, a
  // `timeZone` dropped from the options renders the CLUB's wall clock in the server's
  // zone — a ban ending 00:30 in Istanbul reported as the previous day — and no
  // assertion in this file would have moved.
  useFormatter: () => ({
    dateTime: (_d: Date, opts: Intl.DateTimeFormatOptions) =>
      `${opts.month ? 'INTL-DATE' : 'INTL-TIME'}@${opts.timeZone}`,
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('./actions', () => ({
  ownerAddBookingAction: vi.fn(),
  ownerRemoveBookingAction: vi.fn(),
}));

vi.mock('./attendance-actions', () => ({
  markNoShowAction: vi.fn(),
  undoNoShowAction: vi.fn(),
}));

// The optimistic-append test is about AddMemberForm's own logic, not the
// member picker's search/debounce behaviour — stub it down to a single
// button that selects a fixed member.
vi.mock('./member-combobox', () => ({
  MemberCombobox: ({ onSelect }: { onSelect: (m: { userId: string; name: string; email: string; phone: string | null }) => void }) => (
    <button type="button" onClick={() => onSelect({ userId: 'u9', name: 'Charlie', email: 'charlie@example.com', phone: null })}>
      pick-member
    </button>
  ),
}));

import { toast } from 'sonner';

import { ownerAddBookingAction, ownerRemoveBookingAction } from './actions';
import { markNoShowAction, undoNoShowAction } from './attendance-actions';
import { BookingsRoster, type RosterSessionWithPenalty } from './bookings-roster';

// React entangles in-flight async actions on a module-global lane, so a promise
// left unresolved when a test ends blocks state updates in every LATER test in
// this file — and it survives React Testing Library's per-test unmount. Tests
// below that defer an action's resolution push the resolver here instead of
// relying solely on their own trailing `resolve?.(...)` call: if an assertion
// throws before that call runs, the promise would otherwise hang forever and
// cascade failures into unrelated later tests. This afterEach is the safety
// net — resolving an already-resolved promise is a no-op, so it's harmless
// when a test's own resolve call already ran.
const pendingResolvers: Array<() => void> = [];

afterEach(() => {
  pendingResolvers.splice(0).forEach((r) => r());
});

function makeSession(overrides: Partial<RosterSessionWithPenalty> = {}): RosterSessionWithPenalty {
  return {
    sessionId: 's1',
    windowId: 'w1',
    startAt: new Date('2020-01-01T00:00:00Z'),
    endAt: new Date('2020-01-01T01:00:00Z'),
    boatTypeId: 'bt1',
    boatName: 'Test boat',
    capacity: 4,
    status: 'open',
    seated: [
      { bookingId: 'b1', name: 'Alice', paymentType: 'regular', queuePosition: null, status: 'booked' },
      { bookingId: 'b2', name: 'Bob', paymentType: 'regular', queuePosition: null, status: 'booked' },
    ],
    waitlisted: [],
    freeSeats: 0,
    waitlistCapacity: null,
    banEndsAt: null,
    banPermanent: false,
    banLapsed: false,
    ...overrides,
  };
}

function submitRemoveDialog() {
  const cta = screen.getByRole('button', { name: /confirmRemoveCta/ });
  const form = cta.closest('form');
  if (!form) throw new Error('confirm form not found');
  fireEvent.submit(form);
}

describe('BookingsRoster remove flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clicking Remove opens a confirmation naming the member and does not dispatch the action', () => {
    render(<BookingsRoster slug="club" sessions={[makeSession()]} timezone="UTC" multisportEnabled />);

    const removeButtons = screen.getAllByRole('button', { name: 'remove' });
    fireEvent.click(removeButtons[0]);

    expect(screen.getByText(/confirmRemoveTitle/)).toHaveTextContent('Alice');
    expect(ownerRemoveBookingAction).not.toHaveBeenCalled();
  });

  it('confirming dispatches the remove action with the correct bookingId', async () => {
    vi.mocked(ownerRemoveBookingAction).mockResolvedValue({ ok: true });
    render(<BookingsRoster slug="club" sessions={[makeSession()]} timezone="UTC" multisportEnabled />);

    fireEvent.click(screen.getAllByRole('button', { name: 'remove' })[0]);
    submitRemoveDialog();

    await waitFor(() => expect(ownerRemoveBookingAction).toHaveBeenCalledTimes(1));
    const call = vi.mocked(ownerRemoveBookingAction).mock.calls[0];
    expect(call[0]).toBe('club');
    expect((call[2] as FormData).get('bookingId')).toBe('b1');
  });

  // The §1.2 guarantee: a removal in flight must NOT take the row out of the list.
  // Removing the node optimistically would reflow every row below it at t≈0 — moving
  // a different member's Remove control under a cursor that is still resting there,
  // which is the mechanism that destroyed real data. Both rows must still be mounted
  // while the action is unresolved; the row only disappears when server data arrives.
  it('keeps the removed row mounted (fade in place, not optimistic removal) while the removal is in flight', async () => {
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(ownerRemoveBookingAction).mockImplementation(
      () => new Promise((r) => { resolve = r; pendingResolvers.push(() => r({ ok: true })); }),
    );

    render(<BookingsRoster slug="club" sessions={[makeSession()]} timezone="UTC" multisportEnabled />);

    fireEvent.click(screen.getAllByRole('button', { name: 'remove' })[0]);
    submitRemoveDialog();

    // The dialog's own submit closed and unmounted, but the action is still in flight.
    await waitFor(() => expect(ownerRemoveBookingAction).toHaveBeenCalledTimes(1));

    expect(screen.getAllByRole('button', { name: 'remove' })).toHaveLength(2);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    // …and the row being removed is dimmed in place, so the operator has feedback
    // for the whole round trip without anything moving.
    expect(screen.getByText('Alice').closest('li')).toHaveClass('opacity-40');

    resolve?.({ ok: true });
  });

  // Base UI's Dialog portals the confirm form out of the row's DOM subtree, so this
  // CSS trick only applies to in-row (non-portalled) submits like undo-absent.
  it('carries has-data-pending:opacity-40 on the seated row so an in-flight undo dims it', async () => {
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(undoNoShowAction).mockImplementation(
      () => new Promise((r) => { resolve = r; pendingResolvers.push(() => r({ ok: true })); }),
    );

    const session = makeSession({
      seated: [{ bookingId: 'b1', name: 'Alice', paymentType: 'regular', queuePosition: null, status: 'no_show' }],
    });
    render(<BookingsRoster slug="club" sessions={[session]} timezone="UTC" multisportEnabled />);

    const row = screen.getByText('Alice').closest('li');
    expect(row).not.toBeNull();
    expect(row).toHaveClass('has-data-pending:opacity-40');

    const undoButton = screen.getByRole('button', { name: 'undoAbsent' });
    const form = undoButton.closest('form');
    if (!form) throw new Error('undo form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(undoButton).toHaveAttribute('data-pending'));

    resolve?.({ ok: true });
  });
});

describe('BookingsRoster add flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The one deliberate optimistic-append exception (spec §3): appending below
  // the confirmed roster shifts nothing above it, so the new member can show
  // up before the round trip resolves.
  function submitAddForm() {
    fireEvent.click(screen.getByRole('button', { name: 'pick-member' }));
    const form = screen.getByRole('button', { name: 'add' }).closest('form');
    if (!form) throw new Error('add form not found');
    fireEvent.submit(form);
  }

  it('shows the added member immediately, dimmed, and drops the optimistic row once the action resolves', async () => {
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(ownerAddBookingAction).mockImplementation(
      () => new Promise((r) => { resolve = r; pendingResolvers.push(() => r({ ok: true })); }),
    );

    render(<BookingsRoster slug="club" sessions={[makeSession({ freeSeats: 1 })]} timezone="UTC" multisportEnabled />);
    submitAddForm();

    // Still unresolved — this proves the row is optimistic, not server-confirmed.
    await waitFor(() => expect(screen.getByText('Charlie')).toBeInTheDocument());
    expect(ownerAddBookingAction).toHaveBeenCalledTimes(1);
    // "Dimmed" has to be asserted, not just described: it is the only thing telling
    // the operator this seat is not yet confirmed.
    expect(screen.getByText('Charlie').closest('li')).toHaveClass('opacity-50');

    // On resolution the optimistic entry is dropped; the real row arrives with the
    // revalidated server props (which this test does not simulate), so Charlie goes.
    resolve?.({ ok: true });
    await waitFor(() => expect(screen.queryByText('Charlie')).not.toBeInTheDocument());
  });

  // Plan Task 8: the pending row belongs BENEATH THE SEATED LIST, not below the
  // waitlist. Rendered below the waitlist, server confirmation would lift the new
  // member up past every waitlisted row — shifting those rows' Remove controls at
  // round-trip completion, the delayed reflow of §1.2. As a trailing seated row,
  // confirmation replaces it in place and nothing moves.
  it('renders the optimistic row as a trailing seated row, above the waitlist', async () => {
    // Resolved explicitly below, with the module-level afterEach (see top of file)
    // as a safety net in case an assertion throws first.
    let resolve: ((r: { ok: true }) => void) | undefined;
    vi.mocked(ownerAddBookingAction).mockImplementation(
      () => new Promise((r) => { resolve = r; pendingResolvers.push(() => r({ ok: true })); }),
    );

    const session = makeSession({
      freeSeats: 1,
      waitlisted: [{ bookingId: 'b3', name: 'Wanda', paymentType: 'regular', queuePosition: 1, status: 'waitlisted' }],
      waitlistCapacity: 2,
    });
    render(<BookingsRoster slug="club" sessions={[session]} timezone="UTC" multisportEnabled />);
    submitAddForm();

    await waitFor(() => expect(screen.getByText('Charlie')).toBeInTheDocument());

    const charlieRow = screen.getByText('Charlie').closest('li');
    const aliceRow = screen.getByText('Alice').closest('li');
    const wandaRow = screen.getByText(/Wanda/).closest('li');
    if (!charlieRow || !aliceRow || !wandaRow) throw new Error('expected three roster rows');
    // Same <ul> as the confirmed seated rows…
    expect(charlieRow.parentElement).toBe(aliceRow.parentElement);
    // …and ahead of the waitlist in document order.
    expect(charlieRow.compareDocumentPosition(wandaRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    resolve?.({ ok: true });
    await waitFor(() => expect(screen.queryByText('Charlie')).not.toBeInTheDocument());
  });
});

describe('BookingsRoster MultiSport toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the payment picker by default (club has MultiSport enabled)', () => {
    render(<BookingsRoster slug="club" sessions={[makeSession({ freeSeats: 1 })]} timezone="UTC" multisportEnabled />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('hides the payment picker when the club has MultiSport disabled', () => {
    render(<BookingsRoster slug="club" sessions={[makeSession({ freeSeats: 1 })]} timezone="UTC" multisportEnabled={false} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  /**
   * The `payment` state has to actually be `'multisport'` when the picker disappears,
   * or this proves nothing: rendered disabled from the start, `payment` is `'regular'`
   * already and the assertion is satisfied by the initial state — it stays green with
   * the forcing at `bookings-roster.tsx` deleted outright.
   *
   * So: render ENABLED, drive the real Base UI Select to `multisport`, and only then
   * re-render with the club flag off. `AddMemberFields` keeps its state across that
   * re-render (its `key` only changes on a confirmed add), so the stale `'multisport'`
   * is live in state while the picker is unmounted — which is exactly the case the
   * hidden input's ternary exists for. Change it to `value={payment}` and this fails.
   */
  it('forces the add to regular payment when the picker is hidden, even after MultiSport was picked', async () => {
    vi.mocked(ownerAddBookingAction).mockResolvedValue({ ok: true });
    const session = makeSession({ freeSeats: 1 });
    const { rerender } = render(<BookingsRoster slug="club" sessions={[session]} timezone="UTC" multisportEnabled />);

    // Base UI's Select opens on click but commits a choice on the pointer sequence,
    // not on `click` alone.
    fireEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: 'paymentMultisport' });
    fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
    fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
    fireEvent.click(option);
    await waitFor(() => expect(document.querySelector('input[name="paymentType"]')).toHaveValue('multisport'));

    // The club turns MultiSport off; the picker unmounts but the state does not reset.
    rerender(<BookingsRoster slug="club" sessions={[session]} timezone="UTC" multisportEnabled={false} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'pick-member' }));
    const form = screen.getByRole('button', { name: 'add' }).closest('form');
    if (!form) throw new Error('add form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(ownerAddBookingAction).toHaveBeenCalledTimes(1));
    const call = vi.mocked(ownerAddBookingAction).mock.calls[0];
    expect((call[2] as FormData).get('paymentType')).toBe('regular');
  });

  // Gap this test closes: OwnerAddActionResult's 'multisport_disabled' error was wired
  // through actions.ts but never consumed here, so a rejected add showed the same
  // generic toast as any other failure — indistinguishable from a real bug.
  it('reports a MultiSport-disabled rejection with its own message, not the generic error', async () => {
    vi.mocked(ownerAddBookingAction).mockResolvedValue({ ok: false, error: 'multisport_disabled' });
    render(<BookingsRoster slug="club" sessions={[makeSession({ freeSeats: 1 })]} timezone="UTC" multisportEnabled />);

    fireEvent.click(screen.getByRole('button', { name: 'pick-member' }));
    const form = screen.getByRole('button', { name: 'add' }).closest('form');
    if (!form) throw new Error('add form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('multisportDisabled'));
    expect(toast.error).not.toHaveBeenCalledWith('actionError');
  });
});

describe('BookingsRoster session grid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** The <div> the session cards are laid out in: name -> header -> CardContent -> Card -> grid. */
  function gridOf(boatName: string): HTMLElement {
    const card = screen.getByText(new RegExp(boatName)).closest('[data-slot="card"]');
    const grid = card?.parentElement;
    if (!grid) throw new Error(`no grid around ${boatName}`);
    return grid;
  }

  const two = () => [
    makeSession({ sessionId: 's1', boatName: 'Dört tek' }),
    makeSession({ sessionId: 's2', boatName: 'İki tek' }),
  ];

  /**
   * jsdom cannot lay out, so what is pinned here is the declaration; the measurement —
   * a neighbouring card's last button not moving by a pixel when the other card of the
   * same grid row takes an optimistic seat — is in the task report.
   *
   * Asserted on the shared parent of the two cards, found by walking UP from a card,
   * rather than on `container.querySelector('.items-start')`: `Card`, `CardContent` and
   * the shadcn primitives inside a row carry their own layout classes, so a class query
   * would happily match a nested element and pass with this container reverted to
   * `flex flex-col`.
   */
  it('lays the sessions out as a two-column grid at lg, in one container', () => {
    render(<BookingsRoster slug="club" sessions={two()} timezone="UTC" multisportEnabled />);
    const grid = gridOf('Dört tek');
    expect(grid).toBe(gridOf('İki tek'));
    expect(grid).toHaveClass('grid', 'grid-cols-1', 'lg:grid-cols-2');
    // The single column below `lg:` is half the pair: `grid-cols-2` alone would put two
    // cards side by side on a 360px phone.
    expect(grid).not.toHaveClass('flex-col');
  });

  /**
   * `items-start` is the one class in this file that protects the invariant `:56-60`
   * exists for, and it is invisible in every other assertion here.
   *
   * A grid item stretches to its row's height by default. Without `items-start`, the two
   * cards of a row are always the same height, so an optimistic seat added to ONE card
   * grows the row and stretches the OTHER — moving a different member's `Remove` control
   * at t≈0 and back again at round-trip completion, on a card the operator never touched.
   * That is precisely the delayed reflow that made `PendingButton` fade in place rather
   * than unmount.
   *
   * Deliberate break: delete `items-start` from the container and this assertion fails.
   */
  it('lets each session card keep its own height, so an add on one cannot move the other', () => {
    render(<BookingsRoster slug="club" sessions={two()} timezone="UTC" multisportEnabled />);
    expect(gridOf('Dört tek')).toHaveClass('items-start');
  });

  // The container is the roster's own, not the page's: with one session there is still a
  // grid, and the card is still its direct child. (A single session at `lg:` occupies one
  // of the two columns, which is what `lg:max-w-5xl` on the canvas makes readable.)
  it('renders a single session as a direct child of the same grid', () => {
    render(<BookingsRoster slug="club" sessions={[makeSession({ boatName: 'Tek kişilik' })]} timezone="UTC" multisportEnabled />);
    expect(gridOf('Tek kişilik')).toHaveClass('grid', 'items-start');
  });
});

describe('BookingsRoster mark-absent flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Mark-absent closes its dialog on submit, so the PendingButton's spinner renders
  // for zero frames. Without a row-level pending signal nothing on the page changes
  // for the whole (slow — it cascades cancellations and penalty mail) round trip.
  it('dims the row while the mark is in flight and clears the dim when it resolves', async () => {
    let resolve: ((r: { ok: true; cancelled: number }) => void) | undefined;
    vi.mocked(markNoShowAction).mockImplementation(
      () => new Promise((r) => { resolve = r; pendingResolvers.push(() => r({ ok: true, cancelled: 0 })); }),
    );

    // startAt in the past so the "mark absent" control renders at all.
    render(<BookingsRoster slug="club" sessions={[makeSession()]} timezone="UTC" multisportEnabled />);

    fireEvent.click(screen.getAllByRole('button', { name: 'markAbsent' })[0]);
    const cta = screen.getByRole('button', { name: /confirmAbsentCta/ });
    const form = cta.closest('form');
    if (!form) throw new Error('confirm form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(markNoShowAction).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Alice').closest('li')).toHaveClass('opacity-40');

    resolve?.({ ok: true, cancelled: 0 });
    await waitFor(() => expect(screen.getByText('Alice').closest('li')).not.toHaveClass('opacity-40'));
  });

  /**
   * `confirmAbsentBan`'s `{date}` is the sentence telling an owner how long they are
   * about to ban a member for, and it was built by a hardcoded `'en-GB'` formatter with
   * `month: 'long'` — so a Turkish owner read "12 August" inside a Turkish sentence, on
   * the one dialog in this file that costs somebody their booking access.
   */
  it('formats the ban date through the request locale and the club timezone', () => {
    const session = makeSession({ banEndsAt: new Date('2026-08-12T09:00:00Z') });
    render(<BookingsRoster slug="club" sessions={[session]} timezone="Europe/Istanbul" multisportEnabled />);

    fireEvent.click(screen.getAllByRole('button', { name: 'markAbsent' })[0]);
    expect(screen.getByText(/confirmAbsentBan/)).toHaveTextContent('INTL-DATE@Europe/Istanbul');
  });

  // The session header's clock too. It is locale-invariant across tr/en — a 24-hour clock
  // is a 24-hour clock — so this is the half that was wrong only on paper; it goes through
  // the same formatter so there is no second convention left in the file to drift. The
  // timezone is NOT invariant: these are UTC instants and the club's wall clock is the
  // whole point of the prop.
  it('formats the session clock through the request locale and the club timezone', () => {
    render(<BookingsRoster slug="club" sessions={[makeSession()]} timezone="Europe/Istanbul" multisportEnabled />);
    expect(screen.getByText(/Test boat/))
      .toHaveTextContent('INTL-TIME@Europe/Istanbul–INTL-TIME@Europe/Istanbul');
  });

  // Spec §5.2's benign-race treatment, extended to mark-absent: a repeat mark means
  // the operator's intent is already satisfied, so it must not read as a failure.
  it('reports a repeat mark as benign info rather than a generic error', async () => {
    vi.mocked(markNoShowAction).mockResolvedValue({ ok: false, error: 'already_marked' });

    render(<BookingsRoster slug="club" sessions={[makeSession()]} timezone="UTC" multisportEnabled />);

    fireEvent.click(screen.getAllByRole('button', { name: 'markAbsent' })[0]);
    const form = screen.getByRole('button', { name: /confirmAbsentCta/ }).closest('form');
    if (!form) throw new Error('confirm form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('markAlready'));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
