import { and, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { type DB, db as appDb } from '@/db';
import { memberships } from '@/db/schema';
import { env } from '@/env';
import { restrictionState } from '@/lib/restriction';
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
  // Through `restrictionState`, not a hand-rolled `bannedUntil > now`: the strictness of
  // that comparison (`>`, never `>=`) is a decision the model owns and `checkEligibility`
  // shares, and a second copy of it here is a second thing to keep in step.
  if (!membership || membership.status !== 'approved') notFound();
  if (restrictionState(membership, new Date()) !== 'none') notFound();
  return { club, user, membership };
}

/**
 * Like `requireMember`, but admits a member whose membership is banned — timed
 * or permanent — and returns it so the page can render the reason.
 *
 * The split exists because a ban gates ACQUISITION, not viewing or release. A
 * banned member must still be able to see why, and to give up a seat that
 * survived the penalty cascade because it falls after the ban ends. Mutating
 * actions that acquire something keep the strict `requireMember`.
 */
export async function requireMemberView(
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
  if (!membership) notFound();
  // `restrictionState(...) === 'suspended'` IS `status === 'banned'` — that mapping is
  // the model's, and naming it here says what the second half of this condition is FOR
  // (admit a suspended member so the page can explain itself) rather than restating a
  // status literal the model already interprets.
  if (membership.status !== 'approved' && restrictionState(membership, new Date()) !== 'suspended') notFound();
  return { club, user, membership };
}
