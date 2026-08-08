import { and, eq, inArray } from 'drizzle-orm';

import { clubs, memberships, SLUG_ADDRESSABLE_STATUSES } from '@/db/schema';
import type { DB } from '@/lib/membership';
import { validateSlug } from '@/lib/slug';

export async function requestClub(
  db: DB,
  input: { name: string; slug: string; ownerId: string },
): Promise<{ ok: true; clubId: string } | { ok: false; error: 'slug_invalid' | 'slug_reserved' | 'slug_taken' }> {
  const v = validateSlug(input.slug);
  if (!v.ok) return { ok: false, error: v.reason === 'reserved' ? 'slug_reserved' : 'slug_invalid' };
  // Mirrors the partial index `clubs_slug_uq` — literally, via the same constant: a
  // rejected request no longer holds its slug, so it must not report `slug_taken`
  // either, and spelling the filter the index's own way is what lets this pre-check
  // use it instead of scanning `clubs`.
  const [existing] = await db.select({ id: clubs.id }).from(clubs)
    .where(and(eq(clubs.slug, input.slug), inArray(clubs.status, SLUG_ADDRESSABLE_STATUSES))).limit(1);
  if (existing) return { ok: false, error: 'slug_taken' };
  return db.transaction(async (tx) => {
    const [club] = await tx.insert(clubs)
      .values({ name: input.name, slug: input.slug, status: 'pending', createdBy: input.ownerId })
      .returning({ id: clubs.id });
    await tx.insert(memberships).values({ userId: input.ownerId, clubId: club.id, role: 'owner', status: 'approved' });
    return { ok: true, clubId: club.id };
  });
}
