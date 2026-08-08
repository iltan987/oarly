import { and, eq, ne } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { db as appDb, type DbOrTx } from '@/db';
import { clubs } from '@/db/schema';

export type Club = typeof clubs.$inferSelect;

/**
 * Look up a club by slug, EXCLUDING rejected rows.
 *
 * The exclusion is not cosmetic. `clubs_slug_uq` is partial — it exempts rejected
 * rows so a rejected request cannot burn a real club's name (spec §5.2) — which
 * means a rejected `bogazici` and a live `bogazici` legitimately coexist. Without
 * this filter, `limit 1` with no `order by` would return either one at the planner's
 * discretion and intermittently 404 a live club. Invariant: a rejected club is not
 * addressable by slug.
 *
 * Takes a handle so integration tests can exercise it against the test database;
 * `getClubBySlug` is the request-memoized app-wide entry point.
 */
export async function findClubBySlug(db: DbOrTx, slug: string): Promise<Club | null> {
  const [club] = await db
    .select()
    .from(clubs)
    .where(and(eq(clubs.slug, slug), ne(clubs.status, 'rejected')))
    .limit(1);
  return club ?? null;
}

/** Look up a club by slug, memoized per request. */
export const getClubBySlug = cache(async (slug: string): Promise<Club | null> => findClubBySlug(appDb, slug));

// NOTE: there is deliberately no `getTenantSlug()` header reader here. The proxy does
// stamp `x-tenant-slug`, but every authz path derives the tenant from `params.slug`
// (which Next fills from the rewritten `/s/[slug]/…` segment) so that authorization
// never depends on a header. Reintroducing a header reader invites that coupling back.

/** Resolve a club or render the 404 page. */
export async function requireClub(slug: string): Promise<Club> {
  const club = await getClubBySlug(slug);
  if (!club) notFound();
  return club;
}
