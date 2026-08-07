import type * as UpstashRedis from '@upstash/redis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '@/env';
import { rateLimit, rateLimitReset, resetRateLimitState } from '@/lib/rate-limit';

// `Ratelimit.prototype.limit` is not a real target: `limit` (and `Redis`'s `eval` /
// `evalsha`) are instance fields assigned as arrow functions inside their constructors
// (verified by reading the installed dist/index.mjs of each package), so
// `vi.spyOn(Ratelimit.prototype, 'limit')` throws "not defined on the object".
//
// Subclassing the real `Redis` and overriding `eval`/`evalsha` as fields doesn't work
// either — verified empirically. `@upstash/redis`'s constructor wraps command methods
// for "auto pipelining" behind a `Proxy`, whose `get` trap returns the wrapped
// implementation regardless of what a subclass field assigns afterwards (confirmed with
// `Object.getOwnPropertyDescriptor`, which showed our override present as an own
// property while a normal `redis.evalsha(...)` call still ran the real one and hit the
// network).
//
// What genuinely works: replace `Redis` outright with a minimal stand-in that never runs
// the real constructor (and so never gets proxied), whose `eval`/`evalsha` are driven by
// shared, test-controlled state:
//   - `mode: 'reject'` fails the call immediately, for the plain fail-open proof.
//   - `mode: 'hang'` never settles, forcing `@upstash/ratelimit`'s own internal
//     `timeout` race (see rate-limit.ts) to be what resolves the call — this is the only
//     way to reach the RESOLVED (not thrown) `reason: 'timeout'` response the library
//     produces on a slow backend.
//   - `constructions` counts how many times `new Redis(...)` ran, which is how the
//     `resetRateLimitState` completeness test observes whether the memoized client was
//     actually torn down.
//   - `calls` records every `eval`/`evalsha` invocation's Lua KEYS argument, which is how
//     a test can see that `storageKey(key, rule)` (rate-limit.ts) actually reached the
//     Upstash call rather than the raw `key` — inspection-only otherwise, since every
//     other assertion in this file would pass just as well against the raw key.
type RecordedCall = { method: 'eval' | 'evalsha'; keys: string[] };
type MockRedisState = { mode: 'reject' | 'hang'; constructions: number; calls: RecordedCall[] };

vi.mock('@upstash/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof UpstashRedis>();
  const state: MockRedisState = { mode: 'reject', constructions: 0, calls: [] };
  class FailingRedis {
    constructor() {
      state.constructions += 1;
    }
    eval(_script: string, keys: string[]) {
      state.calls.push({ method: 'eval', keys });
      return state.mode === 'hang' ? new Promise(() => {}) : Promise.reject(new Error('kv down'));
    }
    evalsha(_hash: string, keys: string[]) {
      state.calls.push({ method: 'evalsha', keys });
      return state.mode === 'hang' ? new Promise(() => {}) : Promise.reject(new Error('kv down'));
    }
  }
  return { ...actual, Redis: FailingRedis, __mockState: state };
});

async function mockRedisState(): Promise<MockRedisState> {
  const mod = (await import('@upstash/redis')) as unknown as { __mockState: MockRedisState };
  return mod.__mockState;
}

const RULE = { name: 'testRule', limit: 3, windowSec: 60 };
const T0 = 1_000_000;

describe('rateLimit (in-memory fallback)', () => {
  beforeEach(() => { resetRateLimitState(); });

  it('allows up to the limit then rejects', async () => {
    expect((await rateLimit('k', RULE, T0)).success).toBe(true);
    expect((await rateLimit('k', RULE, T0)).success).toBe(true);
    expect((await rateLimit('k', RULE, T0)).success).toBe(true);
    expect((await rateLimit('k', RULE, T0)).success).toBe(false);
  });

  it('counts down `remaining` and reports 0 once exhausted', async () => {
    expect((await rateLimit('k', RULE, T0)).remaining).toBe(2);
    expect((await rateLimit('k', RULE, T0)).remaining).toBe(1);
    expect((await rateLimit('k', RULE, T0)).remaining).toBe(0);
    expect((await rateLimit('k', RULE, T0)).remaining).toBe(0);
  });

  it('reports resetAt as the end of the window that the first call opened', async () => {
    const first = await rateLimit('k', RULE, T0);
    expect(first.resetAt).toBe(T0 + 60_000);
    // A later call inside the same window keeps the original reset — a fixed window
    // does not slide, so a burst cannot push its own expiry outward.
    expect((await rateLimit('k', RULE, T0 + 30_000)).resetAt).toBe(T0 + 60_000);
  });

  it('opens a fresh window once the old one has elapsed', async () => {
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    expect((await rateLimit('k', RULE, T0)).success).toBe(false);
    const rolled = await rateLimit('k', RULE, T0 + 60_000);
    expect(rolled.success).toBe(true);
    expect(rolled.resetAt).toBe(T0 + 120_000);
  });

  it('keeps buckets separate per key', async () => {
    await rateLimit('a', RULE, T0);
    await rateLimit('a', RULE, T0);
    await rateLimit('a', RULE, T0);
    expect((await rateLimit('a', RULE, T0)).success).toBe(false);
    expect((await rateLimit('b', RULE, T0)).success).toBe(true);
  });

  it('keeps buckets separate per rule even when two rules share identical thresholds', async () => {
    // The real hazard this guards against: two DIFFERENT rules with the SAME `limit`
    // and `windowSec` (such pairs exist in RATE_LIMITS, e.g. `joinRequestPerAccount` and
    // `logoUploadPerAccount` are both `{ limit: 20, windowSec: 60 * 60 }`) called with the same
    // caller-supplied identifier (e.g. the same account id, or the same IP) must not
    // share one counter. Deliberately does NOT vary limit/windowSec between the two
    // rules — that would only prove the OLD (values-based) storageKey worked, not that
    // rule identity is what discriminates now.
    const sameThresholds = { name: 'otherRule', limit: RULE.limit, windowSec: RULE.windowSec };
    expect(sameThresholds.limit).toBe(RULE.limit);
    expect(sameThresholds.windowSec).toBe(RULE.windowSec);
    expect(sameThresholds.name).not.toBe(RULE.name);

    expect((await rateLimit('shared', RULE, T0)).success).toBe(true);
    expect((await rateLimit('shared', RULE, T0)).success).toBe(true);
    expect((await rateLimit('shared', RULE, T0)).success).toBe(true);
    expect((await rateLimit('shared', RULE, T0)).success).toBe(false); // RULE's bucket exhausted

    // otherRule's bucket for the SAME identifier must still be fully available.
    expect((await rateLimit('shared', sameThresholds, T0)).success).toBe(true);
    expect((await rateLimit('shared', sameThresholds, T0)).success).toBe(true);
    expect((await rateLimit('shared', sameThresholds, T0)).success).toBe(true);
    expect((await rateLimit('shared', sameThresholds, T0)).success).toBe(false);
  });

  it('rateLimitReset empties a bucket so the next call starts a new window', async () => {
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    expect((await rateLimit('k', RULE, T0)).success).toBe(false);
    await rateLimitReset('k', RULE);
    const after = await rateLimit('k', RULE, T0);
    expect(after.success).toBe(true);
    expect(after.remaining).toBe(2);
  });

  it('resetRateLimitState clears every bucket', async () => {
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    await rateLimit('k', RULE, T0);
    expect((await rateLimit('k', RULE, T0)).success).toBe(false);
    resetRateLimitState();
    expect((await rateLimit('k', RULE, T0)).success).toBe(true);
  });
});

describe('rateLimit (backend failure)', () => {
  // `vi.stubEnv` does NOT reach `@/env` here: `@t3-oss/env-nextjs` snapshots
  // `process.env` into a plain object once, at the time `src/env.ts` is first imported
  // (which happens via this test file's top-level `import { env } from '@/env'`, before
  // any test body runs). Stubbing `process.env` afterwards has no effect on that
  // snapshot, so `upstashConfigured()` would never see the stubbed values and the
  // in-memory path would run silently — verified by trying it first.
  //
  // Instead we patch the already-loaded `env` object's own properties directly. `env` is
  // a `Proxy` with only a `get` trap, so `Object.defineProperty` forwards straight to the
  // underlying target and `rate-limit.ts`'s `upstashConfigured()` picks it up on its next
  // read. This flips the module into the Upstash branch without reloading any module, and
  // the `vi.mock('@upstash/redis', ...)` above makes the actual Lua-script call reject.
  const originalKvUrl = env.KV_REST_API_URL;
  const originalKvToken = env.KV_REST_API_TOKEN;

  beforeEach(async () => {
    resetRateLimitState();
    Object.defineProperty(env, 'KV_REST_API_URL', {
      value: 'http://127.0.0.1:1/',
      configurable: true,
      writable: true,
      enumerable: true,
    });
    Object.defineProperty(env, 'KV_REST_API_TOKEN', {
      value: 'test-token',
      configurable: true,
      writable: true,
      enumerable: true,
    });
    const state = await mockRedisState();
    state.mode = 'reject';
    state.constructions = 0;
    state.calls = [];
  });

  afterEach(() => {
    Object.defineProperty(env, 'KV_REST_API_URL', {
      value: originalKvUrl,
      configurable: true,
      writable: true,
      enumerable: true,
    });
    Object.defineProperty(env, 'KV_REST_API_TOKEN', {
      value: originalKvToken,
      configurable: true,
      writable: true,
      enumerable: true,
    });
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetRateLimitState();
  });

  it('allows the request when the Upstash backend throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await rateLimit('k', RULE, T0);

    expect(result.success).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it('normalizes the library-internal timeout response instead of returning it verbatim', async () => {
    // `@upstash/ratelimit`'s own `timeout` option does not throw when the backend is
    // slow — it RESOLVES `{ success: true, limit: 0, remaining: 0, reset: 0, reason:
    // 'timeout' }`. Left unnormalized, that reaches callers as `resetAt: 0`, which
    // `enforceRateLimit` (a later task) would turn into a hugely negative Retry-After.
    // A `Redis` stand-in whose call never settles is what forces this path, rather than
    // the `catch` block: a call that HANGS past `timeout` is exactly what the library's
    // own race resolves via, as opposed to a call that throws.
    const state = await mockRedisState();
    state.mode = 'hang';
    vi.useFakeTimers();

    const pending = rateLimit('k', RULE, T0);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(result).toEqual({ success: true, remaining: RULE.limit, resetAt: T0 + RULE.windowSec * 1000 });
  });

  it('resetRateLimitState tears down the memoized Redis client, not just the buckets', async () => {
    // Mutation-tested: shrinking resetRateLimitState's body to just `buckets.clear()`
    // (dropping `limiters.clear()` and `redis = null`) leaves this failing, because
    // `limiterFor`'s `redis ??= new Redis(...)` would then skip reconstruction on the
    // second call — exactly the bug a stale memoized client (and its ephemeralCache,
    // which caches BLOCKED identifiers) would reproduce across a module-state reset.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = await mockRedisState();

    await rateLimit('k', RULE, T0);
    expect(state.constructions).toBe(1);

    resetRateLimitState();
    await rateLimit('k', RULE, T0);
    expect(state.constructions).toBe(2);
  });

  it('threads the rule-derived storage key into both the limit and resetUsedTokens calls', async () => {
    // The Upstash-side counterpart of the in-memory collision test above. The library's
    // own key derivation is `[prefix, identifier].join(':')` plus a bucket suffix for
    // `.limit()`, or plus a `*` for `.resetUsedTokens()` — either way, our identifier
    // (`storageKey(key, rule)`) must show up verbatim inside the Lua call's KEYS entry.
    // Mutation-tested below: reverting either call site to the raw `key` leaves the
    // discriminator out and this test catches it.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = await mockRedisState();

    await rateLimit('k', RULE, T0);
    const limitCall = state.calls.at(-1);
    expect(limitCall?.method).toBe('evalsha');
    expect(limitCall?.keys[0]).toContain(`:${RULE.name}:k:`);

    await rateLimitReset('k', RULE);
    const resetCall = state.calls.at(-1);
    expect(resetCall?.method).toBe('evalsha');
    expect(resetCall?.keys[0]).toContain(`:${RULE.name}:k:`);
  });
});
