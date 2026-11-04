import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { BarChart3, Compass, Zap } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { siteConfig } from '@/config/site';
import { cn } from '@/lib/utils';

/**
 * The frame every auth page shares: a header with the switch to the other
 * auth page, the product pitch on the left (wide screens only) and the page's
 * card on the right.
 */
export function AuthShell({
  prompt,
  cta,
  children,
}: {
  /** The question beside the header button, e.g. "Don't have an account?" */
  prompt?: string;
  cta: { href: '/sign-in' | '/sign-up'; label: string };
  children: React.ReactNode;
}) {
  const t = useTranslations('auth');

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-[#f7f5f1] dark:bg-background">
      <Backdrop />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-6 sm:px-8">
        <a href={siteConfig.url} className="flex items-center gap-2.5">
          <Image
            src="/brand/icons/getcito-icon-512.png"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 dark:hidden"
            priority
          />
          <Image
            src="/brand/icons/getcito-icon-dark-512.png"
            alt=""
            width={36}
            height={36}
            className="hidden h-9 w-9 shrink-0 dark:block"
            priority
          />
          <span className="text-2xl font-semibold tracking-tight">{siteConfig.name}</span>
        </a>

        <div className="flex items-center gap-4">
          {prompt && (
            <span className="hidden text-sm text-muted-foreground sm:inline">{prompt}</span>
          )}
          <Link href={cta.href} className={buttonVariants({ className: 'h-10 px-5' })}>
            {cta.label}
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 items-center gap-12 px-4 py-8 sm:px-8 lg:grid-cols-2 lg:gap-16">
        <Pitch />
        <div className="mx-auto w-full max-w-lg">{children}</div>
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-8">
        <p>
          &copy; {new Date().getFullYear()} {siteConfig.name}. {t('footer.openSource')}{' '}
          <a
            href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            {t('footer.mitLicense')}
          </a>
          .
        </p>
        <div className="flex items-center gap-8">
          <a
            href={siteConfig.legal.terms}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            {t('footer.terms')}
          </a>
          <a
            href={siteConfig.legal.privacy}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            {t('footer.privacy')}
          </a>
        </div>
      </footer>
    </div>
  );
}

/** The white card holding a page's form. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-card p-6 shadow-[0_12px_40px_rgba(60,45,30,0.06)] sm:p-10 dark:border-border dark:shadow-none">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

const FEATURES = [
  { key: 'monitor', icon: BarChart3 },
  { key: 'discover', icon: Compass },
  { key: 'act', icon: Zap },
] as const;

function Pitch() {
  const t = useTranslations('auth.pitch');

  return (
    <section className="hidden lg:block">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {t('eyebrow')}
      </p>
      <h2 className="mt-6 text-6xl font-semibold leading-[1.05] tracking-tight">
        {t('titleLead')}{' '}
        <span className="relative inline-block">
          {t('titleAccent')}
          <svg
            aria-hidden
            viewBox="0 0 300 12"
            preserveAspectRatio="none"
            className="absolute -bottom-3 left-0 h-3 w-full text-[#e4d8c6] dark:text-white/15"
          >
            <path
              d="M2 8 C 80 2, 200 2, 298 6"
              stroke="currentColor"
              strokeWidth="6"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </span>
      </h2>
      <p className="mt-10 max-w-md text-2xl leading-snug text-muted-foreground">{t('subtitle')}</p>

      <ul className="mt-10 space-y-7">
        {FEATURES.map(({ key, icon: Icon }) => (
          <li key={key} className="flex gap-6">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#efe9df] text-[#3d2f22] dark:bg-white/5 dark:text-foreground">
              <Icon className="h-6 w-6" />
            </span>
            <div className="max-w-xs">
              <p className="text-lg font-medium leading-snug">{t(`features.${key}.title`)}</p>
              <p className="mt-1 text-muted-foreground">{t(`features.${key}.body`)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Soft circles and a dot grid behind the page; decoration only. */
function Backdrop() {
  const circle = 'absolute rounded-full bg-[#efebe4] dark:bg-white/[0.03]';
  const dots = cn(
    'absolute hidden lg:block',
    'bg-[radial-gradient(circle,rgba(0,0,0,0.12)_1px,transparent_1.5px)] bg-[length:16px_16px]',
    'dark:bg-[radial-gradient(circle,rgba(255,255,255,0.12)_1px,transparent_1.5px)]',
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className={cn(circle, '-left-64 top-16 h-[28rem] w-[28rem]')} />
      <div className={cn(circle, '-left-72 bottom-[-12rem] h-[30rem] w-[30rem]')} />
      <div className={cn(circle, 'bottom-[-26rem] left-1/3 h-[40rem] w-[40rem]')} />
      <div className={cn(circle, '-right-56 bottom-[-6rem] h-[34rem] w-[34rem]')} />
      <div className={cn(dots, 'left-[44%] top-48 h-28 w-28')} />
      <div className={cn(dots, 'bottom-56 right-4 h-28 w-20')} />
    </div>
  );
}
