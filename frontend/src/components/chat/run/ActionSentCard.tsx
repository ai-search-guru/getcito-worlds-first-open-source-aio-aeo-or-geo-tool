'use client';

import { useTranslations } from 'next-intl';
import { ArrowUpRight, ListChecks } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { ChatActionSent } from '@/lib/chat/events';

/**
 * What Chat sent to the Action Center (CHAT-09 item 19; mockup `#s-panel-app`
 * Send to Action Center): a new action, "Sent to Action Center · AC-1271",
 * whose Priority Score the Action Center sets; or a finding added to the
 * action that already covered it, "Added to AC-1258 · its targets don't
 * change". Open in Actions opens the action's drawer.
 */
export function ActionSentCard({ sent }: { sent: ChatActionSent }) {
  const t = useTranslations('chatRun.actionSent');
  const created = sent.kind === 'action_created';
  return (
    <article
      data-slot="action-sent-card"
      aria-label={created ? t('createdLabel') : t('addedLabel')}
      className="flex items-start gap-2.5 rounded-xl border bg-card p-3"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
        <ListChecks className="size-4 text-muted-foreground" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {created ? t('created', { no: sent.actionNo }) : t('added', { no: sent.actionNo })}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={sent.title}>
          {sent.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {created ? t('createdNote') : t('addedNote')}
        </p>
      </div>
      <Link
        href={sent.href}
        data-action="actionCenter.openInActions"
        className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {t('open')}
        <ArrowUpRight className="size-3.5" aria-hidden />
      </Link>
    </article>
  );
}
