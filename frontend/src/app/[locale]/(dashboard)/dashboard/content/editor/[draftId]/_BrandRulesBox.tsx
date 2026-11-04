'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * The brand's rules (Settings › Content, 00450) at the top of the Rules
 * tab, read-only: the Content Agent follows them on every page of the
 * brand, before the page's own rules. Edit opens Settings › Content.
 */
export function BrandRulesBox({ rules, brandName }: { rules: string[]; brandName: string }) {
  const t = useTranslations('contentEditor.editor.rules.brandRules');
  if (rules.length === 0) return null;
  return (
    <section
      data-slot="brand-rules"
      aria-label={t('title')}
      className="space-y-1.5 rounded-xl border px-3 py-2.5"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('title')}
        </span>
        <span className="rounded-full border px-1.5 py-px text-[11px] text-muted-foreground">
          {t('fromSettings')}
        </span>
        <Link
          href="/dashboard/settings/content"
          className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {t('edit')}
        </Link>
      </div>
      <ul className="space-y-1 text-[13px]">
        {rules.map((rule) => (
          <li key={rule} className="flex items-start gap-2">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/50" />
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{rule}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t('note', { brand: brandName })}</p>
    </section>
  );
}
