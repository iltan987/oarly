import { getTranslations } from 'next-intl/server';
import { SignUpForm } from './sign-up-form';

export default async function SignUpPage() {
  const t = await getTranslations('auth');
  return <SignUpForm title={t('signUpTitle')} />;
}
