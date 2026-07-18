import { env } from '@/env';
import type { RateRule } from '@/lib/rate-limit-config';

type Result = { success: boolean; remaining: number };

// --- in-memory fixed-window fallback (dev/test) ---
const buckets = new Map<string, { count: number; resetAt: number }>();

function inMemory(key: string, rule: RateRule, now: number): Result {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowSec * 1000 });
    return { success: true, remaining: rule.limit - 1 };
  }
  if (b.count >= rule.limit) return { success: false, remaining: 0 };
  b.count += 1;
  return { success: true, remaining: rule.limit - b.count };
}

// --- Upstash-backed limiter (prod) ---
let upstash: ((key: string, rule: RateRule) => Promise<Result>) | null = null;

async function getUpstash() {
  if (upstash) return upstash;
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({
    url: env.KV_REST_API_URL!,
    token: env.KV_REST_API_TOKEN!,
  });
  upstash = async (key, rule) => {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, rule.windowSec);
    return { success: count <= rule.limit, remaining: Math.max(0, rule.limit - count) };
  };
  return upstash;
}

export async function rateLimit(key: string, rule: RateRule, now = Date.now()): Promise<Result> {
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
    const fn = await getUpstash();
    return fn(key, rule);
  }
  return inMemory(key, rule, now);
}
