import { and, eq, ne } from 'drizzle-orm';

import { clubs, memberships } from '@/db/schema';
import type { DB } from '@/lib/membership';
import { validateSlug } from '@/lib/slug';

export async function requestClub(
  db: DB,
  input: { name: string; slug: string; ownerId: string },
): Promise<{ ok: true; clubId: string } | { ok: false; error: 'slug_invalid' | 'slug_reserved' | 'slug_taken' }> {
  const v = validateSlug(input.slug);
  if (!v.ok) return { ok: false, error: v.reason === 'reserved' ? 'slug_reserved' : 'slug_invalid' };
  // `ne(status, 'rejected')` mirrors the partial index `clubs_slug_uq`: a rejected
  // request no longer holds its slug, so it must not report `slug_taken` either.
  const [existing] = await db.select({ id: clubs.id }).from(clubs)
    .where(and(eq(clubs.slug, input.slug), ne(clubs.status, 'rejected'))).limit(1);
  if (existing) return { ok: false, error: 'slug_taken' };
  return db.transaction(async (tx) => {
    const [club] = await tx.insert(clubs)
      .values({ name: input.name, slug: input.slug, status: 'pending', createdBy: input.ownerId })
      .returning({ id: clubs.id });
    await tx.insert(memberships).values({ userId: input.ownerId, clubId: club.id, role: 'owner', status: 'approved' });
    return { ok: true, clubId: club.id };
  });
}
