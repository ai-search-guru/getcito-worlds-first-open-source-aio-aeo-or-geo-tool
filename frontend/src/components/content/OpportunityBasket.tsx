'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Boxes, ExternalLink, FileText, Gauge, Layers, Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadingDots } from '@/components/ui/loading-dots';
import { useAssetTypeLabel } from '@/hooks/useAssetTypeLabel';
import { getOpportunityActions, type OpportunityActionResult } from '@/lib/actions/content';
import { formatDate } from '@/lib/format';
import type {
  ContentOpportunityDecision,
  ContentOpportunitySourceData,
  OpportunityBasket,
} from '@/types';

const SCORE_PARTS = [
  ['demand', 40],
  ['visibilityGap', 30],
  ['competitorGap', 20],
  ['intent', 10],
] as const;

/** Why a cluster opportunity scored what it did: each component and its weight. */
export function ScoreBreakdown({ sourceData }: { sourceData: ContentOpportunitySourceData }) {
  const t = useTranslations('content.detail');
  const parts = sourceData.scoreComponents;
  if (!parts) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('scoreTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {SCORE_PARTS.map(([key, weight]) => (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span>{t(`score.${key}`)}</span>
              <span className="tabular-nums text-muted-foreground">
                {Math.round(parts[key])} · {t('scoreWeight', { weight })}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: `${Math.min(Math.max(parts[key], 0), 100)}%` }}
              />
            </div>
          </div>
        ))}
        {sourceData.windowDays && (
          <p className="text-[11px] text-muted-foreground">
            {t('scoreWindow', { days: sourceData.windowDays })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The prompts a cluster opportunity answers and the searches AI engines ran
 * for them, included and excluded, read live from the cluster. The page reads
 * the basket once, for this card and the AI volume of its prompts.
 */
export function OpportunityBasketCard({
  basket,
  failed,
}: {
  /** Null while it is read. */
  basket: OpportunityBasket | null;
  failed: boolean;
}) {
  const t = useTranslations('content.detail');
  const [showExcluded, setShowExcluded] = useState(false);

  if (failed) return null;

  const included = basket?.queries.filter((q) => q.included) ?? [];
  const excluded = basket?.queries.filter((q) => !q.included) ?? [];
  const promptCount = basket?.clusters.reduce((s, c) => s + c.prompts.length, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">{t('basketTitle')}</CardTitle>
          {basket && (
            <span className="text-xs text-muted-foreground">
              {t('basketSummary', {
                prompts: promptCount,
                included: included.length,
                excluded: excluded.length,
              })}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!basket ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            {basket.clusters.map((c) => (
              <div key={c.id} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{c.label}</p>
                  {c.topicName && (
                    <Badge variant="outline" className="text-[10px]">
                      {c.topicName}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{c.need}</p>
                <ul className="space-y-1 text-xs">
                  {c.prompts.map((p) => (
                    <li key={p.id} className="flex gap-2">
                      <span className="text-muted-foreground">•</span>
                      <span>{p.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {included.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">{t('basketIncluded')}</p>
                <div className="flex flex-wrap gap-1">
                  {included.map((q) => (
                    <Badge
                      key={q.query}
                      variant="outline"
                      className="text-xs border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400 gap-1"
                      title={q.reason}
                    >
                      <Search className="h-2.5 w-2.5 shrink-0" />
                      {q.query}
                      <span className="opacity-60 tabular-nums">×{q.timesSearched}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {excluded.length > 0 && (
              <div className="space-y-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setShowExcluded((v) => !v)}
                >
                  {showExcluded
                    ? t('basketHideExcluded')
                    : t('basketShowExcluded', { count: excluded.length })}
                </Button>
                {showExcluded && (
                  <ul className="space-y-1 text-xs">
                    {excluded.map((q) => (
                      <li key={q.query}>
                        <span className="text-muted-foreground line-through">{q.query}</span>
                        {q.reason && <span className="text-muted-foreground"> — {q.reason}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The brand's existing pages an opportunity is about, and what to do with them. */
export function TargetPagesCard({
  decision,
  sourceData,
}: {
  decision: ContentOpportunityDecision;
  sourceData: ContentOpportunitySourceData;
}) {
  const t = useTranslations('content');
  const pages = sourceData.targetPages ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">{t('detail.targetTitle')}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">
            {t(`decision.${decision}`)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{t(`decisionHint.${decision}`)}</p>
      </CardHeader>
      {pages.length > 0 && (
        <CardContent className="space-y-2">
          {pages.map((p) => (
            <a
              key={p.url}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start justify-between gap-3 rounded-md border p-2.5 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium line-clamp-1">{p.title || p.url}</p>
                <p className="text-xs text-muted-foreground truncate">{p.url}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t('detail.targetStats', {
                    citations: p.aiCitations,
                    sessions: p.gaSessions,
                  })}
                </p>
              </div>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-1" />
            </a>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

/** Everything the opportunity asks for: the primary content first, then supporting work. */
export function AssetsCard({
  sourceData,
  onSend,
  sendingKey,
}: {
  sourceData: ContentOpportunitySourceData;
  /** Sends one asset to the Action Center; omitted when sending is not offered. */
  onSend?: (assetKey: string) => void;
  sendingKey?: string | null;
}) {
  const t = useTranslations('content');
  const assetTypeLabel = useAssetTypeLabel();
  const assets = sourceData.assets ?? [];
  const actions = sourceData.actions ?? {};
  if (assets.length < 2) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">{t('detail.assetsTitle')}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {assets.map((a, i) => (
          <div key={a.key} className="rounded-md border p-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {i === 0 && (
                <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                  {t('detail.primaryAsset')}
                </Badge>
              )}
              {assetTypeLabel(a.type) && (
                <Badge variant="outline" className="text-[10px]">
                  {assetTypeLabel(a.type)}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px]">
                {t(`type.${a.channel}`)}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {t(`decision.${a.decision}`)}
              </Badge>
            </div>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm">{a.title}</p>
              {actions[a.key] ? (
                <Link
                  href={`/dashboard/action-center/actions?action=${actions[a.key]}`}
                  className="shrink-0 text-xs text-primary hover:underline"
                >
                  {t('openInActionCenter')}
                </Link>
              ) : (
                onSend &&
                !actions.all && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={sendingKey !== null && sendingKey !== undefined}
                    onClick={() => onSend(a.key)}
                  >
                    {sendingKey === a.key ? <LoadingDots label={t('sending')} /> : t('sendAsset')}
                  </Button>
                )
              )}
            </div>
            {a.pages.map((p) => (
              <a
                key={p.url}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{p.title || p.url}</span>
              </a>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Days after an action closes before its "after" window can be read (validate.js). */
const MEASURE_AFTER_DAYS = 31;

const formatMetric = (value: number | null, unit: string) =>
  value === null
    ? '—'
    : unit === 'percent'
      ? `${Math.round(value * 10) / 10}%`
      : unit === 'points'
        ? `${value > 0 ? '+' : ''}${Math.round(value * 10) / 10} pts`
        : String(value);

/**
 * Where the work sent from this opportunity stands, and what it moved once
 * measured (#857, Phase 4). The measurement is the Action Center's own.
 */
export function OpportunityResultsCard({ actionIds }: { actionIds: string[] }) {
  const t = useTranslations('content.detail');
  const tStatus = useTranslations('actionCenter.actionsPage.status');
  const tOutcome = useTranslations('actionCenter.actionOutcome');
  const tKpi = useTranslations('actionCenter.registry');
  const [actions, setActions] = useState<OpportunityActionResult[] | null>(null);
  const key = actionIds.join(',');

  useEffect(() => {
    let cancelled = false;
    getOpportunityActions(key.split(','))
      .then((rows) => !cancelled && setActions(rows))
      .catch(() => !cancelled && setActions([]));
    return () => {
      cancelled = true;
    };
  }, [key]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">{t('resultsTitle')}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!actions ? (
          <Skeleton className="h-16 w-full" />
        ) : actions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('resultsUnavailable')}</p>
        ) : (
          actions.map((a) => {
            const measureFrom =
              a.completedAt &&
              new Date(Date.parse(a.completedAt) + MEASURE_AFTER_DAYS * 86_400_000);
            return (
              <div key={a.id} className="space-y-1.5 rounded-md border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/dashboard/action-center/actions?action=${a.id}`}
                    className="text-xs font-medium hover:underline"
                  >
                    AC-{a.actionNo}
                  </Link>
                  <Badge variant="outline" className="text-[10px]">
                    {tStatus(a.status)}
                  </Badge>
                </div>
                {a.title && <p className="text-xs text-muted-foreground line-clamp-2">{a.title}</p>}
                {a.status === 'completed' && a.outcome === 'pending_measurement' && measureFrom ? (
                  <p className="text-xs text-muted-foreground">
                    {t('resultsPending', {
                      date: formatDate(
                        Number.isNaN(measureFrom.getTime()) ? null : measureFrom.toISOString(),
                      ),
                    })}
                  </p>
                ) : a.status === 'completed' ? (
                  <div className="space-y-1">
                    <Badge variant="secondary" className="text-[10px]">
                      {tOutcome(a.outcome)}
                    </Badge>
                    {a.metrics.map((m) => (
                      <div key={m.metric} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{tKpi(`${m.metric}.name`)}</span>
                        <span className="tabular-nums">
                          {formatMetric(m.before, m.unit)} → {formatMetric(m.after, m.unit)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
