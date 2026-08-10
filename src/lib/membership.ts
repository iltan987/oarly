import { and, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { type DB, db as appDb } from '@/db';
import { memberships } from '@/db/schema';
import { env } from '@/env';
import { getRestriction, type Restriction, restrictionState } from '@/lib/restriction';
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

/**
 * Memoized per request via React's `cache()` — the same mechanism `getClubBySlug`
 * already uses, and for the same reason: a layout and the page it wraps both call this
 * (through `requireOwner`/`requireMember`/`requireMemberView`, or directly, see
 * `join.ts` and `app/s/[slug]/page.tsx`) and should agree on one row rather than each
 * issuing its own query.
 *
 * Safe to cache without touching a single call site: every caller passes the `appDb`
 * module singleton (never a transaction handle) and a plain `(userId, clubId)` pair,
 * so `cache()`'s argument-identity key lands on the same entry for every caller in one
 * request. It is also safe across a write: `requestToJoin` (`src/lib/join.ts`) reads
 * this, then inserts, from inside a Server Action — a plain async call with no active
 * React render and therefore no cache scope to leave a stale entry in (`cache()`
 * without a request dispatcher does not memoize at all; see `membership.test.ts`). The
 * page Next re-renders afterward to show the result is a fresh render with its own,
 * empty cache — it queries for real and sees the row the action just wrote.
 */
export const getMembership = cache(async (db: DB, userId: string, clubId: string): Promise<Membership | null> => {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.clubId, clubId)))
    .limit(1);
  return row ?? null;
});

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
  // Deliberately NOT routed through `restrictionState`, unlike `requireMember` above.
  // This is an ADMITTANCE test over `status`, not a ban test: it asks which membership
  // states may view the page at all. Writing it as `restrictionState(...) !== 'suspended'`
  // says the same thing in a double negative, and dresses a status check up as a
  // restriction check — the ban predicate it would appear to share is not the reason
  // either status is listed here.
  if (!membership || (membership.status !== 'approved' && membership.status !== 'banned')) notFound();
  return { club, user, membership };
}

/**
 * "Is this member restricted?", resolved from `userId`/`clubId`. Memoized per request
 * via `cache()` in its own right, but the query it would otherwise duplicate is already
 * gone: `getMembership` above is cache()-wrapped, so this and `requireMemberView`'s own
 * `self.getMembership(appDb, user.id, club.id)` call (from `book/page.tsx` /
 * `bookings/page.tsx`) resolve the SAME membership row within one request, not two.
 *
 * This exists for `MemberTabs`: the `(member)` layout renders it — including the
 * permanent `/book` tab — as chrome that has to survive `loading.tsx` (see
 * `page-skeleton.tsx`), so it cannot receive a page's already-computed `Restriction` as
 * a prop the way `BookingsList` does.
 *
 * What this does NOT close: `getRestriction` takes `now` as its own argument, and
 * three call sites each supply their own — this function's implicit `new Date()`,
 * `book/page.tsx`'s identical implicit default, and `bookings/page.tsx`'s own `now`
 * (deliberately shared there across the restriction, the upcoming/past split, and the
 * cancel-cutoff maths — see that file). A membership whose `bannedUntil` lapses in the
 * narrow window between the layout's read and the page's own `getRestriction` call
 * could see the tab and the page disagree for that one request. Unifying the three
 * would need a request-scoped clock, which is a bigger change than this task — left as
 * an open follow-up, not something this closes.
 *
 * A visitor with no membership row (not signed in, or signed in but not a member of
 * this club) is `'none'` here — not restricted, not admitted either; the page under
 * `MemberTabs` still runs its own guard and turns that visitor away on its own terms.
 */
export const getMemberRestriction = cache(
  async (userId: string, clubId: string): Promise<Restriction> => {
    const membership = await self.getMembership(appDb, userId, clubId);
    return membership ? getRestriction(appDb, membership) : { state: 'none' };
  },
);
