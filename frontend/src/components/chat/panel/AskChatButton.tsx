'use client';

import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { shortcutLabel, useIsMac } from '../ChatShortcuts';
import { useChatPanel } from './chatPanelContext';

/**
 * "Ask Chat" at the top right of every app page's header (CHAT-01 item 13,
 * mockup `#s-panel-app` `.askbtn`): opens and closes the side panel, with
 * its key beside it, filled dark while the panel is open. Nothing where the
 * panel isn't: Chat's own routes, the Content Editor, the Chat flag off, or
 * the person turned Ask Chat on pages off.
 */
export function AskChatButton({ className }: { className?: string }) {
  const t = useTranslations('chatPanel');
  const panel = useChatPanel();
  const isMac = useIsMac();
  if (!panel?.available) return null;
  const keys = shortcutLabel('panel', isMac);
  return (
    <Button
      type="button"
      data-action="panel.open"
      variant={panel.open ? 'default' : 'outline'}
      aria-pressed={panel.open}
      aria-controls="chat-side-panel"
      aria-keyshortcuts="Control+J Meta+J"
      onClick={panel.toggle}
      className={cn('shrink-0', className)}
    >
      <Sparkles aria-hidden />
      {t('askChat')}
      <kbd
        className={cn(
          'ml-0.5 rounded-[4px] border px-1 font-sans text-[11px] font-normal',
          panel.open
            ? 'border-primary-foreground/30 text-primary-foreground/80'
            : 'text-muted-foreground',
        )}
      >
        {keys}
      </kbd>
    </Button>
  );
}
