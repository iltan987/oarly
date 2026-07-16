import { eq } from 'drizzle-orm';
import { clubs, memberships } from '@/db/schema';
import { validateSlug } from '@/lib/slug';
import type { DB } from '@/lib/membership';

export async function requestClub(
  db: DB,
  input: { name: string; slug: string; ownerId: string },
): Promise<{ ok: true; clubId: string } | { ok: false; error: 'slug_invalid' | 'slug_reserved' | 'slug_taken' }> {
  const v = validateSlug(input.slug);
  if (!v.ok) return { ok: false, error: v.reason === 'reserved' ? 'slug_reserved' : 'slug_invalid' };
  const [existing] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, input.slug)).limit(1);
  if (existing) return { ok: false, error: 'slug_taken' };
  return db.transaction(async (tx) => {
    const [club] = await tx.insert(clubs)
      .values({ name: input.name, slug: input.slug, status: 'pending', createdBy: input.ownerId })
      .returning({ id: clubs.id });
    await tx.insert(memberships).values({ userId: input.ownerId, clubId: club.id, role: 'owner', status: 'approved' });
    return { ok: true, clubId: club.id };
  });
}
