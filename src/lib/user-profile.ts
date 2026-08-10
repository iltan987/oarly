import { eq } from 'drizzle-orm';

import type { DbOrTx } from '@/db';
import { user } from '@/db/schema';
import type { paymentTypeEnum } from '@/db/schema/enums';

export type UserProfileFields = {
  firstName: string;
  lastName: string;
  phone: string;
  /** `null` clears it. Never collected at sign-up, so most rows arrive here still null. */
  birthday: string | null;
  /** `null` is "never answered", which is NOT the same as `'prefer_not_to_say'`. */
  gender: string | null;
  defaultPaymentType: (typeof paymentTypeEnum.enumValues)[number];
};

/**
 * Write the six self-service profile columns for one user.
 *
 * Takes `DbOrTx` as its first parameter and lives here rather than in `app/account/
 * actions.ts`, for exactly the reason `user-locale.ts` gives: that module is
 * `'use server'`, so every export becomes a Server Action and a `Db` argument would be an
 * unserializable parameter.
 *
 * ## It also rewrites `user.name`, and that is not incidental
 *
 * `name` is NOT NULL and is the single field the header avatar renders — `initials(name)`
 * in `user-menu.tsx`, and the identity line above the Account link. It is composed at
 * sign-up as `` `${firstName} ${lastName}` `` (`sign-up-form.tsx`) and, before this, was
 * never written again. Update only `firstName`/`lastName` and a member who corrects the
 * spelling of their own name keeps the old initials in the header forever, on every route,
 * with no way to fix it — the edit appears to have silently failed.
 *
 * `.trim()` matters for the same reason it does at sign-up: the schema guarantees both
 * parts are non-empty AFTER trimming, but ` ` between them is still template text, and a
 * name is never allowed to be blank or padded.
 *
 * `birthday` is bound as a `'YYYY-MM-DD'` STRING: `date('birthday')` in drizzle-pg defaults
 * to `mode: 'string'`. Better Auth separately declares the field as `{ type: 'date' }`
 * (`src/auth.ts`), so the SESSION-shaped value can be a `Date` — which is why `/account`
 * reads the row through drizzle rather than off the session.
 */
export async function updateUserProfile(
  db: DbOrTx,
  userId: string,
  fields: UserProfileFields,
): Promise<void> {
  await db
    .update(user)
    .set({
      ...fields,
      name: `${fields.firstName} ${fields.lastName}`.trim(),
    })
    .where(eq(user.id, userId));
}
