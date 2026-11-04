import { useTranslations } from 'next-intl';
import { SignInForm } from '@/components/auth/SignInForm';
import { AuthCard, AuthShell } from '@/components/auth/AuthShell';
import { MailCheck } from 'lucide-react';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string }>;
}) {
  const params = await searchParams;
  const showVerificationBanner = params.verified === 'pending';

  return <SignInView showVerificationBanner={showVerificationBanner} />;
}

function SignInView({ showVerificationBanner }: { showVerificationBanner: boolean }) {
  const t = useTranslations('auth');

  return (
    <AuthShell prompt={t('noAccount')} cta={{ href: '/sign-up', label: t('createAccount') }}>
      <div className="flex flex-col gap-6">
        {showVerificationBanner && <VerificationBanner />}
        <AuthCard title={t('signIn')} subtitle={t('signInSubtitle')}>
          <SignInForm />
        </AuthCard>
      </div>
    </AuthShell>
  );
}

function VerificationBanner() {
  const t = useTranslations('auth');

  return (
    <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/50">
      <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
      <p className="text-sm text-blue-800 dark:text-blue-300">{t('verificationPending')}</p>
    </div>
  );
}
