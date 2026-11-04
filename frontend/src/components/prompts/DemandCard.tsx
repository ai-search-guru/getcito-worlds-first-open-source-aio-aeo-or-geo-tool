'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plug } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import KpiSparkline from '@/components/action-center/KpiSparkline';
import { useIntegrationConnect } from '@/hooks/useIntegrationConnect';
import { trackDemandQuestion } from '@/lib/actions/promptDemandSignals';
import { isNoTopics } from '@/lib/topicsRequired';
import { useTopicFirstDialog } from '@/components/prompts/TopicFirst';
import { formatCompactNumber, formatDate, formatNumber } from '@/lib/format';
import {
  DEMAND_SIGNALS,
  formatChange,
  gscSignalState,
  paidSignalState,
  type PaidDemandSignal,
  type PromptDemand,
} from '@/lib/promptDemand';
import { INTEGRATIONS_SETTINGS_PATH, type GoogleSourceStatus } from '@/lib/trafficSources';
import { cn } from '@/lib/utils';

const bold = (chunks: ReactNode) => <strong className="font-semibold">{chunks}</strong>;

/**
 * "Measured": the demand level and its signals are read from real searches,
 * so they never carry the Estimate badge (PROMPT-013's rule).
 */
export function MeasuredBadge({ className }: { className?: string }) {
  const t = useTranslations('promptDemand');
  return (
    <span
      title={t('measuredTitle')}
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 text-[11px] font-medium leading-5 text-muted-foreground',
        className,
      )}
    >
      {t('measured')}
    </span>
  );
}

/** The KPI row's value: "High", measured. */
export function DemandLevelValue({ demand }: { demand: PromptDemand }) {
  const t = useTranslations('promptDemand');
  if (!demand.level) return null;
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{t(`level.${demand.level}`)}</span>
      <MeasuredBadge />
    </span>
  );
}

/** One of the four cards: title, what it covers, the data or its state, and its source and date. */
function SignalCard({
  title,
  window,
  footer,
  children,
}: {
  title: string;
  window: string;
  footer?: string | null;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex h-full flex-col gap-2 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <h3 className="text-sm font-medium">{title}</h3>
          <span className="text-xs text-muted-foreground">{window}</span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 text-sm">{children}</div>
        {footer && <p className="text-[11px] text-muted-foreground">{footer}</p>}
      </CardContent>
    </Card>
  );
}

function StateText({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** Why a Trends, People Also Ask or YouTube card has no data. */
function PaidState({ demand, signal }: { demand: PromptDemand; signal: PaidDemandSignal }) {
  const t = useTranslations('promptDemand.paid');
  const state = paidSignalState(demand, signal);
  if (state === 'data') return null;
  if (state === 'noVolume') {
    return (
      <>
        <StateText>{t('noVolume')}</StateText>
        <Link
          href="/dashboard/prompts/insights"
          className="text-xs font-medium text-foreground underline underline-offset-2"
        >
          {t('noVolumeLink')}
        </Link>
      </>
    );
  }
  return (
    <StateText>
      {state === 'pending' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
      {t(state)}
    </StateText>
  );
}

function GscCard({
  demand,
  gscStatus,
  canManage,
  onConnected,
}: {
  demand: PromptDemand;
  gscStatus: GoogleSourceStatus | null;
  canManage: boolean;
  onConnected: () => void;
}) {
  const t = useTranslations('promptDemand');
  const { connecting, connect } = useIntegrationConnect('google-search-console', {
    label: t('gsc.title'),
    callbackUrl: () => window.location.href,
    onStatus: (status) => {
      if (status === 'connected') onConnected();
    },
  });
  const state = gscSignalState(demand, gscStatus);
  const gsc = demand.gsc;

  let body: ReactNode;
  if (state === 'data' && gsc) {
    body = (
      <>
        <p>
          {t.rich('gsc.totals', {
            impressions: formatNumber(gsc.impressions),
            clicks: formatNumber(gsc.clicks),
            b: bold,
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {gsc.queries > 0 && gsc.top
            ? t('gsc.queries', { count: gsc.queries, query: gsc.top.query })
            : t('gsc.noQueries')}
        </p>
      </>
    );
  } else if (state === 'not_connected') {
    body = (
      <>
        <p className="flex items-center gap-2 text-sm font-medium">
          <Plug className="h-3.5 w-3.5 text-muted-foreground" />
          {t('gsc.notConnected')}
        </p>
        <StateText>{t('gsc.notConnectedBody')}</StateText>
        {canManage ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-fit gap-1.5 text-xs"
            onClick={() => void connect()}
            disabled={connecting}
          >
            {connecting && <Loader2 className="h-3 w-3 animate-spin" />}
            {t('gsc.connect')}
          </Button>
        ) : (
          <StateText>{t('gsc.connectNotAllowed')}</StateText>
        )}
      </>
    );
  } else if (state === 'unmapped') {
    body = (
      <>
        <p className="text-sm font-medium">{t('gsc.unmapped')}</p>
        <Link
          href={INTEGRATIONS_SETTINGS_PATH}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 w-fit text-xs')}
        >
          {t('gsc.manage')}
        </Link>
      </>
    );
  } else {
    body = (
      <StateText>
        {state === 'syncing'
          ? t('gsc.syncing')
          : state === 'not_configured'
            ? t('gsc.notConfigured')
            : t('gsc.notRead')}
      </StateText>
    );
  }

  return (
    <SignalCard
      title={t('gsc.title')}
      window={t('gsc.window')}
      footer={gsc ? t('readOn', { source: t('gsc.source'), date: formatDate(gsc.at) }) : null}
    >
      {body}
    </SignalCard>
  );
}

const TREND_TONE = {
  rising: 'text-emerald-600 dark:text-emerald-400',
  steady: 'text-foreground',
  falling: 'text-red-600 dark:text-red-400',
} as const;

function TrendsCard({ demand }: { demand: PromptDemand }) {
  const t = useTranslations('promptDemand');
  const trends = demand.trends;
  return (
    <SignalCard
      title={t('trends.title')}
      window={t('trends.window')}
      footer={
        trends ? t('readOn', { source: t('trends.source'), date: formatDate(trends.at) }) : null
      }
    >
      {trends ? (
        trends.trend ? (
          <>
            <div className={cn('w-fit', TREND_TONE[trends.trend])}>
              <KpiSparkline
                points={trends.points.map((value, i) => ({ date: String(i), value }))}
              />
            </div>
            <p>
              {trends.change !== null
                ? t.rich('trends.change', {
                    trend: t(`trends.${trends.trend}`),
                    change: formatChange(trends.change),
                    b: bold,
                  })
                : trends.trend === 'rising'
                  ? t.rich('trends.risingFromNone', { b: bold })
                  : // No change to give (no interest at either end): the direction alone.
                    t.rich('trends.label', { trend: t(`trends.${trends.trend}`), b: bold })}
            </p>
          </>
        ) : (
          <StateText>{t('trends.noData')}</StateText>
        )
      ) : (
        <PaidState demand={demand} signal="trends" />
      )}
    </SignalCard>
  );
}

function PaaCard({
  demand,
  brandId,
  topic,
  canManage,
}: {
  demand: PromptDemand;
  brandId: string;
  topic: string;
  canManage: boolean;
}) {
  const t = useTranslations('promptDemand');
  const [tracking, setTracking] = useState<string | null>(null);
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  // A brand with no topic yet: Track asks for one first.
  const topicFirst = useTopicFirstDialog();
  const paa = demand.paa;

  const track = async (question: string) => {
    setTracking(question);
    const outcome = await trackDemandQuestion(brandId, question, topic).catch((err: Error) => ({
      promptIds: [] as string[],
      error: err.message,
      code: undefined,
      alreadyTracked: false,
    }));
    setTracking(null);
    if (outcome.promptIds.length > 0 || outcome.alreadyTracked) {
      setTracked((prev) => new Set(prev).add(question));
      toast.success(
        t(outcome.alreadyTracked ? 'paa.alreadyTrackedToast' : 'paa.trackedToast', { question }),
      );
      return;
    }
    if (isNoTopics(outcome)) {
      topicFirst.show();
      return;
    }
    toast.error(
      outcome.code === 'plan_limit' ? t('paa.planLimit') : outcome.error || t('paa.trackFailed'),
    );
  };

  return (
    <SignalCard
      title={t('paa.title')}
      window={t('paa.window')}
      footer={paa ? t('readOn', { source: t('paa.source'), date: formatDate(paa.at) }) : null}
    >
      {paa ? (
        paa.questions.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {paa.questions.map(({ question, tracked: trackedBefore }) => {
              const done = trackedBefore === true || tracked.has(question);
              return (
                <li key={question} className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words text-sm">{question}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 px-2 text-xs"
                    disabled={!canManage || done || tracking !== null}
                    title={canManage ? undefined : t('paa.trackNotAllowed')}
                    aria-label={
                      done ? t('paa.trackedLabel', { question }) : t('paa.trackLabel', { question })
                    }
                    onClick={() => void track(question)}
                  >
                    {tracking === question
                      ? t('paa.tracking')
                      : done
                        ? t('paa.tracked')
                        : t('paa.track')}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <StateText>{t('paa.none')}</StateText>
        )
      ) : (
        <PaidState demand={demand} signal="paa" />
      )}
      {topicFirst.dialog}
    </SignalCard>
  );
}

function YoutubeCard({ demand }: { demand: PromptDemand }) {
  const t = useTranslations('promptDemand');
  const youtube = demand.youtube;
  // The provider's link, only when it's a web page (the server keeps no other).
  const topUrl =
    youtube?.top?.url && /^https?:\/\//i.test(youtube.top.url) ? youtube.top.url : null;
  return (
    <SignalCard
      title={t('youtube.title')}
      window={t('youtube.window')}
      footer={
        youtube ? t('readOn', { source: t('youtube.source'), date: formatDate(youtube.at) }) : null
      }
    >
      {youtube ? (
        youtube.videos > 0 ? (
          <>
            <p>
              {t.rich('youtube.totals', {
                views: formatCompactNumber(youtube.views),
                videos: youtube.videos,
                b: bold,
              })}
            </p>
            {youtube.top && (
              <p className="break-words text-xs text-muted-foreground">
                {topUrl ? (
                  <a
                    href={topUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground hover:underline"
                  >
                    {t('youtube.top', {
                      title: youtube.top.title,
                      views: formatCompactNumber(youtube.top.views),
                    })}
                  </a>
                ) : (
                  t('youtube.top', {
                    title: youtube.top.title,
                    views: formatCompactNumber(youtube.top.views),
                  })
                )}
              </p>
            )}
            {youtube.results !== null && (
              <p className="text-xs text-muted-foreground">
                {t('youtube.results', { count: formatNumber(youtube.results) })}
              </p>
            )}
          </>
        ) : (
          <StateText>{t('youtube.none')}</StateText>
        )
      ) : (
        <PaidState demand={demand} signal="youtube" />
      )}
    </SignalCard>
  );
}

/**
 * "Demand · is this asked for real?" (PROMPT-014, mockup screen 2): the
 * prompt's four demand signals in a 2×2 grid, each with its source and the
 * day it was read, or what to do to get it, and what the level does to the
 * prompt's Priority Score. A People Also Ask question is tracked in one click.
 */
export function DemandSection({
  demand,
  failed,
  gscStatus,
  brandId,
  topic,
  canManage,
  onGscConnected,
}: {
  /** Null while it loads. */
  demand: PromptDemand | null;
  failed: boolean;
  /** The brand's Search Console state; null while it loads or when it couldn't be read. */
  gscStatus: GoogleSourceStatus | null;
  brandId: string;
  /** The prompt's topic: a tracked question joins it. */
  topic: string;
  /** Admins and managers: connect Search Console, track a question. */
  canManage: boolean;
  onGscConnected: () => void;
}) {
  const t = useTranslations('promptDemand');
  return (
    <section className="space-y-3" aria-label={t('title')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium">{t('title')}</h2>
        {demand?.keyword && (
          <span className="min-w-0 break-words text-xs text-muted-foreground">
            {t('keyword', { keyword: demand.keyword })}
          </span>
        )}
      </div>
      {failed ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">{t('loadFailed')}</CardContent>
        </Card>
      ) : !demand ? (
        <div className="grid gap-4 md:grid-cols-2">
          {DEMAND_SIGNALS.map((signal) => (
            <Skeleton key={signal} className="h-32" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <GscCard
              demand={demand}
              gscStatus={gscStatus}
              canManage={canManage}
              onConnected={onGscConnected}
            />
            <TrendsCard demand={demand} />
            <PaaCard demand={demand} brandId={brandId} topic={topic} canManage={canManage} />
            <YoutubeCard demand={demand} />
          </div>
          <p className="text-xs text-muted-foreground">
            {demand.level ? t.rich(`note.${demand.level}`, { b: bold }) : t('note.none')}
          </p>
        </>
      )}
    </section>
  );
}
