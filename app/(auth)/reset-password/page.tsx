import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ResetPasswordForm } from './reset-password-form';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getTranslations('auth');

  if (!token) {
    return (
      <div className="w-full">
        <h1 className="mb-4 font-heading text-2xl font-bold">{t('resetTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('errorGeneric')}</p>
        <Link href="/forgot-password" className="text-sm hover:underline">{t('requestNewLink')}</Link>
      </div>
    );
  }

  return <ResetPasswordForm title={t('resetTitle')} token={token} />;
}
