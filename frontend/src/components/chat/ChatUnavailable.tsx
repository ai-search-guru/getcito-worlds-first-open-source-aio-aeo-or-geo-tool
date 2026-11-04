import { useTranslations } from 'next-intl';
import { MessageSquareOff } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';

/**
 * A chat that isn't there for the person (CHAT-01 item 26): an unknown or
 * deleted chat, or someone else's that isn't shared. One line, one action
 * and a small line icon (DESIGN-POLISH empty states); nothing says which.
 */
export function ChatUnavailable() {
  const t = useTranslations('chatShell.unavailable');
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <MessageSquareOff aria-hidden className="size-5 text-muted-foreground" />
      <p className="text-sm">{t('title')}</p>
      <Link
        href="/dashboard/chat"
        data-action="chat.new"
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        {t('newChat')}
      </Link>
    </div>
  );
}
