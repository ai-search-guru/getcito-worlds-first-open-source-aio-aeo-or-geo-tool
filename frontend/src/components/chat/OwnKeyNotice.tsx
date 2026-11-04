'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { useUserRole } from '@/hooks/useUserRole';
import { Link } from '@/i18n/navigation';
import type { AiProvider } from '@/lib/agent/providers';
import type { FailingKey } from '@/lib/chat/keyHealth';
import { cn } from '@/lib/utils';

const AI_PROVIDERS_PATH = '/dashboard/settings/ai-providers';

/** A provider's name as Settings › AI Providers shows it. */
function useProviderName(provider: AiProvider): string {
  const tProviders = useTranslations('settings.agent_providers');
  return tProviders.has(`${provider}.name`) ? tProviders(`${provider}.name`) : provider;
}

/** Why the key fails, in words, by its provider's name. */
function useKeyWhy(key: FailingKey): string {
  const t = useTranslations('chatAgents.ownKey');
  const provider = useProviderName(key.provider);
  return t(`why.${key.class}`, { provider });
}

/**
 * Agent Center's banner while the workspace's own key fails (AGENT-OWN-KEY
 * §5.2 item 6), for everyone who sees agents: Admins get Fix in AI
 * Providers; others read that an Admin can fix it there.
 */
export function AgentsKeyBanner({ failing }: { failing: FailingKey }) {
  const t = useTranslations('chatAgents.ownKey');
  const { canAdmin } = useUserRole();
  const why = useKeyWhy(failing);
  const provider = useProviderName(failing.provider);
  return (
    <div
      role="status"
      data-slot="agents-key-banner"
      className="mb-1 grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-500" aria-hidden />
      <div className="min-w-0">
        <b className="font-semibold">{t('banner', { provider })}</b>
        <span className="ml-1.5">{why}</span>
        {!canAdmin && <span className="ml-1.5">{t('askAdmin')}</span>}
      </div>
      {canAdmin && (
        <Link
          href={AI_PROVIDERS_PATH}
          data-action="agents.fixKey"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-xs')}
        >
          {t('fix')}
        </Link>
      )}
    </div>
  );
}

/**
 * The composer's line while the workspace's own key fails (AGENT-OWN-KEY
 * §5.2 item 5). Sending stays on: the key may work again (credit topped up
 * at the provider), and a refused call costs nothing.
 */
export function ChatKeyNotice({ failing }: { failing: FailingKey | null | undefined }) {
  if (!failing) return null;
  return <ChatKeyLine failing={failing} />;
}

function ChatKeyLine({ failing }: { failing: FailingKey }) {
  const t = useTranslations('chatAgents.ownKey');
  const { canAdmin } = useUserRole();
  const why = useKeyWhy(failing);
  return (
    <p
      role="status"
      data-slot="chat-key-notice"
      className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden />
      <span className="min-w-0 flex-1">
        {t('composer', { why })}{' '}
        {canAdmin ? (
          <Link
            href={AI_PROVIDERS_PATH}
            data-action="chat.fixKey"
            className="font-medium underline underline-offset-2"
          >
            {t('fix')}
          </Link>
        ) : (
          t('askAdmin')
        )}
      </span>
    </p>
  );
}
