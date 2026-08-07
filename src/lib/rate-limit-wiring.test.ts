import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wiring coverage for every `enforceRateLimit` call site.
 *
 * `rate-limit.ts`, `rate-limit-guard.ts` and `auth-rate-limit.ts` all have deep unit
 * coverage of the limiter ITSELF. What none of it covers is whether each action and route
 * handler actually CALLS it and actually refuses when told to — the branch review found
 * that deleting the `enforceRateLimit` block from seven of the nine call sites left the
 * whole suite green. Spec §5 promised exactly this ("booking action returns `rate_limited`
 * after the 11th call in a window") and it was never written.
 *
 * Shape of every test here: drive the real call site `limit` times asserting it is NOT
 * refused, then once more asserting it IS. That is what makes them mutation-proof —
 * deleting the block flips the last assertion, and weakening the threshold flips one of
 * the earlier ones. Each was mutation-tested by hand; see the report in
 * `.superpowers/sdd/2026-08-07-oarly-rate-limiting/final-fix-report.md`.
 *
 * Everything around the limiter is mocked: the auth/tenant guards (so no DB or session),
 * `getClientIp` (so no `headers()` request scope), the core domain modules (`bookSeat`,
 * `requestToJoin`, ...), and the Next runtime helpers. The LIMITER is never mocked — these
 * tests run the real in-memory fixed-window backend, so the counts they assert are the
 * real ones.
 */

const IP = '198.51.100.5';

// --- Next runtime helpers -------------------------------------------------------------
// `revalidatePath` and `after` need a request/render store that does not exist under
// vitest; `redirect` throws a framework-internal control-flow error whose shape we would
// rather not depend on, so it is replaced by a tagged error the tests can recognise.
class RedirectError extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  after: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new RedirectError(to); }),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: cookieSet })),
  headers: vi.fn(async () => new Headers()),
}));

// --- app modules ----------------------------------------------------------------------
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/request-ip', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getClientIp: vi.fn(async () => IP),
}));
vi.mock('@/lib/membership', () => ({
  requireMember: vi.fn(async () => ({ club: { id: 'club-1' }, user: { id: currentUserId } })),
  requireMemberView: vi.fn(async () => ({ club: { id: 'club-1' }, user: { id: currentUserId } })),
}));
vi.mock('@/lib/session', () => ({
  requireUser: vi.fn(async () => ({ id: currentUserId })),
  getSession: vi.fn(async () => ({ user: { id: currentUserId } })),
  getCurrentUser: vi.fn(async () => ({ id: currentUserId })),
}));
vi.mock('@/lib/tenant', () => ({ requireClub: vi.fn(async () => ({ id: 'club-1' })) }));
vi.mock('@/lib/booking', () => ({
  bookSeat: vi.fn(async () => ({ ok: true, bookingId: 'b1', outcome: 'seated' })),
  cancelBooking: vi.fn(async () => ({ ok: true, promoted: null })),
}));
vi.mock('@/lib/notify', () => ({
  notifyBookingConfirmation: vi.fn(),
  notifyBookingCancellation: vi.fn(),
  notifyWaitlistPromotion: vi.fn(),
}));
vi.mock('@/lib/join', () => ({ requestToJoin: vi.fn(async () => 'pending') }));
vi.mock('@/lib/club-request', () => ({ requestClub: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/club-profile', () => ({
  ownedClubId: vi.fn(async () => 'club-1'),
  setClubLogo: vi.fn(),
}));
// The route passes an `onBeforeGenerateToken` callback that carries the rate check.
// @vercel/blob's real `handleUpload` invokes it with NO try/catch around it (verified in
// dist/client.js during Task 4), which is what lets the route's sentinel Error reach its
// own outer catch — this stand-in reproduces exactly that call shape.
vi.mock('@vercel/blob/client', () => ({
  handleUpload: vi.fn(async (opts: {
    onBeforeGenerateToken: (pathname: string, payload: string | null) => Promise<unknown>;
  }) => {
    await opts.onBeforeGenerateToken('logo.png', 'demo');
    return { ok: true };
  }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

// These imports deliberately sit BELOW the mock factories above. `vi.mock` is hoisted, so
// ordering is not load-bearing at runtime — it is a readability contract: everything a call
// site depends on is stubbed before the call site appears.
import { setLocale } from '@/i18n/set-locale';
import { resetRateLimitState } from '@/lib/rate-limit';
import { RATE_LIMITS } from '@/lib/rate-limit-config';

import { POST as logoSavePost } from '../../app/api/club-logo/save/route';
import { POST as logoUploadPost } from '../../app/api/club-logo/upload/route';
import { requestClubAction } from '../../app/request-club/actions';
import { bookSeatAction } from '../../app/s/[slug]/(member)/book/actions';
import { cancelBookingAction } from '../../app/s/[slug]/(member)/bookings/actions';
import { joinAction } from '../../app/s/[slug]/join/actions';

// Mutable so each describe block can use a fresh account and therefore a fresh bucket,
// without depending on `resetRateLimitState` alone (which beforeEach also does).
let currentUserId = 'user-0';
const cookieSet = vi.fn();

// Frozen clock. None of these call sites accepts a `now` parameter — they bottom out in
// `enforceRateLimit()`'s `now = Date.now()` default — so freezing the system clock is the
// only way to thread an explicit `now` through them. Without it a test that straddles a
// window boundary would silently get a fresh bucket mid-run.
const T0 = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  resetRateLimitState();
  cookieSet.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- bookSeatAction -------------------------------------------------------------------

function bookFormData(i: number): FormData {
  const fd = new FormData();
  fd.set('windowId', '00000000-0000-4000-8000-000000000001');
  fd.set('boatTypeId', '00000000-0000-4000-8000-000000000002');
  fd.set('startAt', '2026-08-08T06:00:00.000Z');
  fd.set('paymentType', 'regular');
  fd.set('idempotencyKey', `idem-key-${i}`);
  return fd;
}

describe('bookSeatAction rate limiting', () => {
  const LIMIT = RATE_LIMITS.bookingPerAccount.limit;

  it(`returns rate_limited on call ${RATE_LIMITS.bookingPerAccount.limit + 1} within one window`, async () => {
    currentUserId = 'book-user';
    for (let i = 0; i < LIMIT; i += 1) {
      const state = await bookSeatAction('demo', { status: 'idle', error: null }, bookFormData(i));
      expect(state).toEqual({ status: 'ok', error: null, outcome: 'seated' });
    }
    const limited = await bookSeatAction('demo', { status: 'idle', error: null }, bookFormData(LIMIT));
    expect(limited).toEqual({ status: 'error', error: 'rate_limited' });
  });

  it('refuses BEFORE parsing or touching the domain, so an exhausted caller costs nothing', async () => {
    // Ordering matters: the check must sit above the zod parse and above `bookSeat`, or an
    // attacker still pays us a DB round trip per refused request. An invalid payload that
    // comes back as `rate_limited` rather than `generic` proves the check ran first.
    currentUserId = 'book-order-user';
    for (let i = 0; i < LIMIT; i += 1) await bookSeatAction('demo', { status: 'idle', error: null }, bookFormData(i));
    const { bookSeat } = await import('@/lib/booking');
    vi.mocked(bookSeat).mockClear();

    const limited = await bookSeatAction('demo', { status: 'idle', error: null }, new FormData());

    expect(limited.error).toBe('rate_limited');
    expect(bookSeat).not.toHaveBeenCalled();
  });

  it('opens a fresh budget once the window has rolled', async () => {
    currentUserId = 'book-window-user';
    for (let i = 0; i < LIMIT; i += 1) await bookSeatAction('demo', { status: 'idle', error: null }, bookFormData(i));
    expect((await bookSeatAction('demo', { status: 'idle', error: null }, bookFormData(99))).error).toBe('rate_limited');

    vi.setSystemTime(T0 + RATE_LIMITS.bookingPerAccount.windowSec * 1000);
    const after = await bookSeatAction('demo', { status: 'idle', error: null }, bookFormData(100));
    expect(after.status).toBe('ok');
  });
});

// --- cancelBookingAction --------------------------------------------------------------

function cancelFormData(): FormData {
  const fd = new FormData();
  fd.set('bookingId', '00000000-0000-4000-8000-000000000009');
  return fd;
}

describe('cancelBookingAction rate limiting', () => {
  const LIMIT = RATE_LIMITS.bookingPerAccount.limit;

  it(`returns rate_limited on call ${RATE_LIMITS.bookingPerAccount.limit + 1} within one window`, async () => {
    currentUserId = 'cancel-user';
    for (let i = 0; i < LIMIT; i += 1) {
      expect(await cancelBookingAction('demo', { status: 'idle', error: null }, cancelFormData()))
        .toEqual({ status: 'ok', error: null });
    }
    expect(await cancelBookingAction('demo', { status: 'idle', error: null }, cancelFormData()))
      .toEqual({ status: 'error', error: 'rate_limited' });
  });

  it('shares ONE bucket family with booking, so alternating the two does not double the budget', async () => {
    // Deliberate spec extension (§4.4): both actions key on `book:acct:<id>`, because a
    // cancel/rebook loop is the same abuse surface and separate buckets would hand an
    // attacker 2x the rate by alternating. This is the only test that pins it.
    currentUserId = 'mixed-user';
    for (let i = 0; i < LIMIT; i += 1) {
      const state = i % 2 === 0
        ? await bookSeatAction('demo', { status: 'idle', error: null }, bookFormData(i))
        : await cancelBookingAction('demo', { status: 'idle', error: null }, cancelFormData());
      expect(state.error).not.toBe('rate_limited');
    }
    expect((await bookSeatAction('demo', { status: 'idle', error: null }, bookFormData(50))).error)
      .toBe('rate_limited');
    expect((await cancelBookingAction('demo', { status: 'idle', error: null }, cancelFormData())).error)
      .toBe('rate_limited');
  });
});

// --- requestClubAction ----------------------------------------------------------------

describe('requestClubAction rate limiting', () => {
  const LIMIT = RATE_LIMITS.clubRequestPerAccount.limit;

  it(`returns a form-level error on call ${RATE_LIMITS.clubRequestPerAccount.limit + 1}`, async () => {
    currentUserId = 'clubreq-user';
    const fd = new FormData();
    fd.set('name', 'Test Rowing Club');
    fd.set('slug', 'test-rowing-club');

    for (let i = 0; i < LIMIT; i += 1) {
      // The happy path ends in `redirect('/request-club?submitted=1')`, which our mock
      // turns into a throw — so reaching that throw IS the "not refused" assertion.
      await expect(requestClubAction({}, fd)).rejects.toBeInstanceOf(RedirectError);
    }

    const state = await requestClubAction({}, fd);
    // `getTranslations` is stubbed to echo the key, so this asserts the exact i18n key the
    // form renders, not just "some error".
    expect(state).toEqual({ errors: { form: 'errorTooManyRequests' } });
  });
});

// --- joinAction -----------------------------------------------------------------------

describe('joinAction rate limiting', () => {
  const LIMIT = RATE_LIMITS.joinRequestPerAccount.limit;

  it(`redirects with ?error=rate_limited on call ${RATE_LIMITS.joinRequestPerAccount.limit + 1}`, async () => {
    currentUserId = 'join-user';
    for (let i = 0; i < LIMIT; i += 1) {
      // Under the limit `requestToJoin` returns 'pending', so the action falls off the end
      // without redirecting at all.
      await expect(joinAction('demo')).resolves.toBeUndefined();
    }
    await expect(joinAction('demo')).rejects.toMatchObject({ to: '/join?error=rate_limited' });
  });
});

// --- setLocale ------------------------------------------------------------------------

describe('setLocale rate limiting', () => {
  const LIMIT = RATE_LIMITS.localePerIp.limit;

  it(`stops writing the cookie on call ${RATE_LIMITS.localePerIp.limit + 1}`, async () => {
    // This action has no auth guard and no error surface — the refusal IS "the cookie
    // silently does not change", so the cookie writer is the only observable.
    for (let i = 0; i < LIMIT; i += 1) await setLocale('en');
    expect(cookieSet).toHaveBeenCalledTimes(LIMIT);

    await setLocale('tr');
    expect(cookieSet).toHaveBeenCalledTimes(LIMIT); // unchanged: the refusal wrote nothing
  });
});

// --- /api/club-logo/* -----------------------------------------------------------------

function jsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/club-logo route rate limiting', () => {
  const LIMIT = RATE_LIMITS.logoUploadPerAccount.limit;

  it(`POST /save returns 429 on call ${RATE_LIMITS.logoUploadPerAccount.limit + 1}`, async () => {
    currentUserId = 'logo-save-user';
    const body = { slug: 'demo', url: 'https://blob.example/logo.png' };
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await logoSavePost(jsonReq('http://localhost/api/club-logo/save', body));
      expect(res.status).toBe(200);
    }
    const res = await logoSavePost(jsonReq('http://localhost/api/club-logo/save', body));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });

  it(`POST /upload returns 429 on call ${RATE_LIMITS.logoUploadPerAccount.limit + 1}`, async () => {
    currentUserId = 'logo-upload-user';
    const body = { type: 'blob.generate-client-token', payload: {} };
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await logoUploadPost(jsonReq('http://localhost/api/club-logo/upload', body));
      expect(res.status).toBe(200);
    }
    const res = await logoUploadPost(jsonReq('http://localhost/api/club-logo/upload', body));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });

  it('shares ONE bucket between /upload and /save, since a change always runs both', async () => {
    currentUserId = 'logo-shared-user';
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await logoUploadPost(jsonReq('http://localhost/api/club-logo/upload', {
        type: 'blob.generate-client-token', payload: {},
      }));
      expect(res.status).toBe(200);
    }
    const res = await logoSavePost(jsonReq('http://localhost/api/club-logo/save', {
      slug: 'demo', url: 'https://blob.example/logo.png',
    }));
    expect(res.status).toBe(429);
  });
});
