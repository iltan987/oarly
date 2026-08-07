import { NextResponse } from 'next/server';

import { db } from '@/db';
import { ownedClubId, setClubLogo } from '@/lib/club-profile';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { enforceRateLimit } from '@/lib/rate-limit-guard';
import { logoSaveSchema } from '@/lib/schemas';
import { getCurrentUser } from '@/lib/session';

// Persists a club logo immediately after a client upload (and clears it on
// remove), so it sticks without a separate profile Save. A Route Handler —
// not a server action — is used deliberately: a server action would refresh
// the profile route and remount the form, discarding any unsaved text edits.
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });

  // Shares one bucket with /api/club-logo/upload on purpose: an upload is always
  // followed by a save, so a single logoUploadPerAccount budget covers both halves
  // of a logo change.
  const verdict = await enforceRateLimit([
    { key: `logo:acct:${user.id}`, rule: RATE_LIMITS.logoUploadPerAccount },
  ]);
  if (verdict.limited) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const parsed = logoSaveSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

  const clubId = await ownedClubId(db, user.id, parsed.data.slug);
  if (!clubId) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });

  await setClubLogo(db, clubId, parsed.data.url || null);
  return NextResponse.json({ ok: true });
}
