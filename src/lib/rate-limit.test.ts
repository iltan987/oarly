import { describe, it, expect } from 'vitest';
import { rateLimit } from '@/lib/rate-limit';

describe('rateLimit (in-memory)', () => {
  it('allows up to the limit then blocks within the window', async () => {
    const rule = { limit: 3, windowSec: 60 };
    const key = `k-${Math.random()}`;
    const t0 = 1_000_000;
    expect((await rateLimit(key, rule, t0)).success).toBe(true);
    expect((await rateLimit(key, rule, t0)).success).toBe(true);
    expect((await rateLimit(key, rule, t0)).success).toBe(true);
    const blocked = await rateLimit(key, rule, t0);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets after the window elapses', async () => {
    const rule = { limit: 1, windowSec: 60 };
    const key = `k-${Math.random()}`;
    expect((await rateLimit(key, rule, 1_000_000)).success).toBe(true);
    expect((await rateLimit(key, rule, 1_000_000)).success).toBe(false);
    expect((await rateLimit(key, rule, 1_000_000 + 61_000)).success).toBe(true);
  });
});
