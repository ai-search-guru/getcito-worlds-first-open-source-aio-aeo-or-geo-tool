import { useTranslations } from 'next-intl';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { AuthCard, AuthShell } from '@/components/auth/AuthShell';

export default function ResetPasswordPage() {
  const t = useTranslations('auth');

  return (
    <AuthShell cta={{ href: '/sign-in', label: t('signIn') }}>
      <AuthCard title={t('resetPasswordTitle')} subtitle={t('resetPasswordSubtitle')}>
        <ResetPasswordForm />
      </AuthCard>
    </AuthShell>
  );
}
