import { and, asc, eq } from 'drizzle-orm';

import type { DB } from '@/db';
import { clubs, clubSocials, memberships } from '@/db/schema';

export interface ProfileInput {
  name: string;
  tagline: string | null;
  description: string | null;
  phone: string | null;
  brandAccent: string | null;
  headingFont: 'default' | 'premium';
  logoUrl: string | null;
}

export async function updateClubProfile(db: DB, clubId: string, input: ProfileInput): Promise<boolean> {
  const res = await db.update(clubs).set({
    name: input.name, tagline: input.tagline, description: input.description,
    phone: input.phone, brandAccent: input.brandAccent, headingFont: input.headingFont,
    logoUrl: input.logoUrl,
  }).where(eq(clubs.id, clubId)).returning({ id: clubs.id });
  return res.length > 0;
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
      eq(memberships.userId, userId),
      eq(memberships.role, 'owner'),
      eq(memberships.status, 'approved'),
    ))
    .limit(1);
  return row?.clubId ?? null;
}
