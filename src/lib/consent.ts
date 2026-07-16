import { consents } from '@/db/schema';
import type { DB } from '@/lib/membership';

/** KVKK documents accepted at sign-up. Bump CONSENT_VERSION when the texts change. */
export const CONSENT_DOCUMENTS = ['privacy_policy', 'kvkk_clarification'] as const;
export const CONSENT_VERSION = '2026-07-15';

/** Record one consent row per document for a newly-created user. */
export async function recordSignupConsent(db: DB, userId: string): Promise<void> {
  await db.insert(consents).values(
    CONSENT_DOCUMENTS.map((document) => ({ userId, document, version: CONSENT_VERSION })),
  );
}
