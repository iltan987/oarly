import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { getCurrentUser } from '@/lib/session';

import { SignUpForm } from './sign-up-form';

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect('/');
  const t = await getTranslations('auth');
  return <SignUpForm title={t('signUpTitle')} />;
}
