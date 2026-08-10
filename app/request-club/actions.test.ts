import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUser, requestClub, enforceRateLimit, getTranslations } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requestClub: vi.fn(),
  enforceRateLimit: vi.fn(),
  getTranslations: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/session', () => ({ requireUser }));
vi.mock('@/lib/club-request', () => ({ requestClub }));
vi.mock('@/lib/rate-limit-guard', () => ({ enforceRateLimit }));
vi.mock('next-intl/server', () => ({ getTranslations }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));

import { requestClubAction } from './actions';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID = { name: 'Bebek Kürek Kulübü', slug: 'bebek' };

/**
 * The server half of the refused-submission echo. `request-club-form.test.tsx` mocks this
 * action, so nothing there can see the echo being removed from HERE — verified by breaking
 * it: every component test still passed.
 *
 * The echo matters most on this form because its inputs carry no `defaultValue`: React 19's
 * post-action reset restores a control to its value ATTRIBUTE, which is `''` when there is
 * none, so a refusal WIPED both fields rather than reverting them.
 */
describe('requestClubAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: 'owner-1' });
    enforceRateLimit.mockResolvedValue({ limited: false });
    getTranslations.mockResolvedValue((key: string) => key);
    requestClub.mockResolvedValue({ ok: true, id: 'club-1' });
  });

  it('redirects on success, carrying no state back', async () => {
    await expect(requestClubAction({}, form(VALID))).rejects.toThrow('REDIRECT:/request-club?submitted=1');
  });

  /**
   * `slug_taken` is the ordinary outcome of picking a club name someone already has, and the
   * error names only the SLUG — so without the echo the club name the visitor typed was gone
   * with nothing said about it.
   */
  it.each(['slug_taken', 'slug_reserved', 'slug_invalid'])(
    'hands both submitted values back when the request is refused with %s', async (error) => {
      requestClub.mockResolvedValue({ ok: false, error });

      const state = await requestClubAction({}, form(VALID));

      expect(state.values).toEqual(VALID);
      expect(state.errors).toHaveProperty('slug');
    },
  );

  // The rate-limited refusal returns above the parse, so the values have to be read before
  // the limiter runs — and it names no field at all, which is where an emptied form is least
  // explicable.
  it('hands the values back on a rate-limited refusal, which names no field', async () => {
    enforceRateLimit.mockResolvedValue({ limited: true, retryAfterSec: 60 });

    const state = await requestClubAction({}, form(VALID));

    expect(state.values).toEqual(VALID);
    expect(state.errors).toEqual({ form: 'errorTooManyRequests' });
    expect(requestClub).not.toHaveBeenCalled();
  });

  // …and the zod refusal, which leaves at a third point in the action.
  it('hands the values back when the payload does not parse', async () => {
    const submitted = { name: 'x', slug: 'x' };

    const state = await requestClubAction({}, form(submitted));

    expect(state.values).toEqual(submitted);
    expect(requestClub).not.toHaveBeenCalled();
  });

  /**
   * Untrimmed and un-lowercased: the visitor gets back the characters they have in front of
   * them, not the normalised form the schema parses. Asserting the VALUE and not just its
   * presence — an echo of `parsed.data` would satisfy a presence check and would silently
   * rewrite what they typed.
   */
  it('echoes what was typed, not the normalised form the schema parsed', async () => {
    requestClub.mockResolvedValue({ ok: false, error: 'slug_taken' });
    const submitted = { name: '  Bebek  ', slug: 'BEBEK' };

    const state = await requestClubAction({}, form(submitted));

    expect(state.values).toEqual(submitted);
  });
});
