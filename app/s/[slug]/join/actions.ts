'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { db } from '@/db';
import { env } from '@/env';
import { requestToJoin } from '@/lib/join';
import { getSession } from '@/lib/session';
import { requireClub } from '@/lib/tenant';
import { apexUrl, clubUrl, parseAppOrigin } from '@/lib/urls';

export async function joinAction(slug: string) {
  const session = await getSession();
  if (!session) {
    const origin = parseAppOrigin(env.APP_URL);
    const back = `${clubUrl(slug, origin)}/join`;
    redirect(`${apexUrl('/sign-in', origin)}?redirect=${encodeURIComponent(back)}`);
  }
  const club = await requireClub(slug);
  const result = await requestToJoin(db, { clubId: club.id, userId: session.user.id });
  revalidatePath(`/s/${slug}/join`);
  if (result === 'club_inactive') redirect('/join');
}
