import { and, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { type DB, db as appDb } from '@/db';
import { memberships } from '@/db/schema';
import { env } from '@/env';
import { type CurrentUser, getCurrentUser } from '@/lib/session';
import { type Club, getClubBySlug } from '@/lib/tenant';
import { apexUrl, clubUrl, parseAppOrigin } from '@/lib/urls';

// Self-import so `requireOwner` calls `getMembership` through the module's own
// export object rather than the local binding directly. This keeps
// `vi.spyOn(mod, 'getMembership')` honest in unit tests: the spy mutates the
// same exports object this module reads from at call time.
import * as self from './membership';

export type { DB };
export type Membership = typeof memberships.$inferSelect;

export async function getMembership(db: DB, userId: string, clubId: string): Promise<Membership | null> {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.clubId, clubId)))
    .limit(1);
  return row ?? null;
}

/**
 * Both guards below treat a non-`active` club as a 404, mirroring the render gate in
 * `app/s/[slug]/layout.tsx`. That layout only governs PAGES — server actions and route
 * handlers bypass layouts entirely, so without this check a suspended (or not-yet-approved)
 * club's owner and members could keep driving every mutation by POSTing an action directly.
 */
function requireActiveClub(club: Club | null): asserts club is Club {
  if (!club || club.status !== 'active') notFound();
}

/** Require the signed-in user to be an approved owner of an active `slug`. */
export async function requireOwner(
  slug: string,
  returnPath = '/manage/members',
): Promise<{ club: Club; user: CurrentUser; membership: Membership }> {
  const origin = parseAppOrigin(env.APP_URL);
  const club = await getClubBySlug(slug);
  requireActiveClub(club);
  const user = await getCurrentUser();
  if (!user) {
    const back = `${clubUrl(slug, origin)}${returnPath}`;
    redirect(`${apexUrl('/sign-in', origin)}?redirect=${encodeURIComponent(back)}`);
  }
  const membership = await self.getMembership(appDb, user.id, club.id);
  if (!membership || membership.role !== 'owner' || membership.status !== 'approved') notFound();
  return { club, user, membership };
}

/** Require the signed-in user to be an approved, non-banned member of an active `slug` (any role). */
export async function requireMember(
  slug: string,
  returnPath = '/book',
): Promise<{ club: Club; user: CurrentUser; membership: Membership }> {
  const origin = parseAppOrigin(env.APP_URL);
  const club = await getClubBySlug(slug);
  requireActiveClub(club);
  const user = await getCurrentUser();
  if (!user) {
    const back = `${clubUrl(slug, origin)}${returnPath}`;
    redirect(`${apexUrl('/sign-in', origin)}?redirect=${encodeURIComponent(back)}`);
  }
  const membership = await self.getMembership(appDb, user.id, club.id);
  const bannedActive = membership?.bannedUntil != null && membership.bannedUntil.getTime() > Date.now();
  if (!membership || membership.status !== 'approved' || bannedActive) notFound();
  return { club, user, membership };
}
