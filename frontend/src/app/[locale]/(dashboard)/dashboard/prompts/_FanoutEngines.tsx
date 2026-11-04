'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { AlertTriangle, Info } from 'lucide-react';
import { AIProviderAvatar, resolveAIProvider } from '@/components/AiProviderAvatar';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import {
  API_MODEL_PLATFORMS,
  FANOUT_MIN_SILENT_ANSWERS,
  fanoutSharing,
} from '@/config/fanoutPlatforms';
import type { FanoutEngineCoverage } from '@/lib/actions/fanout';
import { cn } from '@/lib/utils';

/**
 * The Query Fan-out page's per-engine view: which engines shared the searches
 * behind their answers, which shared none although they usually do, and
 * which never share them. Without it the page read as broken whenever the
 * list held only Copilot: ChatGPT's searches stopped arriving on 2026-09-30,
 * and Google AI Overviews, AI Mode and Gemini never send any.
 */

export function platformLabel(platform: string): string {
  const label = PLATFORM_LABELS[platform] ?? platform;
  // "ChatGPT API" beside the ChatGPT app, never two plain "ChatGPT"s.
  return API_MODEL_PLATFORMS.includes(platform) ? `${label} API` : label;
}

/** A share of answers as a whole percent; a small non-zero one isn't "0%". */
function useShare() {
  const format = useFormatter();
  return (part: number, whole: number) => {
    if (whole === 0) return '–';
    const rate = part / whole;
    if (rate > 0 && rate < 0.01) return '<1%';
    return format.number(rate, { style: 'percent', maximumFractionDigits: 0 });
  };
}

function useShortDate() {
  const format = useFormatter();
  return (iso: string) => format.dateTime(new Date(iso), { month: 'short', day: 'numeric' });
}

/** An engine that shares its searches, answered often enough to tell, and shared none. */
export function isSilentEngine(e: FanoutEngineCoverage): boolean {
  return (
    e.answers >= FANOUT_MIN_SILENT_ANSWERS &&
    e.answersWithFanout === 0 &&
    fanoutSharing(e.platform) === 'shares'
  );
}

/**
 * One chip per engine that answered in the window, after "All engines". A
 * chip filters the lists below; an engine that never shares searches has
 * nothing to filter to, so its chip is a label only.
 */
export function FanoutEngineStrip({
  engines,
  totalSubQueries,
  selected,
  onSelect,
}: {
  engines: FanoutEngineCoverage[];
  totalSubQueries: number;
  selected: string | null;
  onSelect: (platform: string | null) => void;
}) {
  const t = useTranslations('prompts.fanout');
  const format = useFormatter();
  const share = useShare();
  const shortDate = useShortDate();

  const chip =
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap';
  const on = 'border-foreground bg-foreground text-background';

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('engines')}>
      <button
        type="button"
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
        className={cn(chip, selected === null ? on : 'bg-background hover:bg-muted')}
      >
        {t('allEngines')}
        <span className={selected === null ? 'opacity-70' : 'text-muted-foreground'}>
          {format.number(totalSubQueries)}
        </span>
      </button>
      {engines.map((e) => {
        const label = platformLabel(e.platform);
        const avatar = (
          <AIProviderAvatar
            provider={resolveAIProvider(e.platform, e.platform)}
            className="h-4 w-4"
          />
        );
        if (fanoutSharing(e.platform) === 'not-shared' && e.answersWithFanout === 0) {
          return (
            <span
              key={e.platform}
              className={cn(chip, 'border-dashed bg-muted/50 text-muted-foreground')}
            >
              <span className="opacity-50">{avatar}</span>
              {label} · {t('notShared')}
            </span>
          );
        }
        const silent = isSilentEngine(e);
        const isOn = selected === e.platform;
        return (
          <button
            key={e.platform}
            type="button"
            aria-pressed={isOn}
            onClick={() => onSelect(isOn ? null : e.platform)}
            className={cn(
              chip,
              isOn
                ? on
                : silent
                  ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300'
                  : 'bg-background hover:bg-muted',
            )}
          >
            {avatar}
            {label}
            <span className={isOn ? 'opacity-70' : silent ? '' : 'text-muted-foreground'}>
              {silent
                ? e.lastFanoutAt
                  ? t('noneSince', { date: shortDate(e.lastFanoutAt) })
                  : t('noneInWindow')
                : `${t('share', { percent: share(e.answersWithFanout, e.answers) })} · ${format.number(e.subQueries)}`}
            </span>
            {silent && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Says why an engine is missing: one that usually shares its searches and
 * sent none (generic, so it clears itself once they arrive again), and the
 * engines that never share them.
 */
export function FanoutEngineNotices({ engines }: { engines: FanoutEngineCoverage[] }) {
  const t = useTranslations('prompts.fanout');
  const format = useFormatter();
  const shortDate = useShortDate();

  const silent = engines.filter(isSilentEngine);
  const notShared = engines
    .filter((e) => fanoutSharing(e.platform) === 'not-shared' && e.answersWithFanout === 0)
    .map((e) => platformLabel(e.platform));

  if (silent.length === 0 && notShared.length === 0) return null;
  return (
    <div className="space-y-2">
      {silent.map((e) => (
        <div
          key={e.platform}
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/30"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
          <p className="text-amber-900 dark:text-amber-200">
            <span className="font-medium">
              {e.lastFanoutAt
                ? t('silentTitle', {
                    engine: platformLabel(e.platform),
                    date: shortDate(e.lastFanoutAt),
                  })
                : t('silentTitleNoDate', { engine: platformLabel(e.platform) })}
            </span>{' '}
            <span className="text-amber-800/80 dark:text-amber-300/80">{t('silentBody')}</span>
          </p>
        </div>
      ))}
      {notShared.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('notSharedNote', { engines: format.list(notShared, { type: 'conjunction' }) })}
        </p>
      )}
    </div>
  );
}

/**
 * Which engines answered a prompt in the window, coloured when they shared
 * searches for it and faded when they didn't. Engines sharing one icon
 * (Google's) show once, coloured if any of them shared.
 */
export function PromptEnginesCell({
  platforms,
  fanoutPlatforms,
}: {
  platforms: string[];
  fanoutPlatforms: string[];
}) {
  const byProvider = new Map<string, { labels: string[]; shared: boolean }>();
  for (const platform of platforms) {
    const provider = resolveAIProvider(platform, platform);
    const entry = byProvider.get(provider) ?? { labels: [], shared: false };
    entry.labels.push(platformLabel(platform));
    entry.shared ||= fanoutPlatforms.includes(platform);
    byProvider.set(provider, entry);
  }
  if (byProvider.size === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-1">
      {[...byProvider.entries()]
        .sort(([, a], [, b]) => Number(b.shared) - Number(a.shared))
        .map(([provider, { labels, shared }]) => (
          <span key={provider} className={cn(!shared && 'opacity-25')} title={labels.join(', ')}>
            <AIProviderAvatar
              provider={provider as ReturnType<typeof resolveAIProvider>}
              className="h-5 w-5"
            />
          </span>
        ))}
    </div>
  );
}
