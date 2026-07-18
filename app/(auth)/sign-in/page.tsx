import { redirect as redirectTo } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { env } from '@/env';
import { getCurrentUser } from '@/lib/session';
import { parseAppOrigin, safeRedirect } from '@/lib/urls';

import { SignInForm } from './sign-in-form';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; signedout?: string; error?: string }>;
}) {
  const { redirect, signedout, error } = await searchParams;
  const t = await getTranslations('auth');
  const dest = safeRedirect(redirect, parseAppOrigin(env.APP_URL), '/');
  if (await getCurrentUser()) redirectTo(dest);
  return (
    <SignInForm
      title={t('signInTitle')}
      redirectTo={dest}
      signedOut={signedout === '1'}
      errorCode={error}
    />
  );
}
