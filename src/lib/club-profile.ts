import { and, asc, eq } from 'drizzle-orm';

import type { DB } from '@/db';
import { clubs, clubSocials, memberships } from '@/db/schema';
import { logAudit } from '@/lib/audit';

export interface ProfileInput {
  name: string;
  tagline: string | null;
  description: string | null;
  phone: string | null;
  brandAccent: string | null;
  headingFont: 'default' | 'premium';
  logoUrl: string | null;
}

/** Wrapped in a transaction so the audit row commits with the profile change (spec §4.3). */
export async function updateClubProfile(db: DB, clubId: string, input: ProfileInput, actorId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const res = await tx.update(clubs).set({
      name: input.name, tagline: input.tagline, description: input.description,
      phone: input.phone, brandAccent: input.brandAccent, headingFont: input.headingFont,
      logoUrl: input.logoUrl,
    }).where(eq(clubs.id, clubId)).returning({ id: clubs.id });
    if (res.length === 0) return false;
    await logAudit(tx, { actorUserId: actorId, clubId, action: 'club.profile_update', target: clubId, actingAsRole: 'owner' });
    return true;
  });
}

/** Persists just the logo, independent of the profile form, so an upload sticks
 *  immediately (no separate Save click). `null` clears it.
 *
 *  Deliberately unaudited, as are `addSocial` and `removeSocial` below: cosmetic
 *  self-description carrying no authority over any person, and frequent enough
 *  that logging it would drown the entries that matter (spec §4.2). */
export async function setClubLogo(db: DB, clubId: string, logoUrl: string | null): Promise<void> {
  await db.update(clubs).set({ logoUrl }).where(eq(clubs.id, clubId));
}

export type ClubSocial = typeof clubSocials.$inferSelect;

export function listSocials(db: DB, clubId: string): Promise<ClubSocial[]> {
  return db.select().from(clubSocials).where(eq(clubSocials.clubId, clubId)).orderBy(asc(clubSocials.platform));
}

export async function addSocial(db: DB, input: { clubId: string; platform: string; handle: string }): Promise<string> {
  const [row] = await db.insert(clubSocials).values({ clubId: input.clubId, platform: input.platform, handle: input.handle }).returning({ id: clubSocials.id });
  return row.id;
}

export async function removeSocial(db: DB, input: { clubId: string; socialId: string }): Promise<boolean> {
  const res = await db.delete(clubSocials)
    .where(and(eq(clubSocials.id, input.socialId), eq(clubSocials.clubId, input.clubId)))
    .returning({ id: clubSocials.id });
  return res.length > 0;
}

/**
 * The id of the club `slug` names, if `userId` is its approved owner AND the club is
 * ACTIVE — otherwise null.
 *
 * This is the TERMINAL authorization decision for `/api/club-logo/upload` and
 * `/api/club-logo/save`. Those are Route Handlers, not server actions: they never pass
 * through `requireOwner` or `requireActiveClub`, so whatever this function returns is
 * the whole of the check. It therefore has to encode the same rule those guards do,
 * and `active` is that rule — not merely "not rejected".
 *
 * `eq(status, 'active')`, not `inArray(SLUG_ADDRESSABLE_STATUSES)`, because a SUSPENDED
 * club's owner must not be able to drive a mutation by POSTing directly (spec §2). With
 * the not-rejected form, a suspended club's legitimate owner got a 200 from
 * `POST /api/club-logo/save` and the row's `logo_url` changed — and `setClubLogo` is
 * deliberately unaudited, so that write left no trace anywhere. Every other owner
 * mutation goes through a server action and refuses; this pair was the only leak.
 *
 * A `pending` club is excluded for the same reason: it has not been approved, so its
 * requester is not yet an operator of anything.
 *
 * `= 'active'` still uses `clubs_slug_uq`. The partial index's predicate is
 * `status IN (SLUG_ADDRESSABLE_STATUSES)` and Postgres can prove a single-value
 * equality implies membership of that list, so narrowing the filter costs no plan.
 */
export async function ownedClubId(db: DB, userId: string, slug: string): Promise<string | null> {
  const [row] = await db.select({ clubId: clubs.id })
    .from(clubs)
    .innerJoin(memberships, eq(memberships.clubId, clubs.id))
    .where(and(
      eq(clubs.slug, slug),
      eq(clubs.status, 'active'),
      eq(memberships.userId, userId),
      eq(memberships.role, 'owner'),
      eq(memberships.status, 'approved'),
    ))
    .limit(1);
  return row?.clubId ?? null;
}
