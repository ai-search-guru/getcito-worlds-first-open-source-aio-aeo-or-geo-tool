'use client';

import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import type { ChatWhatsNewEntry } from '@/lib/chat/events';
import { cn } from '@/lib/utils';

/** Marks an entry read when its Try it is opened (CHAT-11 item 18); a failure only shows it again. */
export function markWhatsNewOpened(slug: string) {
  void fetch('/api/chat/whats-new/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slugs: [slug] }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * What's new's cards under an answer (CHAT-11 item 10, mockup `#s-home`;
 * W4-21): up to three, each the feature's name, the team's lines and Try
 * it, which opens its page with the brand open now (in the side panel, the
 * page behind it). An entry the plan doesn't include says "On {plans}."
 * with See plans. The words are the team's, as approved: Chat never
 * changes them.
 */
export function WhatsNewCards({ entries }: { entries: readonly ChatWhatsNewEntry[] }) {
  const t = useTranslations('chatRun.whatsNew');
  if (entries.length === 0) return null;
  return (
    <div data-slot="whats-new-cards" className="grid gap-2">
      {entries.map((entry) => (
        <article
          key={entry.slug}
          aria-label={entry.feature}
          className="rounded-[14px] border bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(10,10,10,.04)]"
        >
          <div className="mb-1 flex items-center gap-2">
            <Sparkles aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <b className="min-w-0 truncate text-[13.5px] font-semibold">{entry.feature}</b>
            <span className="ml-auto rounded-md border px-1.5 py-px text-[10.5px] tracking-[.05em] text-muted-foreground uppercase">
              {t('tag')}
            </span>
          </div>
          <ul className="space-y-0.5 text-[13px] leading-[1.45] text-foreground/85">
            {entry.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {entry.onPlans && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t('onPlans', { plans: entry.onPlans })}{' '}
              <Link
                href="/dashboard/settings/billing"
                data-action="plans.compare"
                className="text-foreground underline underline-offset-2"
              >
                {t('seePlans')}
              </Link>
            </p>
          )}
          <div className="mt-2">
            <Link
              href={entry.href}
              data-action="whatsNew.tryIt"
              onClick={() => markWhatsNewOpened(entry.slug)}
              aria-label={t('tryItLabel', { feature: entry.feature })}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              {t('tryIt')}
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
