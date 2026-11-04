'use client';

import { useTranslations } from 'next-intl';
import { MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatReference } from '@/lib/chat/references';
import { cn } from '@/lib/utils';
import { useChatPanel } from './chatPanelContext';

/**
 * "Ask about this" on a chart, a table row or an Action Center task
 * (CHAT-01 item 22): opens Chat's side panel with the object attached as
 * an @ reference, the question left to the person. Nothing where the panel
 * isn't (the Chat flag off, Ask Chat on pages off, Chat's own routes).
 */
export function AskAboutThis({
  reference,
  className,
}: {
  reference: ChatReference;
  className?: string;
}) {
  const t = useTranslations('chatPanel');
  const panel = useChatPanel();
  if (!panel?.available) return null;
  const label = t('askAbout', { name: reference.label });
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      data-action="page.askAboutThis"
      aria-label={label}
      title={label}
      onClick={(event) => {
        // On a row that opens on a click, only the panel opens.
        event.stopPropagation();
        panel.ask(reference);
      }}
      className={cn('text-muted-foreground hover:text-foreground', className)}
    >
      <MessageSquarePlus aria-hidden />
    </Button>
  );
}
