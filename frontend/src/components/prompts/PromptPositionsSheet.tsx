'use client';

/**
 * Positions panel for one tracked prompt: per-platform mention and citation
 * results over a window and the Prompts table's location. The window opens on
 * the table's and can be changed inside the panel without touching the table.
 *
 * The 24h window shows each platform's latest answer; longer windows show
 * days — how many were tracked, mentioned and cited, with a block per day and
 * every answer's positions behind it. A day with no answer is "not tracked",
 * never "not mentioned".
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ExternalLink,
  MessageSquareText,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  createTooltipHandle,
} from '@/components/ui/tooltip';
import { AIProviderAvatar, resolveAIProvider } from '@/components/AiProviderAvatar';
import { PositionLabel } from '@/components/PositionLabel';
import { cn } from '@/lib/utils';
import { formatRegionDisplay } from '@/lib/region';
import { positionTone } from '@/lib/positionTone';
import { CONTACT_SALES_URL, type PlanId } from '@/config/plans';
import { PROMPT_RANGE_PRESETS, type PromptRangePreset } from '@/config/promptOptions';
import type { PositionsRange } from '@/lib/positionsRange';
import { DateRangeFilter } from '@/components/filters/DateRangeFilter';
import { ImproveTab, useImprove, type ImproveController } from './PromptImproveTab';
import { PromptContentStep } from './PromptContentStep';
import type { DialogPreset } from '@/components/content/NewContentDialog';
import { getPromptPositions, type PromptPositionsData } from '@/lib/actions/promptPositions';
import { viewerTimeZone } from '@/lib/timeZone';
import type {
  AnswerView,
  PlatformDay,
  PlatformPositions,
  PositionStats,
  PositionsSummary,
} from '@/lib/promptPositions';
import type { Sentiment } from '@/types';
import { actionCenterLink } from '@/lib/promptImprove';

export type { PositionsRange } from '@/lib/positionsRange';

export interface PositionsPrompt {
  id: string;
  text: string;
}

interface Props {
  /** The prompt to show; null keeps the panel closed. */
  prompt: PositionsPrompt | null;
  /** The panel's selected range; it opens on the table's. */
  range: PositionsRange;
  /** `range` resolved to the bounds the data is read over. */
  window: { from: string; to?: string };
  /** Changes the panel's range only; the table keeps its own. */
  onRangeChange: (range: PositionsRange) => void;
  /** The table's location; empty means every location. */
  region: string;
  /** The tab the panel opens on: Improve when opened from the row menu (PROMPT-006). */
  initialTab?: 'platforms' | 'improve';
  onClose: () => void;
  /** The prompt's brand, for the Improve tab's way into the Content Editor. */
  brandId?: string;
  /** Opens New content › Start for the prompt; without it the Improve tab offers no content step. */
  onStartContent?: (preset: DialogPreset) => void;
  /** Bumped when Start sent a draft (Agent or Team): the content step looks for it again. */
  contentSent?: number;
}

const DAYS_PAGE = 10;
const HISTORY_PAGE = 7;

// Days arrive as YYYY-MM-DD already in the viewer's time zone, so they are
// printed as plain calendar dates (read at UTC midnight, never shifted).
const DAY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const SHORT_DAY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});
// Answer times are instants, shown on the viewer's clock with its zone.
const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

const formatDay = (day: string) => DAY_FMT.format(new Date(`${day}T00:00:00Z`));
const formatTime = (iso: string) => TIME_FMT.format(new Date(iso));
const formatDateTime = (iso: string) =>
  `${DATE_FMT.format(new Date(iso))}, ${TIME_FMT.format(new Date(iso))}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—');

// The resolved dates follow in the caption, so a custom range isn't spelled out twice.
function windowTitle(preset: PromptRangePreset): string {
  return preset === 'custom' ? 'Custom range' : `Last ${preset}`;
}

export function PromptPositionsSheet({
  prompt,
  range,
  window,
  onRangeChange,
  region,
  initialTab = 'platforms',
  onClose,
  brandId,
  onStartContent,
  contentSent = 0,
}: Props) {
  const preset = range.preset;
  // A range change asked for while the Improve tab has unsent edits waits here
  // until the user confirms discarding them.
  const [pendingRange, setPendingRange] = useState<PositionsRange | null>(null);
  // Everything the data depends on. A response is shown only while its key
  // still matches, so another prompt's (or window's) numbers never linger.
  const key = prompt ? `${prompt.id}|${window.from}|${window.to ?? ''}|${region}` : '';
  const [loaded, setLoaded] = useState<{
    key: string;
    data: PromptPositionsData | null;
    error: string | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!prompt) return;
    let cancelled = false;
    getPromptPositions(prompt.id, {
      from: window.from,
      to: window.to,
      region: region || undefined,
      timeZone: viewerTimeZone(),
    })
      .then((data) => {
        if (cancelled) return;
        setLoaded({ key, data, error: data ? null : 'This prompt is no longer available.' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({
          key,
          data: null,
          error: err instanceof Error ? err.message : 'Failed to load positions.',
        });
      });
    return () => {
      cancelled = true;
    };
    // `key` covers prompt, window and region; `attempt` re-runs a failed load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const current = loaded?.key === key && key !== '' ? loaded : null;
  const data = current?.data ?? null;
  const latestMode = preset === '24h';
  const contentStepFor = (loaded: PromptPositionsData) =>
    brandId && onStartContent ? (
      <PromptContentStep
        brandId={brandId}
        prompt={loaded.prompt}
        summary={loaded.summary}
        citedPage={loaded.citedPage}
        onStart={onStartContent}
        recheck={contentSent}
      />
    ) : null;

  const improve = useImprove({
    promptId: prompt?.id ?? null,
    range: {
      preset,
      from: window.from,
      to: window.to,
      customFrom: preset === 'custom' ? range.from : undefined,
      customTo: preset === 'custom' ? range.to : undefined,
      region,
    },
    planId: data?.planId ?? null,
  });
  const changeRange = (next: PositionsRange) => {
    if (improve.dirty) setPendingRange(next);
    else onRangeChange(next);
  };

  const retry = () => {
    setLoaded(null);
    setAttempt((n) => n + 1);
  };

  return (
    <Sheet open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="gap-2 border-b px-5 py-4 pr-12">
          <SheetTitle className="text-base leading-snug break-words">{prompt?.text}</SheetTitle>
          {data && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[11px]">
                {data.prompt.isActive ? 'Tracked prompt' : 'Paused'}
              </Badge>
              {data.prompt.topicName && (
                <Badge variant="outline" className="text-[11px] text-muted-foreground">
                  {data.prompt.topicName}
                </Badge>
              )}
              {data.improving && (
                // An Improve action sent for this prompt is still being
                // tracked (PROMPT-008): the delta is the mean position over
                // its platforms, 7 days before it was sent → the last 7 days.
                <Link
                  href={actionCenterLink(data.improving.actionId)}
                  title="Open the action and its Outcome"
                  className="inline-flex h-5 items-center gap-1 rounded-4xl border border-primary/30 bg-primary/5 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <TrendingUp className="h-3 w-3" />
                  Improving · AC-{data.improving.actionNo}
                  {data.improving.avgBefore !== null && data.improving.avgAfter !== null && (
                    <span className="tabular-nums">
                      {' '}
                      · #{data.improving.avgBefore.toFixed(1)} → #
                      {data.improving.avgAfter.toFixed(1)}
                    </span>
                  )}
                </Link>
              )}
            </div>
          )}
          <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">{windowTitle(preset)}</span>
            {data && latestMode && (
              <span>
                Last run:{' '}
                {data.summary.lastAnswerAt ? formatDateTime(data.summary.lastAnswerAt) : '—'}
              </span>
            )}
            {data && !latestMode && data.summary.days.length > 0 && (
              <span>
                {SHORT_DAY_FMT.format(new Date(`${data.summary.days[0]}T00:00:00Z`))} –{' '}
                {formatDay(data.summary.days[data.summary.days.length - 1])}
              </span>
            )}
            {region && <span>· {formatRegionDisplay(region)}</span>}
            {data && !latestMode && (
              <Badge variant="secondary" className="text-[11px]">
                {plural(data.summary.runs, 'run')}
              </Badge>
            )}
          </SheetDescription>
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <DateRangeFilter
              label="Period"
              value={preset}
              presets={PROMPT_RANGE_PRESETS}
              onChange={(next) => changeRange({ ...range, preset: next })}
              from={range.from}
              to={range.to}
              onFromChange={(from) => changeRange({ ...range, from })}
              onToChange={(to) => changeRange({ ...range, to })}
            />
          </div>
          {pendingRange && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
              <span className="text-amber-900 dark:text-amber-200">
                Changing the period discards your unsent Improve edits.
              </span>
              <Button size="xs" variant="outline" onClick={() => setPendingRange(null)}>
                Keep editing
              </Button>
              <Button
                size="xs"
                onClick={() => {
                  onRangeChange(pendingRange);
                  setPendingRange(null);
                }}
              >
                Discard & change
              </Button>
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {prompt && !current && <PositionsSkeleton />}
          {current?.error && <LoadError message={current.error} onRetry={retry} />}
          {data &&
            (latestMode ? (
              <LatestView
                data={data}
                improve={improve}
                initialTab={initialTab}
                content={contentStepFor(data)}
              />
            ) : (
              <PeriodView
                data={data}
                improve={improve}
                initialTab={initialTab}
                content={contentStepFor(data)}
              />
            ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
          {prompt ? (
            <Link
              href={`/dashboard/prompts/${prompt.id}`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <MessageSquareText />
              AI answers
            </Link>
          ) : (
            <span />
          )}
          <SheetClose render={<Button variant="outline" size="sm" />}>Back to prompts</SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── States ───────────────────────────────────────────────────────────────────

function PositionsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading positions">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px] w-full" />
        ))}
      </div>
      <Skeleton className="h-8 w-60" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Couldn&apos;t load positions: {message}</span>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw />
        Retry
      </Button>
    </div>
  );
}

// ─── Shared pieces ────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
  detail,
}: {
  label: string;
  value: string;
  sub?: string;
  /** The answer-level count beside the card's days or platforms (the table's numbers). */
  detail?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold leading-tight tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      {detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

/**
 * The answers behind a card, as the Prompts table counts them: its Runs,
 * Mentions and Citations columns sum answers, not days or platforms. The 24h
 * cards count platforms, so their lines say they cover the whole period.
 * Locked platforms' answers are never read here, so where the plan locks one
 * the counts say they cover the included platforms only.
 */
function useAnswerDetails(data: PromptPositionsData, { latest }: { latest: boolean }) {
  const t = useTranslations('prompts.positions');
  const s: PositionsSummary = data.summary;
  return {
    mentioned: t(latest ? 'mentionedInPeriod' : 'mentionedIn', {
      mentioned: s.mentionedAnswers,
      answers: s.answers,
      mentions: s.mentions,
    }),
    cited: t(latest ? 'citedInPeriod' : 'citedIn', {
      cited: s.citedAnswers,
      answers: s.answers,
      citations: s.citations,
    }),
    answers: t(latest ? 'answersInPeriod' : 'answers', { count: s.answers }),
    includedOnly: data.platforms.some((p) => p.access.state === 'locked')
      ? t('includedOnly')
      : null,
  };
}

/** Says the answer counts leave out the platforms the plan locks. */
function IncludedOnlyNote({ note }: { note: string | null }) {
  return note ? <p className="text-xs text-muted-foreground">{note}</p> : null;
}

function PlatformName({ platform }: { platform: { id: string; label: string } }) {
  return (
    <span className="flex min-w-0 items-center gap-2 sm:w-44">
      <AIProviderAvatar plain provider={resolveAIProvider('', platform.id)} className="h-6 w-6" />
      <span className="truncate text-sm font-medium">{platform.label}</span>
    </span>
  );
}

const SENTIMENT_CLASS: Record<Sentiment, string> = {
  positive: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  neutral: '',
  negative: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

function SentimentTag({ sentiment }: { sentiment: Sentiment | null }) {
  if (!sentiment) return <span className="text-muted-foreground">Sentiment unavailable</span>;
  return (
    <Badge
      variant="outline"
      className={cn('h-4 px-1.5 text-[10px] font-medium capitalize', SENTIMENT_CLASS[sentiment])}
    >
      {sentiment}
    </Badge>
  );
}

function MentionStatus({ answer }: { answer: AnswerView }) {
  if (!answer.mentioned) return <span className="text-muted-foreground">Not mentioned</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="font-medium">Mentioned</span>
      {answer.mention ? (
        <PositionLabel rank={answer.mention.position} total={answer.mention.total} />
      ) : (
        <span className="text-muted-foreground">Position unavailable</span>
      )}
      <SentimentTag sentiment={answer.sentiment} />
    </span>
  );
}

function CitationStatus({ answer }: { answer: AnswerView }) {
  if (!answer.cited) return <span className="text-muted-foreground">Not cited</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="font-medium">Cited</span>
      {answer.citation ? (
        <PositionLabel rank={answer.citation.rank} total={answer.citation.total} />
      ) : (
        <span className="text-muted-foreground">Position unavailable</span>
      )}
    </span>
  );
}

/** One answer: its mention and its citation side by side. */
function AnswerLine({ answer, showTime }: { answer: AnswerView; showTime: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-[6rem_1fr_1fr] sm:gap-3">
      {showTime ? (
        <span className="tabular-nums text-muted-foreground">
          {/* The time keeps its zone on one line ("16:28 GMT+5:30"). */}
          <span className="block whitespace-nowrap">{formatTime(answer.at)}</span>
          {answer.region && <span className="block">{formatRegionDisplay(answer.region)}</span>}
        </span>
      ) : (
        <span className="hidden sm:block" />
      )}
      <MentionStatus answer={answer} />
      <CitationStatus answer={answer} />
    </div>
  );
}

function LockedRow({ platform, planId }: { platform: PlatformPositions; planId: PlanId }) {
  if (platform.access.state !== 'locked') return null;
  const growth = platform.access.requiredPlan === 'growth';
  const note = growth
    ? 'Available on Growth'
    : planId === 'enterprise'
      ? 'Not enabled for this workspace'
      : 'Available on Enterprise';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <AIProviderAvatar plain provider={resolveAIProvider('', platform.id)} className="h-6 w-6" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{platform.label}</p>
          <p className="text-xs text-muted-foreground">
            {note} · {growth ? 'Upgrade' : 'Contact us'} to track {platform.label} results and
            positions.
          </p>
        </div>
      </div>
      {growth ? (
        <Link
          href="/dashboard/settings?tab=billing"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Upgrade
        </Link>
      ) : (
        <a
          href={CONTACT_SALES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Contact us
          <ExternalLink />
        </a>
      )}
    </div>
  );
}

function avgLabel(stats: PositionStats | null): string {
  return stats ? `#${stats.avg}` : '—';
}

// ─── 24h: each platform's latest answer ───────────────────────────────────────

function ImproveTrigger({ improve }: { improve: ImproveController }) {
  return (
    <TabsTrigger value="improve">
      Improve
      {improve.count !== null && improve.count > 0 && (
        <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
          {improve.count}
        </Badge>
      )}
    </TabsTrigger>
  );
}

function LatestView({
  data,
  improve,
  initialTab,
  content,
}: {
  data: PromptPositionsData;
  improve: ImproveController;
  /** The Improve tab's content step, first in the tab. */
  content: React.ReactNode;
  initialTab: 'platforms' | 'improve';
}) {
  const included = data.platforms.filter((p) => p.access.state === 'included');
  const answered = included.filter((p) => p.latest);
  const mentioned = answered.filter((p) => p.latest!.mentioned).length;
  const cited = answered.filter((p) => p.latest!.cited).length;
  const latestPositions = answered.flatMap((p) =>
    p.latest!.mention ? [p.latest!.mention.position] : [],
  );
  const avg =
    latestPositions.length > 0
      ? `#${Math.round((latestPositions.reduce((a, b) => a + b, 0) / latestPositions.length) * 10) / 10}`
      : '—';
  const details = useAnswerDetails(data, { latest: true });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Platforms answered"
          value={`${answered.length} / ${included.length}`}
          sub="in their latest run"
          detail={details.answers}
        />
        <Stat
          label="Mentioned on"
          value={`${mentioned} / ${answered.length}`}
          sub="platforms"
          detail={details.mentioned}
        />
        <Stat
          label="Cited on"
          value={`${cited} / ${answered.length}`}
          sub="platforms"
          detail={details.cited}
        />
        <Stat label="Avg. position" value={avg} sub="when mentioned" />
      </div>
      <IncludedOnlyNote note={details.includedOnly} />

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="platforms">Platform results</TabsTrigger>
          <ImproveTrigger improve={improve} />
        </TabsList>
        <TabsContent value="platforms" className="mt-3">
          <div className="divide-y rounded-lg border">
            {data.platforms.map((p) =>
              p.access.state === 'locked' ? (
                <LockedRow key={p.id} platform={p} planId={data.planId} />
              ) : (
                <LatestRow key={p.id} platform={p} />
              ),
            )}
          </div>
        </TabsContent>
        <TabsContent value="improve" className="mt-3 space-y-3">
          {content}
          <ImproveTab improve={improve} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * A platform's latest answer: its mention on the left and its citation on
 * the right, under the platform's name.
 */
function LatestRow({ platform: p }: { platform: PlatformPositions }) {
  return (
    <div data-platform={p.id} className="px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PlatformName platform={p} />
        {p.latest && (
          <span className="text-xs text-muted-foreground">
            Run at {formatDateTime(p.latest.at)}
          </span>
        )}
      </div>
      {!p.latest ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No completed tracking runs in this period
        </p>
      ) : (
        <dl className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Mention
            </dt>
            <dd className="mt-1 space-y-1">
              <MentionStatus answer={p.latest} />
              {p.mentionedEarlier && (
                <p className="text-muted-foreground">Detected earlier in this period</p>
              )}
            </dd>
          </div>
          <div className="sm:text-right">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Citation
            </dt>
            <dd className="mt-1 space-y-1">
              <CitationStatus answer={p.latest} />
              {p.citedEarlier && (
                <p className="text-muted-foreground">Detected earlier in this period</p>
              )}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

// ─── 7d / 30d / 90d / custom: days ────────────────────────────────────────────

function PeriodView({
  data,
  improve,
  initialTab,
  content,
}: {
  data: PromptPositionsData;
  improve: ImproveController;
  /** The Improve tab's content step, first in the tab. */
  content: React.ReactNode;
  initialTab: 'platforms' | 'improve';
}) {
  const s = data.summary;
  const details = useAnswerDetails(data, { latest: false });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Runs"
          value={String(s.runs)}
          sub={`${s.trackedDays} of ${plural(s.days.length, 'day')} tracked`}
          detail={details.answers}
        />
        <Stat
          label="Mentioned"
          value={`${s.mentionedDays} / ${plural(s.trackedDays, 'day')}`}
          sub={`${s.trackedDays - s.mentionedDays} not mentioned`}
          detail={details.mentioned}
        />
        <Stat
          label="Cited"
          value={`${s.citedDays} / ${plural(s.trackedDays, 'day')}`}
          sub={`${s.trackedDays - s.citedDays} not cited`}
          detail={details.cited}
        />
        <Stat
          label="Avg. position"
          value={avgLabel(s.mentionPosition)}
          sub={
            s.citationPosition
              ? `when mentioned · ${avgLabel(s.citationPosition)} in sources`
              : 'when mentioned'
          }
        />
      </div>
      <IncludedOnlyNote note={details.includedOnly} />
      {s.untrackedDays > 0 && (
        <p className="text-xs text-muted-foreground">
          {plural(s.untrackedDays, 'day')} without a completed run. Untracked days don&apos;t count
          as not mentioned or not cited.
        </p>
      )}

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="platforms">Platform results</TabsTrigger>
          <TabsTrigger value="history">Daily history ({s.trackedDays})</TabsTrigger>
          <ImproveTrigger improve={improve} />
        </TabsList>
        <TabsContent value="platforms" className="mt-3 space-y-3">
          <HeatmapLegend />
          <div className="divide-y rounded-lg border">
            {data.platforms.map((p) =>
              p.access.state === 'locked' ? (
                <LockedRow key={p.id} platform={p} planId={data.planId} />
              ) : (
                <PlatformPeriodRow key={p.id} platform={p} days={s.days} />
              ),
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Each block is one day in the selected range, in your time zone. Hover a block for that
            day&apos;s positions; open a platform for every run.
          </p>
        </TabsContent>
        <TabsContent value="history" className="mt-3">
          <DailyHistory platforms={data.platforms} />
        </TabsContent>
        <TabsContent value="improve" className="mt-3 space-y-3">
          {content}
          <ImproveTab improve={improve} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type CellTone = 'untracked' | 'none' | 'Early' | 'Mid' | 'Late' | 'mentioned' | 'cited';

const CELL_CLASS: Record<CellTone, string> = {
  untracked: 'border border-dashed border-muted-foreground/40',
  none: 'bg-muted-foreground/15',
  Early: 'bg-emerald-500',
  Mid: 'bg-emerald-300 dark:bg-emerald-700',
  Late: 'bg-amber-400',
  mentioned: 'bg-emerald-400',
  cited: 'bg-sky-400',
};

const LEGEND: { tone: CellTone; label: string }[] = [
  { tone: 'Early', label: 'Mentioned early' },
  { tone: 'Mid', label: 'Mid' },
  { tone: 'Late', label: 'Late' },
  { tone: 'cited', label: 'Cited only' },
  { tone: 'none', label: 'No result' },
  { tone: 'untracked', label: 'Not tracked' },
];

function HeatmapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {LEGEND.map(({ tone, label }) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <span className={cn('h-2.5 w-2.5 rounded-[3px]', CELL_CLASS[tone])} />
          {label}
        </span>
      ))}
    </div>
  );
}

/** The day's best mention and best citation, by rank. */
function bestOf(answers: AnswerView[]) {
  const mention = answers
    .filter((a) => a.mention)
    .sort((a, b) => a.mention!.position - b.mention!.position)[0]?.mention;
  const citation = answers
    .filter((a) => a.citation)
    .sort((a, b) => a.citation!.rank - b.citation!.rank)[0]?.citation;
  return { mention, citation };
}

function cellTone(entry: PlatformDay | undefined): CellTone {
  if (!entry) return 'untracked';
  const { mention } = bestOf(entry.answers);
  if (mention) return mention.total ? positionTone(mention.position, mention.total) : 'mentioned';
  if (entry.answers.some((a) => a.mentioned)) return 'mentioned';
  if (entry.answers.some((a) => a.cited)) return 'cited';
  return 'none';
}

function dayTooltip(day: string, entry: PlatformDay | undefined): string {
  if (!entry) return `${formatDay(day)}\nNot tracked`;
  const runs = entry.answers.length;
  const mentioned = entry.answers.filter((a) => a.mentioned).length;
  const cited = entry.answers.filter((a) => a.cited).length;
  const { mention, citation } = bestOf(entry.answers);
  const share = (n: number) => (runs > 1 ? ` in ${n} of ${runs} runs` : '');
  const mentionLine = mentioned
    ? `Mentioned${share(mentioned)}${
        mention
          ? ` · ${mention.total ? `${positionTone(mention.position, mention.total)} · ` : ''}#${mention.position}${mention.total ? ` of ${mention.total}` : ''}`
          : ''
      }`
    : 'Not mentioned';
  const citationLine = cited
    ? `Cited${share(cited)}${
        citation
          ? ` · ${positionTone(citation.rank, citation.total)} · #${citation.rank} of ${citation.total}`
          : ''
      }`
    : 'Not cited';
  return `${formatDay(day)} · ${plural(runs, 'run')}\n${mentionLine}\n${citationLine}`;
}

function Heatmap({ platform, days }: { platform: PlatformPositions; days: string[] }) {
  const byDay = useMemo(() => new Map(platform.days.map((d) => [d.day, d])), [platform.days]);
  // One tooltip for the row, showing whichever block is hovered: up to 90
  // blocks a row would otherwise mean as many tooltips. It opens at once and
  // follows the pointer from block to block. The blocks stay out of the tab
  // order (a row of 90 stops); the platform's day list says the same.
  const tooltip = useMemo(() => createTooltipHandle<string>(), []);
  return (
    <div
      role="img"
      aria-label={`${platform.label}: mentioned on ${platform.mentionedDays} and cited on ${platform.citedDays} of ${plural(platform.trackedDays, 'tracked day')}`}
      className="mt-2 flex flex-wrap gap-[3px]"
    >
      {days.map((day) => {
        const entry = byDay.get(day);
        return (
          <TooltipTrigger
            key={day}
            handle={tooltip}
            payload={dayTooltip(day, entry)}
            delay={0}
            closeDelay={0}
            render={
              <span
                data-day={day}
                className={cn('h-3 w-3 rounded-[3px]', CELL_CLASS[cellTone(entry)])}
              />
            }
          />
        );
      })}
      <Tooltip handle={tooltip}>
        {({ payload }) => (
          <TooltipContent className="whitespace-pre-line">{payload}</TooltipContent>
        )}
      </Tooltip>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] text-muted-foreground">{sub}</span>
    </span>
  );
}

function PositionTrio({ stats }: { stats: PositionStats | null }) {
  const cells: [string, string, string][] = stats
    ? [
        ['Best', `#${stats.best}`, 'text-emerald-600 dark:text-emerald-400'],
        ['Worst', `#${stats.worst}`, 'text-amber-600 dark:text-amber-400'],
        ['Avg.', `#${stats.avg}`, ''],
      ]
    : [];
  if (cells.length === 0) {
    return <span className="text-[11px] text-muted-foreground">No mention position</span>;
  }
  return (
    <span className="flex gap-3" title="Position when mentioned">
      {cells.map(([label, value, cls]) => (
        <span key={label} className="flex flex-col items-center">
          <span className={cn('text-sm font-semibold tabular-nums', cls)}>{value}</span>
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </span>
      ))}
    </span>
  );
}

function runsNote(d: PlatformDay): string {
  const runs = d.answers.length;
  if (runs === 1) return '1 run';
  const mentioned = d.answers.filter((a) => a.mentioned).length;
  const cited = d.answers.filter((a) => a.cited).length;
  return `${runs} runs · mentioned in ${mentioned} · cited in ${cited}`;
}

function PlatformPeriodRow({ platform: p, days }: { platform: PlatformPositions; days: string[] }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(DAYS_PAGE);

  if (p.runs === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-3">
        <PlatformName platform={p} />
        <span className="text-xs text-muted-foreground">No tracking data for this period</span>
      </div>
    );
  }

  const s = p.sentiment;
  return (
    <div className="px-3 py-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} daily ${p.label} results`}
        className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <PlatformName platform={p} />
        <Metric
          label="Mentioned"
          value={`${p.mentionedDays} / ${p.trackedDays}`}
          sub={pct(p.mentionedDays, p.trackedDays)}
        />
        <Metric
          label="Cited"
          value={`${p.citedDays} / ${p.trackedDays}`}
          sub={pct(p.citedDays, p.trackedDays)}
        />
        <PositionTrio stats={p.mentionPosition} />
        <ChevronDown
          className={cn(
            'ml-auto h-4 w-4 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      <Heatmap platform={p} days={days} />

      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {plural(p.runs, 'run')} on {plural(p.trackedDays, 'day')}
            {s.positive + s.neutral + s.negative + s.unavailable > 0 &&
              ` · sentiment in mentioning answers: ${s.positive} positive, ${s.neutral} neutral, ${s.negative} negative${
                s.unavailable ? `, ${s.unavailable} unavailable` : ''
              }`}
          </p>
          <ul className="space-y-2">
            {p.days.slice(0, shown).map((d) => (
              <li key={d.day} className="rounded-md bg-muted/40 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium">{formatDay(d.day)}</span>
                  <span className="text-muted-foreground">{runsNote(d)}</span>
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {d.answers.map((a, i) => (
                    <AnswerLine key={`${a.at}-${i}`} answer={a} showTime={d.answers.length > 1} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {p.days.length > shown && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShown((n) => n + DAYS_PAGE)}
            >
              Show {Math.min(DAYS_PAGE, p.days.length - shown)} more days
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function DailyHistory({ platforms }: { platforms: PlatformPositions[] }) {
  const [shown, setShown] = useState(HISTORY_PAGE);
  const days = useMemo(() => {
    const byDay = new Map<string, { platform: PlatformPositions; answers: AnswerView[] }[]>();
    for (const p of platforms) {
      for (const d of p.days) {
        byDay.set(d.day, [...(byDay.get(d.day) ?? []), { platform: p, answers: d.answers }]);
      }
    }
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [platforms]);

  if (days.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No completed tracking runs in this period.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {days.slice(0, shown).map(([day, entries]) => (
        <div key={day} className="rounded-lg border">
          <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
            <span className="font-medium">{formatDay(day)}</span>
            <span className="text-muted-foreground">
              {plural(entries.length, 'platform')} answered
            </span>
          </div>
          <div className="divide-y">
            {entries.map(({ platform, answers }) => (
              <div key={platform.id} className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row">
                <PlatformName platform={platform} />
                <div className="flex-1 space-y-1.5">
                  {answers.map((a, i) => (
                    <AnswerLine key={`${a.at}-${i}`} answer={a} showTime={answers.length > 1} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {days.length > shown && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShown((n) => n + HISTORY_PAGE)}
        >
          Show {Math.min(HISTORY_PAGE, days.length - shown)} more days
        </Button>
      )}
    </div>
  );
}
