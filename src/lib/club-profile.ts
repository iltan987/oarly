import { and, asc, eq, ne } from 'drizzle-orm';

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

export async function ownedClubId(db: DB, userId: string, slug: string): Promise<string | null> {
  const [row] = await db.select({ clubId: clubs.id })
    .from(clubs)
    .innerJoin(memberships, eq(memberships.clubId, clubs.id))
    .where(and(
      eq(clubs.slug, slug),
      // Same invariant as `findClubBySlug`: a rejected club is not addressable by slug.
      // `clubs_slug_uq` is partial, so a rejected `bogazici` and a live `bogazici`
      // coexist — and this is a write-authorization path, so an unfiltered `limit 1`
      // would let the rejected request's owner act under a slug at the planner's
      // discretion (spec §5.2).
      ne(clubs.status, 'rejected'),
      eq(memberships.userId, userId),
      eq(memberships.role, 'owner'),
      eq(memberships.status, 'approved'),
    ))
    .limit(1);
  return row?.clubId ?? null;
}
