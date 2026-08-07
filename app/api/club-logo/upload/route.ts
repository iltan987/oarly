import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { ownedClubId } from '@/lib/club-profile';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { enforceRateLimit } from '@/lib/rate-limit-guard';
import { getCurrentUser } from '@/lib/session';

// No image/svg+xml: an SVG served from our Blob origin is an active document, and it
// buys nothing a PNG/WebP logo doesn't.
const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export async function POST(request: Request): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const user = await getCurrentUser();
        if (!user) throw new Error('Not authorized');
        // Shares one bucket with /api/club-logo/save on purpose: an upload is always
        // followed by a save, so a single logoUploadPerAccount budget covers both
        // halves of a logo change.
        const verdict = await enforceRateLimit([
          { key: `logo:acct:${user.id}`, rule: RATE_LIMITS.logoUploadPerAccount },
        ]);
        if (verdict.limited) throw new Error('Rate limited');
        const clubId = await ownedClubId(db, user.id, clientPayload ?? '');
        if (!clubId) throw new Error('Not authorized');
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ clubId }),
        };
      },
      // No onUploadCompleted callback: the browser receives the blob URL directly
      // from upload() and persists it via POST /api/club-logo/save. (An
      // onUploadCompleted webhook cannot reach localhost during dev anyway.)
    });
    return NextResponse.json(json);
  } catch (error) {
    // Auth failures get a 401, rate-limit rejections a 429, everything else a generic
    // 400 — the raw Blob error message is logged, not echoed to the client (avoids
    // info-leak).
    if ((error as Error).message === 'Rate limited') {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    if ((error as Error).message === 'Not authorized') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
    }
    console.error('club-logo upload failed:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 400 });
  }
}
