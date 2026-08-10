import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// `after` runs its callback eagerly here so a mail helper that throws would fail the test
// rather than being swallowed by a no-op stub — `bookings/actions.test.ts`'s reason,
// which applies identically to this action.
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn(); } }));
// Mocked, not stubbed away: `@/lib/membership` reaches `src/auth.ts`, which reads
// server-only env at module load and would take the whole file down before a single test
// ran — a "failure" indistinguishable from a killed mutation.
vi.mock('@/lib/membership', () => ({
  requireOwner: async () => ({ club: { id: 'club-1' }, user: { id: 'owner-1' } }),
}));

const { liftPenalties, notifyPenaltyLift } = vi.hoisted(() => ({
  liftPenalties: vi.fn(),
  notifyPenaltyLift: vi.fn(async () => {}),
}));
vi.mock('@/lib/members-admin', () => ({
  liftPenalties,
  setMembershipStatus: vi.fn(),
  assignSkillLevel: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notifyPenaltyLift }));

import { liftSuspensionAction } from './actions';

const MEMBERSHIP_ID = '3f1d9a6e-2c4b-4a8f-9d0e-5b7c1a2e3f40';

function fd(membershipId: string = MEMBERSHIP_ID): FormData {
  const f = new FormData();
  f.append('membershipId', membershipId);
  return f;
}

beforeEach(() => { vi.clearAllMocks(); });

/**
 * Imposing a suspension mails the member (`markNoShowAction` -> `notifyNoShowPenalty`).
 * Reversing one was silent: a member told in writing that their booking access was closed
 * and would not reopen by itself had it reopen with no signal at all.
 *
 * These are about WHEN the mail goes, which is the half that cannot be seen from
 * `notify.integration.test.ts` — that file proves the helper sends; this one proves the
 * action calls it exactly when a restriction was actually reversed.
 */
describe('liftSuspensionAction notification', () => {
  it('mails the member when a suspension was actually lifted', async () => {
    liftPenalties.mockResolvedValue({ ok: true, lifted: 1 });
    await expect(liftSuspensionAction('club', null, fd())).resolves.toEqual({ ok: true });
    expect(notifyPenaltyLift).toHaveBeenCalledTimes(1);
    expect(notifyPenaltyLift).toHaveBeenCalledWith(expect.anything(), { membershipId: MEMBERSHIP_ID });
  });

  /**
   * The stale-page second click, and the case the brief calls out: `liftPenalties`
   * returns `ok: true` for a no-op, so an action gating on `ok` alone would mail somebody
   * that their restriction has just been lifted when nothing happened — and quite
   * possibly when they were never restricted, because the roster the owner clicked from
   * may be minutes out of date.
   */
  it('sends nothing when nothing was in force to lift', async () => {
    liftPenalties.mockResolvedValue({ ok: true, lifted: 0 });
    await expect(liftSuspensionAction('club', null, fd())).resolves.toEqual({ ok: true });
    expect(notifyPenaltyLift).not.toHaveBeenCalled();
  });

  it('sends nothing when the membership belongs to another club', async () => {
    liftPenalties.mockResolvedValue({ ok: false });
    await expect(liftSuspensionAction('club', null, fd())).resolves.toEqual({ ok: false });
    expect(notifyPenaltyLift).not.toHaveBeenCalled();
  });

  // The id never reaches `liftPenalties`, so there is nothing that could have been
  // lifted and nothing to tell anyone about.
  it('sends nothing — and lifts nothing — for a malformed membership id', async () => {
    await expect(liftSuspensionAction('club', null, fd('not-a-uuid'))).resolves.toEqual({ ok: false });
    expect(liftPenalties).not.toHaveBeenCalled();
    expect(notifyPenaltyLift).not.toHaveBeenCalled();
  });

  /**
   * The send is inside `after()`, so the owner's round trip does not carry it. Driven with
   * a promise that NEVER settles rather than with a rejecting one: a rejection would only
   * show that something swallowed it, and `notifyPenaltyLift` already swallows its own
   * errors (`notify.integration.test.ts` pins that). A hang is what distinguishes
   * `after(() => send())` from `await send()` — move the call out of `after` and this test
   * stops resolving and fails on the timeout.
   *
   * It matters because Resend is a network hop taken while the owner watches a spinner on
   * a roster row, and because the lift has already committed by this point: a slow mailer
   * must not turn a completed reinstatement into something the owner retries.
   */
  it('does not wait on the mail before reporting success', async () => {
    liftPenalties.mockResolvedValue({ ok: true, lifted: 1 });
    notifyPenaltyLift.mockImplementationOnce(() => new Promise<void>(() => {}));
    await expect(liftSuspensionAction('club', null, fd())).resolves.toEqual({ ok: true });
    expect(notifyPenaltyLift).toHaveBeenCalledTimes(1);
  });
});
