import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { ownedClubId } from '@/lib/club-profile';
import { getCurrentUser } from '@/lib/session';

const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const user = await getCurrentUser();
        if (!user) throw new Error('Not authorized');
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
    // Auth failures get a 401; everything else is a generic 400 — the raw Blob
    // error message is logged, not echoed to the client (avoids info-leak).
    if ((error as Error).message === 'Not authorized') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
    }
    console.error('club-logo upload failed:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 400 });
  }
}
