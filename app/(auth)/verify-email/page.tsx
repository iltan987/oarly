import { getTranslations } from 'next-intl/server';

import { VerifyEmailNotice } from './verify-email-notice';

export default async function VerifyEmailPage() {
  const t = await getTranslations('auth');
  return <VerifyEmailNotice title={t('verifyTitle')} body={t('verifyBody')} />;
}
