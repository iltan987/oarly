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
 *
 * This deliberately does NOT parse IPv6 literals or `host:port` forms — both pass through
 * verbatim. On Vercel this is moot; the header carries bare IPs. Behind infrastructure
 * that appends a port, however, one client would FRAGMENT across many buckets — one per
 * ephemeral port — which defeats per-IP limiting for that client rather than colliding it
 * with others. That is a constraint on where this code may be deployed, not a bug to fix
 * here.
 */
export function parseClientIp(h: { xForwardedFor: string | null; xRealIp: string | null }): string {
  // Leftmost-WINS, not leftmost-only: skip past empty entries (e.g. a leading
  // `, 1.2.3.4`) to the first real one rather than giving up and falling through to
  // `'unknown'`, which would needlessly dump a client with a perfectly usable address
  // into the shared bucket.
  const forwarded = h.xForwardedFor
    ?.split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
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
