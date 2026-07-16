import { RESERVED_SUBDOMAINS, RESERVED_APEX_SEGMENTS } from './tenant-routing';

/** Slugs that would collide with a reserved subdomain or top-level apex route. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  ...RESERVED_SUBDOMAINS,
  ...RESERVED_APEX_SEGMENTS,
]);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSlug(
  slug: string,
): { ok: true } | { ok: false; reason: 'length' | 'format' | 'reserved' } {
  if (slug.length < 3 || slug.length > 40) return { ok: false, reason: 'length' };
  if (!SLUG_RE.test(slug)) return { ok: false, reason: 'format' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'reserved' };
  return { ok: true };
}
