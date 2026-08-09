import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AppWordmark } from '@/components/app-brand';
import { AppFooter, footerLabels } from '@/components/app-footer';
import { AppShell } from '@/components/app-shell';
import { UserMenu } from '@/components/user-menu';
import { db } from '@/db';
import { user as userTable } from '@/db/schema';
import { menuSession } from '@/lib/menu-session';
import { requireUser } from '@/lib/session';

import { AccountForm } from './account-form';

/**
 * The member's own profile — the only place any of these six columns can be edited after
 * sign-up. Apex-only: `/account` is in `RESERVED_APEX_SEGMENTS`, and on a club subdomain it
 * would rewrite to `/s/{slug}/account` and 404, which is why `menu-session.ts` resolves the
 * user menu's Account link through `apexUrl()` on tenant surfaces.
 */
export default async function AccountPage() {
  const sessionUser = await requireUser('/account');
  const t = await getTranslations('account');
  const tCommon = await getTranslations('common');

  /*
   * Read the row with drizzle rather than off the session object, and it is `birthday`
   * that forces it. `date('birthday')` in drizzle-pg defaults to `mode: 'string'`, so this
   * query yields `'YYYY-MM-DD'`. Better Auth separately declares the same field as
   * `{ type: 'date' }` (`src/auth.ts`), so the SESSION-shaped value may be a `Date` — and
   * `<input type="date">` renders a `Date` as BLANK, with no error and no warning. A member
   * would set a birthday, reload, and find the field empty again.
   *
   * `phone`, `firstName` and `lastName` are nullable too (Google sign-in never fills them),
   * so each is flattened to '' for the uncontrolled inputs.
   */
  const [row] = await db
    .select({
      email: userTable.email,
      firstName: userTable.firstName,
      lastName: userTable.lastName,
      phone: userTable.phone,
      birthday: userTable.birthday,
      gender: userTable.gender,
      defaultPaymentType: userTable.defaultPaymentType,
      updatedAt: userTable.updatedAt,
    })
    .from(userTable)
    .where(eq(userTable.id, sessionUser.id))
    .limit(1);

  // A live session pointing at a deleted row. Rendering a blank form here would offer to
  // "save" into a row that no longer exists.
  if (!row) notFound();

  return (
    <AppShell
      width="2xl"
      brand={<AppWordmark name={tCommon('appName')} />}
      menu={<UserMenu session={menuSession(sessionUser)} />}
      footer={<AppFooter labels={await footerLabels()} />}
    >
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('body')}</p>
      </div>
      <AccountForm
        profile={{
          email: row.email,
          firstName: row.firstName ?? '',
          lastName: row.lastName ?? '',
          phone: row.phone ?? '',
          birthday: row.birthday ?? '',
          gender: row.gender ?? '',
          defaultPaymentType: row.defaultPaymentType,
          updatedAt: row.updatedAt,
        }}
      />
    </AppShell>
  );
}
