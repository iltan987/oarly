import { getTranslations } from 'next-intl/server';
import { env } from '@/env';
import { parseAppOrigin, safeRedirect } from '@/lib/urls';
import { SignInForm } from './sign-in-form';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;
  const t = await getTranslations('auth');
  const dest = safeRedirect(redirect, parseAppOrigin(env.APP_URL), '/');
  return <SignInForm title={t('signInTitle')} redirectTo={dest} />;
}
