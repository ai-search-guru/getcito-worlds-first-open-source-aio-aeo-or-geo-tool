import { useTranslations } from 'next-intl';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { AuthCard, AuthShell } from '@/components/auth/AuthShell';

export default function SignUpPage() {
  const t = useTranslations('auth');

  return (
    <AuthShell prompt={t('hasAccount')} cta={{ href: '/sign-in', label: t('signIn') }}>
      <AuthCard title={t('signUp')} subtitle={t('signUpSubtitle')}>
        <SignUpForm />
      </AuthCard>
    </AuthShell>
  );
}
