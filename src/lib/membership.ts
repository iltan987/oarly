import { and, eq } from 'drizzle-orm';
import { redirect, notFound } from 'next/navigation';
import { memberships } from '@/db/schema';
import { db as appDb, type DB } from '@/db';
import { env } from '@/env';
import { parseAppOrigin, apexUrl, clubUrl } from '@/lib/urls';
import { getClubBySlug, type Club } from '@/lib/tenant';
import { getCurrentUser, type CurrentUser } from '@/lib/session';
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

/** Require the signed-in user to be an approved owner of `slug`. */
export async function requireOwner(
  slug: string,
  returnPath = '/manage/members',
): Promise<{ club: Club; user: CurrentUser; membership: Membership }> {
  const origin = parseAppOrigin(env.APP_URL);
  const club = await getClubBySlug(slug);
  if (!club) notFound();
  const user = await getCurrentUser();
  if (!user) {
    const back = `${clubUrl(slug, origin)}${returnPath}`;
    redirect(`${apexUrl('/sign-in', origin)}?redirect=${encodeURIComponent(back)}`);
  }
  const membership = await self.getMembership(appDb, user.id, club.id);
  if (!membership || membership.role !== 'owner' || membership.status !== 'approved') notFound();
  return { club, user, membership };
}
