import { eq } from 'drizzle-orm';

import type { DbOrTx } from '@/db';
import { user } from '@/db/schema';
import type { Locale } from '@/i18n/config';

/**
 * Mirror the UI language choice onto the user row.
 *
 * `user.locale` is read by exactly one consumer — transactional email
 * (`src/lib/notify.ts`, `userLocale()` in `src/auth.ts`) — and until now was written
 * only at credential sign-up and by Google's OAuth profile mapping. Without this, a user
 * who switches the UI to English keeps receiving Turkish booking notices forever.
 *
 * Deliberately NOT in `set-locale.ts`: that file is `'use server'`, so every export
 * becomes a Server Action and a `Db` parameter would be an unserializable argument.
 */
export async function setUserLocale(db: DbOrTx, userId: string, locale: Locale): Promise<void> {
  await db.update(user).set({ locale }).where(eq(user.id, userId));
}
