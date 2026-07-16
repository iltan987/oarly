import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clubs } from '@/db/schema';

export type Club = typeof clubs.$inferSelect;

/** Look up a club by slug, memoized per request. */
export const getClubBySlug = cache(async (slug: string): Promise<Club | null> => {
  const [club] = await db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1);
  return club ?? null;
});

/** The tenant slug stamped by the proxy, or null on the apex host. */
export async function getTenantSlug(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-slug');
}

/** Resolve a club or render the 404 page. */
export async function requireClub(slug: string): Promise<Club> {
  const club = await getClubBySlug(slug);
  if (!club) notFound();
  return club;
}
