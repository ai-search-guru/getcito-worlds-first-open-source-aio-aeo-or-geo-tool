'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';

type ImproveState = 'not_mentioned' | 'mentioned_late' | 'not_cited' | 'doing_well' | 'no_runs';

const STATES: ImproveState[] = [
  'not_mentioned',
  'mentioned_late',
  'not_cited',
  'doing_well',
  'no_runs',
];

/**
 * What an action sent from the Prompts Improve tab is about (PROMPT-004): its
 * source, the prompt with a link back to its Positions panel, and each
 * platform's state when it was sent. Copied onto the action at send time, so
 * it still reads after the prompt's positions move.
 */
export function ImproveContext({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.improve');
  const promptText = typeof payload.promptText === 'string' ? payload.promptText : null;
  const panelLink = typeof payload.panelLink === 'string' ? payload.panelLink : null;
  const platforms = Array.isArray(payload.platforms)
    ? (payload.platforms as { id?: unknown; label?: unknown; state?: unknown }[]).filter(
        (p): p is { id: string; label: string; state: ImproveState } =>
          typeof p.id === 'string' &&
          typeof p.label === 'string' &&
          STATES.includes(p.state as ImproveState),
      )
    : [];

  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{t('source')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span>{t('sourceValue')}</span>
          {panelLink && (
            <Link
              href={panelLink}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t('openPanel')}
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
      {promptText && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('prompt')}</p>
          <p className="mt-1">{promptText}</p>
        </div>
      )}
      {platforms.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('platforms')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {platforms.map((p) => (
              <Badge key={p.id} variant="outline" className="text-[11px] font-normal">
                {p.label} · {t(`states.${p.state}`)}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
