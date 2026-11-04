'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { OAuthButtons } from '@/components/auth/OauthButtons';
import { OrDivider } from '@/components/auth/OrDivider';
import { siteConfig } from '@/config/site';
import { stripInviteParams } from '@/lib/inviteUrl';
import { cn } from '@/lib/utils';

export function SignUpForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  // An invitation link's address and way back are read once: the link's token
  // and the invited address then leave the address bar and browser history.
  const [invitedEmail] = useState(() => searchParams.get('email') ?? '');
  const [nextPath] = useState(() => searchParams.get('next'));
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const clean = stripInviteParams(window.location.href);
    if (clean) window.history.replaceState(null, '', clean);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (password.length < 8) {
      toast.error(t('errors.passwordTooShort'));
      return;
    }

    setIsLoading(true);
    const supabase = createClient();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) {
      toast.error(t('errors.generic'));
      setIsLoading(false);
      return;
    }

    toast.success(t('verificationEmailSent'));
    const nextQuery = nextPath ? `&next=${encodeURIComponent(nextPath)}` : '';
    router.push(`/sign-in?verified=pending${nextQuery}`);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="fullName">{t('fullName')}</Label>
          <Input
            id="fullName"
            type="text"
            placeholder={t('fullNamePlaceholder')}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            autoComplete="name"
            disabled={isLoading}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t('workEmail')}</Label>
          <Input
            id="email"
            type="email"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            disabled={isLoading || Boolean(invitedEmail)}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">{t('password')}</Label>
          <PasswordInput
            id="password"
            placeholder={t('passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            disabled={isLoading}
            className="h-11"
          />
          <p
            className={cn(
              'flex items-center gap-2 text-sm transition-colors',
              password.length >= 8 ? 'text-muted-foreground' : 'text-muted-foreground/70',
            )}
          >
            <Check
              className={cn(
                'h-4 w-4',
                password.length >= 8 ? 'text-emerald-500' : 'text-muted-foreground/40',
              )}
            />
            {t('passwordRuleLength')}
          </p>
        </div>

        <Button type="submit" className="h-11 w-full text-base" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('signingUp')}
            </>
          ) : (
            <>
              {t('createAccount')}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      <OrDivider label={t('orContinueWith')} />
      <OAuthButtons next={nextPath} />

      <p className="text-center text-sm text-muted-foreground">
        {t('termsAgreement')}{' '}
        <a
          href={siteConfig.legal.terms}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          {t('termsOfService')}
        </a>{' '}
        {t('and')}{' '}
        <a
          href={siteConfig.legal.privacy}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          {t('privacyPolicy')}
        </a>
        .
      </p>
    </div>
  );
}
