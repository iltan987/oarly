import { headers } from 'next/headers';

/**
 * TRUST ASSUMPTION — read before reusing this anywhere.
 *
 * `x-forwarded-for` is a client-supplied header unless something in front of the app
 * overwrites it. Vercel's edge does exactly that on every inbound request, which is what
 * makes the per-IP limits in `rate-limit-config.ts` meaningful. Run this app behind a
 * proxy that merely appends — or with no proxy at all — and every per-IP limit becomes
 * bypassable by rotating the header, at which point the limits have to move onto a
 * signed identity instead.
 *
 * Locally no proxy sets either header, so every request resolves to `'unknown'` and
 * shares one bucket. That is fine and deliberate: the per-IP limits sit well above the
 * per-account ones precisely so a shared bucket is not the binding constraint.
 */
export function parseClientIp(h: { xForwardedFor: string | null; xRealIp: string | null }): string {
  const forwarded = h.xForwardedFor?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  const real = h.xRealIp?.trim();
  if (real) return real;
  return 'unknown';
}

/** The current request's client IP, or `'unknown'`. Adapter-layer only — reads `headers()`. */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  return parseClientIp({ xForwardedFor: h.get('x-forwarded-for'), xRealIp: h.get('x-real-ip') });
}
