import type { UserMenuSession } from '@/components/user-menu';
import { env } from '@/env';
import type { CurrentUser } from '@/lib/session';
import { apexUrl, parseAppOrigin } from '@/lib/urls';

/**
 * Map the signed-in user onto `UserMenu`'s `session` prop, host-correctly.
 *
 * `/account` and `/sign-in` are apex-only routes. On a club subdomain a relative href
 * would stay on the tenant host and 404 — the same hazard documented at
 * `app/s/[slug]/manage/layout.tsx` — so tenant surfaces get absolute apex URLs and only
 * apex surfaces get the relative form (which keeps client-side navigation for them).
 *
 * Returns `undefined`, not a partially-filled object, for a guest: `UserMenu` treats an
 * absent `session` as "signed out", and that is the only representation of it.
 */
export function menuSession(
  user: Pick<CurrentUser, 'name' | 'email' | 'image'> | null | undefined,
  { tenant = false }: { tenant?: boolean } = {},
): UserMenuSession | undefined {
  if (!user) return undefined;
  const origin = parseAppOrigin(env.APP_URL);
  return {
    name: user.name,
    email: user.email,
    image: user.image,
    accountUrl: tenant ? apexUrl('/account', origin) : '/account',
    signOutUrl: apexUrl('/sign-in?signedout=1', origin),
  };
}
