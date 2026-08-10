import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// `after` runs its callback eagerly here so a mail helper that throws would fail the
// test rather than being swallowed by a no-op stub.
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn(); } }));
// Mocked, not stubbed away: `@/lib/membership` reaches `src/auth.ts`, which reads
// server-only env at module load and would take the whole file down before a single
// test ran — a "failure" indistinguishable from a killed mutation.
vi.mock('@/lib/membership', () => ({
  requireOwner: async () => ({ club: { id: 'club-1' }, user: { id: 'owner-1' } }),
}));
vi.mock('@/lib/notify', () => ({
  notifyBookingConfirmation: vi.fn(async () => {}),
  notifyOwnerRemoval: vi.fn(async () => {}),
  notifyWaitlistPromotion: vi.fn(async () => {}),
}));

const { ownerAddBooking, ownerRemoveBooking } = vi.hoisted(() => ({
  ownerAddBooking: vi.fn(),
  ownerRemoveBooking: vi.fn(),
}));
vi.mock('@/lib/booking', () => ({ ownerAddBooking, ownerRemoveBooking }));

import { ownerAddBookingAction } from './actions';

const VALID = {
  windowId: '4d4b7b0f-1f6c-4d7e-9b1a-2f2c9b8a1234',
  boatTypeId: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
  startAt: '2026-07-27T05:00:00.000Z',
  userId: 'member-1',
  paymentType: 'regular',
};

function fd(entries: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...VALID, ...entries })) f.append(k, v);
  return f;
}

beforeEach(() => { vi.clearAllMocks(); });

/**
 * The toast branch in `bookings-roster.tsx` is only ever reached if this action names the
 * refusal. Its own test mocks this module, so it would stay green with every refusal here
 * collapsed back into a bare `{ ok: false }` — the shape that renders the generic
 * "something went wrong" for a refusal the owner could have acted on.
 *
 * Listed one by one rather than asserted as "passes `result.error` through", because the
 * point is the SET: every refusal `ownerAddBooking` can return is named. A test written
 * against the implementation would pass on a shorter list.
 */
describe('ownerAddBookingAction error pass-through', () => {
  const refusals = [
    'no_session', 'not_a_member', 'already_booked_this_slot',
    'session_full', 'multisport_day_taken', 'multisport_disabled',
  ] as const;

  it.each(refusals)('names a %s refusal', async (error) => {
    ownerAddBooking.mockResolvedValue({ ok: false, error });
    expect(await ownerAddBookingAction('club', null, fd())).toEqual({ ok: false, error });
  });

  it('passes a successful add straight through', async () => {
    ownerAddBooking.mockResolvedValue({ ok: true, bookingId: 'b-1' });
    expect(await ownerAddBookingAction('club', null, fd())).toEqual({ ok: true });
  });

  // The one case that stays generic, and the reason `error` is optional: a submission that
  // failed schema validation was never a well-formed request, so there is no state of the
  // club to report. It must also not reach the booking layer at all.
  it('refuses a malformed submission generically, without reaching the booking layer', async () => {
    expect(await ownerAddBookingAction('club', null, fd({ windowId: 'not-a-uuid' }))).toEqual({ ok: false });
    expect(ownerAddBooking).not.toHaveBeenCalled();
  });
});
