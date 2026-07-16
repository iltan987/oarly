'use server';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { getSession } from '@/lib/session';
import { requireClub } from '@/lib/tenant';
import { requestToJoin } from '@/lib/join';

export async function joinAction(slug: string) {
  const session = await getSession();
  if (!session) return;
  const club = await requireClub(slug);
  await requestToJoin(db, { clubId: club.id, userId: session.user.id });
  revalidatePath(`/s/${slug}/join`);
}
