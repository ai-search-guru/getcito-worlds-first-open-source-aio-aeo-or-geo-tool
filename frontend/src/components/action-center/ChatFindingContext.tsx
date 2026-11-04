'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import { pagePath } from '@/lib/content/overlap';

const listOf = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);
const labelOf = (item: unknown): string | null => {
  if (typeof item === 'string') return item.trim() || null;
  const label = (item as { label?: unknown } | null)?.label;
  return typeof label === 'string' && label.trim() ? label.trim() : null;
};

/**
 * What a finding sent from Chat carries (CHAT-09 §E): the chat it came
 * from (Open the chat only for a reader who may open it), and what it was sent with, frozen when it was created (CHAT-20 §12
 * rule 3): its prompts, pages, competitors and platforms. The finding itself
 * is the action's description, above.
 */
export function ChatFindingContext({
  payload,
  chatHref,
}: {
  payload: Record<string, unknown>;
  /** The chat it came from, when the person reading may open it (their own, or shared). */
  chatHref: string | null;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.chatFinding');
  const entities = (payload.entities ?? {}) as Record<string, unknown>;
  const prompts = listOf(entities.prompts)
    .map(labelOf)
    .filter((x): x is string => !!x);
  const pages = listOf(entities.pages)
    .map(labelOf)
    .filter((x): x is string => !!x);
  const competitors = listOf(entities.competitors)
    .map(labelOf)
    .filter((x): x is string => !!x);
  const platforms = listOf(entities.platforms)
    .map(labelOf)
    .filter((x): x is string => !!x)
    .map((id) => PLATFORM_LABELS[id] ?? id);
  const groups = [
    { key: 'prompts', label: t('prompts', { count: prompts.length }), items: prompts },
    { key: 'pages', label: t('pages', { count: pages.length }), items: pages.map(pagePath) },
    {
      key: 'competitors',
      label: t('competitors', { count: competitors.length }),
      items: competitors,
    },
    { key: 'platforms', label: t('platforms'), items: platforms },
  ].filter((group) => group.items.length > 0);

  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{t('source')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span>{t('sourceValue')}</span>
          {chatHref && (
            <Link
              href={chatHref}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t('openChat')}
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
      {groups.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('sentWith')}</p>
          <dl className="mt-1 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
            {groups.map((group) => (
              <div key={group.key} className="contents">
                <dt className="text-muted-foreground">{group.label}</dt>
                <dd className="min-w-0">
                  {group.items.slice(0, 8).map((item, i) => (
                    <span key={`${i}-${item}`} className="block truncate" title={item}>
                      {item}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
