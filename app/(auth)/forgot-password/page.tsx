import { getTranslations } from 'next-intl/server';

import { ForgotPasswordForm } from './forgot-password-form';

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth');
  return <ForgotPasswordForm title={t('forgotTitle')} body={t('forgotBody')} />;
}
