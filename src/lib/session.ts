import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';

export type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
export type CurrentUser = NonNullable<SessionResult>['user'];

/** The current Better Auth session (user + session) or null. */
export async function getSession(): Promise<SessionResult> {
  return auth.api.getSession({ headers: await headers() });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return (await getSession())?.user ?? null;
}

/** Require a signed-in user, else redirect to apex sign-in with a return target. */
export async function requireUser(redirectTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const q = redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : '';
    redirect(`/sign-in${q}`);
  }
  return user;
}

/** Require a platform admin; a non-admin gets a 404 (the console is not advertised). */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser('/admin');
  if (!user.isAdmin) notFound();
  return user;
}
