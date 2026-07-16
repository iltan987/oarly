import { eq } from 'drizzle-orm';

import { clubs, memberships, user } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { DB } from '@/lib/membership';
import { validateSlug } from '@/lib/slug';

// Better Auth's internal adapter lowercases `email` on both `createUser` and
// `findUserByEmail` (see internal-adapter.ts), so every row Better Auth writes
// already has a lowercase email — matching against `.toLowerCase()` here is
// consistent with how Better Auth itself looks users up, no `lower()` SQL needed.
export async function createClub(
  db: DB,
  input: { name: string; slug: string; ownerEmail: string; createdBy: string },
): Promise<{ ok: true; clubId: string } | { ok: false; error: 'slug_invalid' | 'slug_reserved' | 'slug_taken' | 'owner_not_found' }> {
  const v = validateSlug(input.slug);
  if (!v.ok) return { ok: false, error: v.reason === 'reserved' ? 'slug_reserved' : 'slug_invalid' };

  const [owner] = await db.select().from(user).where(eq(user.email, input.ownerEmail.trim().toLowerCase())).limit(1);
  if (!owner) return { ok: false, error: 'owner_not_found' };

  const [existing] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, input.slug)).limit(1);
  if (existing) return { ok: false, error: 'slug_taken' };

  return db.transaction(async (tx) => {
    const [club] = await tx.insert(clubs)
      .values({ name: input.name, slug: input.slug, status: 'active', createdBy: input.createdBy })
      .returning({ id: clubs.id });
    await tx.insert(memberships).values({ userId: owner.id, clubId: club.id, role: 'owner', status: 'approved' });
    await logAudit(tx as unknown as DB, { actorUserId: input.createdBy, clubId: club.id, action: 'club.create', target: club.id });
    return { ok: true, clubId: club.id };
  });
}

export async function setClubStatus(
  db: DB,
  input: { clubId: string; status: 'active' | 'suspended'; actorId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(clubs).set({ status: input.status }).where(eq(clubs.id, input.clubId));
    await logAudit(tx as unknown as DB, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: input.status === 'active' ? 'club.activate' : 'club.suspend',
      target: input.clubId,
    });
  });
}
