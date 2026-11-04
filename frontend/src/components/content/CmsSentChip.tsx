'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { AlertTriangle, Clock, CloudOff, Send } from 'lucide-react';
import type { DraftCms } from '@/lib/content/cmsSendClient';
import { cn } from '@/lib/utils';

/**
 * The editor header's word on the page's last send to a CMS (#1331), beside
 * its status: "In Webflow · draft", "Sent to your CMS", "Sending…" or "Send
 * failed", or "Taken down" (00460). The page's status stays what the person set: a page sent as a
 * Webflow draft item is still the person's to publish there. A published
 * page says so in its status; nothing more here.
 */
export function CmsSentChip({ last }: { last: NonNullable<DraftCms['last']> }) {
  const t = useTranslations('contentEditor.editor.sentChip');
  const tLibrary = useTranslations('contentEditor.library.cms');
  const format = useFormatter();
  if (last.status === 'published') return null;
  const when = format.dateTime(new Date(last.at), { dateStyle: 'medium', timeStyle: 'short' });
  // The Library's sentence, with when: the chip's tip.
  const tip = tLibrary(last.target === 'webflow' ? `webflow.${last.status}` : last.status, {
    when,
  });
  const failed = last.status === 'failed';
  // Taken down: a draft in its CMS again, in the Library's word and muted tone.
  const takenDown = last.status === 'taken_down';
  const Icon = failed
    ? AlertTriangle
    : takenDown
      ? CloudOff
      : last.status === 'queued'
        ? Clock
        : Send;
  return (
    <span
      title={failed && last.error ? `${tip} ${last.error}` : tip}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium',
        failed
          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
          : takenDown
            ? 'border-border bg-muted text-muted-foreground'
            : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300',
      )}
    >
      <Icon aria-hidden className="h-3 w-3" />
      {takenDown ? t('takenDown') : t(`${last.target}.${last.status}`)}
    </span>
  );
}
