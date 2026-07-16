import { eq } from 'drizzle-orm';

import { clubs, memberships } from '@/db/schema';
import { type DB, getMembership } from '@/lib/membership';

export async function requestToJoin(
  db: DB,
  input: { clubId: string; userId: string },
): Promise<'created' | 'exists' | 'club_inactive'> {
  const [club] = await db.select({ status: clubs.status }).from(clubs).where(eq(clubs.id, input.clubId)).limit(1);
  if (!club || club.status !== 'active') return 'club_inactive';
  const existing = await getMembership(db, input.userId, input.clubId);
  if (existing) return 'exists';
  await db.insert(memberships).values({ userId: input.userId, clubId: input.clubId, role: 'member', status: 'pending' });
  return 'created';
}
