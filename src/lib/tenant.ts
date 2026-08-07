import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { db } from '@/db';
import { clubs } from '@/db/schema';

export type Club = typeof clubs.$inferSelect;

/** Look up a club by slug, memoized per request. */
export const getClubBySlug = cache(async (slug: string): Promise<Club | null> => {
  const [club] = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
  return club ?? null;
});

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
