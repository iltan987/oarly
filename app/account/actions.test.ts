import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUser, updateUserProfile, revalidatePath, enforceRateLimit } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  updateUserProfile: vi.fn(),
  revalidatePath: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/session', () => ({ requireUser }));
vi.mock('@/lib/user-profile', () => ({ updateUserProfile }));
vi.mock('@/lib/rate-limit-guard', () => ({ enforceRateLimit }));

import { RATE_LIMITS } from '@/lib/rate-limit-config';

import { saveAccountAction } from './actions';

const SESSION_USER = 'session-user-id';
const VICTIM = 'someone-elses-user-id';

const VALID = {
  firstName: 'İltan',
  lastName: 'Caner',
  phone: '5551112233',
  birthday: '1990-04-17',
  gender: 'male',
  defaultPaymentType: 'regular',
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('saveAccountAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: SESSION_USER });
    enforceRateLimit.mockResolvedValue({ limited: false });
  });

  it('writes the parsed profile for the signed-in user', async () => {
    expect(await saveAccountAction(null, form(VALID))).toEqual({ ok: true });
    expect(updateUserProfile).toHaveBeenCalledWith({}, SESSION_USER, {
      firstName: 'İltan', lastName: 'Caner', phone: '5551112233',
      birthday: '1990-04-17', gender: 'male', defaultPaymentType: 'regular',
    });
  });

  // ---- authorization ------------------------------------------------------------------

  /**
   * THE authorization test. A server action is reachable by a direct POST carrying any
   * body at all, so the only thing standing between a member and everyone else's profile
   * is that the row is chosen by the SESSION and never by the form.
   *
   * Every field name a careless implementation might reach for is submitted at once,
   * carrying a DIFFERENT user's id. The assertion is on the id `updateUserProfile` is
   * called with — so `updateUserProfile(db, String(formData.get('userId')), …)`, or any of
   * the other spellings, flips it. Asserting merely "it was called" would not.
   */
  it('ignores any user id in the form and writes the row the session names', async () => {
    const res = await saveAccountAction(null, form({
      ...VALID,
      userId: VICTIM, user_id: VICTIM, id: VICTIM, uid: VICTIM, email: 'victim@example.com',
    }));

    expect(res).toEqual({ ok: true });
    expect(updateUserProfile).toHaveBeenCalledTimes(1);
    expect(updateUserProfile).toHaveBeenCalledWith({}, SESSION_USER, expect.anything());

    // Stated the other way round as well, so a future refactor that starts merging form
    // values into the id cannot pass by coincidence.
    const [, writtenId] = vi.mocked(updateUserProfile).mock.calls[0];
    expect(writtenId).toBe(SESSION_USER);
    expect(writtenId).not.toBe(VICTIM);
  });

  // The id also has to come from the session on the rate-limit key, or one account could
  // spend another's budget — and, worse, dodge its own by rotating the field.
  it('keys the rate limit on the session id, not on anything in the form', async () => {
    await saveAccountAction(null, form({ ...VALID, userId: VICTIM }));
    expect(enforceRateLimit).toHaveBeenCalledWith([
      { key: `account:acct:${SESSION_USER}`, rule: RATE_LIMITS.accountUpdatePerAccount },
    ]);
  });

  it('never writes anything for a signed-out caller', async () => {
    // `requireUser` redirects, which throws. The action must not swallow that.
    requireUser.mockRejectedValue(new Error('NEXT_REDIRECT:/sign-in?redirect=%2Faccount'));
    await expect(saveAccountAction(null, form(VALID))).rejects.toThrow();
    expect(updateUserProfile).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it('requires the session before spending a rate-limit token', async () => {
    await saveAccountAction(null, form(VALID));
    expect(requireUser).toHaveBeenCalledWith('/account');
  });

  // ---- rate limiting ------------------------------------------------------------------

  it('refuses with rate_limited, before parsing and before writing', async () => {
    enforceRateLimit.mockResolvedValue({ limited: true, retryAfterSec: 60 });

    // A payload that would ALSO fail validation: getting `rate_limited` rather than
    // `invalid` back is what proves the check runs above the parse, so an exhausted
    // caller costs no validation pass and no DB round trip.
    const res = await saveAccountAction(null, form({ ...VALID, firstName: '' }));

    expect(res).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(updateUserProfile).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // ---- validation ---------------------------------------------------------------------

  it.each([
    ['an empty first name', { firstName: '' }],
    ['a whitespace-only last name', { lastName: '   ' }],
    ['an empty phone', { phone: '' }],
    ['a well-shaped non-date birthday', { birthday: '2026-02-31' }],
    ['a gender outside the offered answers', { gender: 'yes' }],
    ['a missing defaultPaymentType', { defaultPaymentType: '' }],
    ['an unknown defaultPaymentType', { defaultPaymentType: 'invoice' }],
  ])('refuses %s without writing or revalidating', async (_label, patch) => {
    const res = await saveAccountAction(null, form({ ...VALID, ...patch }));

    expect(res).toMatchObject({ ok: false, reason: 'invalid' });
    expect(updateUserProfile).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  /**
   * Every refusal hands the SUBMITTED values back, untrimmed, and increments `attempt`.
   * That is what `AccountForm` re-seeds its uncontrolled inputs from after React 19 resets
   * them, so without it a refused save silently discards whatever the member had typed.
   *
   * Both refusals, because they leave the action at different points: `rate_limited`
   * returns above the parse, so the values have to be read before the limiter runs.
   * `attempt` is asserted as a SEQUENCE (0 → 1 → 2) because the form key needs a value that
   * changes on every consecutive refusal, not merely a non-zero one.
   */
  it.each([
    ['invalid', { limited: false }, { ...VALID, firstName: '  ' }],
    ['rate_limited', { limited: true, retryAfterSec: 60 }, { ...VALID, firstName: '  ' }],
  ] as const)('hands the submitted values back on a %s refusal', async (reason, verdict, fields) => {
    enforceRateLimit.mockResolvedValue(verdict);
    const submitted = { ...fields, lastName: '  Lovelace  ' };

    const first = await saveAccountAction(null, form(submitted));
    expect(first).toEqual({
      ok: false,
      reason,
      attempt: 1,
      // Untrimmed: the member gets back the characters they have in front of them.
      values: { ...submitted },
    });

    const second = await saveAccountAction(first, form(submitted));
    expect(second).toMatchObject({ ok: false, attempt: 2 });
  });

  // A refusal AFTER a success starts the count again, so the form key moves off `:0`.
  it('starts the attempt count from a previous success', async () => {
    expect(await saveAccountAction({ ok: true }, form({ ...VALID, phone: '' })))
      .toMatchObject({ ok: false, reason: 'invalid', attempt: 1 });
  });

  it('trims each field before parsing, so a padded but valid name is accepted', async () => {
    expect(await saveAccountAction(null, form({ ...VALID, firstName: '  Ada  ', phone: ' 5551112233 ' })))
      .toEqual({ ok: true });
    expect(updateUserProfile).toHaveBeenCalledWith({}, SESSION_USER,
      expect.objectContaining({ firstName: 'Ada', phone: '5551112233' }));
  });

  // ---- the unset/answered distinction -------------------------------------------------

  /**
   * '' means "clear it", and it must reach the writer as NULL. Both columns are nullable
   * and neither was ever collected at sign-up, so NULL is the honest representation of
   * "never answered" — and for `gender` that is not the same answer as an explicit
   * `prefer_not_to_say`. Writing '' instead would make the two indistinguishable in the
   * database, which is the wrong record to keep for a special-category-adjacent field.
   */
  it('maps an empty birthday and gender to NULL, not to an empty string', async () => {
    await saveAccountAction(null, form({ ...VALID, birthday: '', gender: '' }));
    expect(updateUserProfile).toHaveBeenCalledWith({}, SESSION_USER,
      expect.objectContaining({ birthday: null, gender: null }));
  });

  it('keeps an explicit prefer_not_to_say as a real stored answer', async () => {
    await saveAccountAction(null, form({ ...VALID, gender: 'prefer_not_to_say' }));
    expect(updateUserProfile).toHaveBeenCalledWith({}, SESSION_USER,
      expect.objectContaining({ gender: 'prefer_not_to_say' }));
  });

  // A missing field is the same as an empty one for these two: the form omits `birthday`
  // entirely if the input is never touched in some browsers' autofill paths.
  it('treats an absent birthday/gender field as "not set" rather than as invalid', async () => {
    const fd = form(VALID);
    fd.delete('birthday');
    fd.delete('gender');
    expect(await saveAccountAction(null, fd)).toEqual({ ok: true });
    expect(updateUserProfile).toHaveBeenCalledWith({}, SESSION_USER,
      expect.objectContaining({ birthday: null, gender: null }));
  });

  // ---- revalidation -------------------------------------------------------------------

  /**
   * The root-layout revalidation is the half that is easy to drop and hard to notice.
   * `user.name` feeds the avatar initials and the identity line that `AppShell` renders on
   * EVERY route, so revalidating `/account` alone leaves a member looking at their old
   * initials everywhere else — the edit reads as having silently failed.
   */
  it("revalidates /account AND the root layout, because the header carries the user's name", async () => {
    await saveAccountAction(null, form(VALID));
    expect(revalidatePath.mock.calls).toEqual([['/account'], ['/', 'layout']]);
  });
});
