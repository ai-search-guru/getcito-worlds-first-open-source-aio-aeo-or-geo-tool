'use client';

import { useCallback, useEffect, useRef, useState, use } from 'react';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/navigation';
import { useBrandStore } from '@/state/useBrandStore';
import {
  getTopicDetail,
  type InsightsSummary,
  type VisibilityTrendPoint,
  type ShareOfVoiceData,
  type CompetitorComparisonData,
  type TopicRecentRun,
} from '@/lib/actions/tracking';
import type { Topic } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Eye,
  Quote,
  RotateCw,
  TrendingDown,
  TrendingUp,
  Zap,
  Users,
} from 'lucide-react';
import { ShareOfVoicePlatformChart } from '../../../insights/_charts';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import dynamic from 'next/dynamic';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';
const DynamicVisibilityTrendChart = dynamic(
  () => import('./topic_charts').then((m) => m.VisibilityTrendChartView),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[260px] w-full" />,
  },
);

function ChartContainer({
  height,
  children,
}: {
  height: number;
  children: (width: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {width > 0 && children(width)}
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  change,
  suffix,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  change?: number | null;
  suffix?: string;
  hint?: string;
}) {
  return (
    <Card title={hint}>
      <CardContent className="pt-6 pb-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-2xl font-semibold tabular-nums">
            {value}
            {suffix && (
              <span className="text-sm font-normal text-muted-foreground ml-0.5">{suffix}</span>
            )}
          </div>
          {change !== null && change !== undefined && change !== 0 && (
            <span
              className={cn(
                'flex items-center text-xs font-medium',
                change > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : change < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-muted-foreground',
              )}
            >
              {change > 0 ? (
                <TrendingUp className="h-3 w-3 mr-0.5" />
              ) : change < 0 ? (
                <TrendingDown className="h-3 w-3 mr-0.5" />
              ) : null}
              {change > 0 ? '+' : ''}
              {change}
              {suffix === '%' ? 'pts' : ''}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Visibility trend chart ───────────────────────────────────────────────

function VisibilityTrendChart({ data }: { data: VisibilityTrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        No data yet for this topic.
      </div>
    );
  }
  return (
    <ChartContainer height={260}>
      {(width) => <DynamicVisibilityTrendChart width={width} data={data} />}
    </ChartContainer>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function TopicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: topicId } = use(params);
  const router = useRouter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);

  const [topic, setTopic] = useState<Topic | null>(null);
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [trend, setTrend] = useState<VisibilityTrendPoint[]>([]);
  const [sov, setSov] = useState<ShareOfVoiceData | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorComparisonData | null>(null);
  const [results, setResults] = useState<TopicRecentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!activeBrandId || !topicId) return;
    setLoading(true);
    setError(null);
    try {
      // One server action (#312): Next.js runs server actions sequentially, so
      // the old six-call Promise.all paid the sum of all six. This is one round
      // trip whose body runs the work in a real server-side Promise.all.
      const detail = await getTopicDetail(activeBrandId, topicId);
      setTopic(detail.topic);
      setSummary(detail.summary);
      setTrend(detail.trend);
      setSov(detail.sov);
      setCompetitors(detail.competitors);
      setResults(detail.results);
    } catch (err) {
      console.error('Failed to load topic detail', err);
      setError(err instanceof Error ? err.message : 'Failed to load this topic');
      toast.error('Failed to load this topic');
    } finally {
      setLoading(false);
    }
  }, [activeBrandId, topicId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!activeBrandId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <h2 className="text-base font-semibold">No brand selected</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Select a brand from the top switcher first.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="mx-auto h-9 w-9 text-destructive/60" />
            <h2 className="mt-3 text-base font-semibold">Couldn&apos;t load this topic</h2>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <Button onClick={loadData} className="mt-4 gap-2" size="sm" variant="outline">
              <RotateCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Top/weak prompts — aggregate by prompt_id
  const promptRollup = new Map<string, { promptText: string; totalScore: number; count: number }>();
  for (const r of results) {
    const ex = promptRollup.get(r.promptId) ?? {
      promptText: r.promptText,
      totalScore: 0,
      count: 0,
    };
    ex.totalScore += r.visibilityScore;
    ex.count += 1;
    promptRollup.set(r.promptId, ex);
  }
  const promptList = [...promptRollup.entries()].map(([id, v]) => ({
    id,
    text: v.promptText,
    avg: Math.round(v.totalScore / v.count),
    runs: v.count,
  }));
  const topPrompts = [...promptList].sort((a, b) => b.avg - a.avg).slice(0, 5);
  const weakPrompts = [...promptList].sort((a, b) => a.avg - b.avg).slice(0, 5);

  // Headline metric (#493): the topic-scoped prompt-level visibility rate.
  // getCompetitorComparison already computes it under the topic filter with
  // the same-denominator rule, so the own-brand entry carries rate, X/Y
  // counts and the rate's point change.
  const ownBrand = competitors?.brands.find((b) => b.isOwnBrand) ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <HeaderWithAiUsage>
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/dashboard/prompts/topics')}
            className="mb-2 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Topics
          </Button>
          {loading && !topic ? (
            <Skeleton className="h-8 w-64" />
          ) : topic ? (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{topic.name}</h1>
            </div>
          ) : (
            <h1 className="text-2xl font-bold">Topic not found</h1>
          )}
        </div>
      </HeaderWithAiUsage>

      {/* KPI strip */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={Eye}
            label="Visibility"
            value={ownBrand?.score ?? 0}
            change={ownBrand?.scoreChange ?? null}
            hint={
              ownBrand
                ? `Mentioned in ${ownBrand.mentionAnswers} answers · cited in ${ownBrand.citationAnswers} · appeared in ${ownBrand.visiblePrompts} of ${ownBrand.promptCount} prompts`
                : undefined
            }
          />
          <KpiCard
            icon={Zap}
            label="Brand mentions"
            value={formatNumber(summary.totalMentions)}
            change={summary.mentionsChange}
          />
          <KpiCard
            icon={Quote}
            label="Citations"
            value={formatNumber(summary.totalCitations)}
            change={summary.citationsChange}
          />
          <KpiCard
            icon={BarChart3}
            label="Positive sentiment"
            value={summary.positiveSentimentPct}
            change={summary.sentimentChange}
            suffix="%"
          />
        </div>
      ) : null}

      {/* Trend + SoV platform */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Visibility trend</CardTitle>
            <p className="text-xs text-muted-foreground">
              Daily average visibility for this topic vs. competitor average
            </p>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-[260px]" /> : <VisibilityTrendChart data={trend} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Share of voice by platform</CardTitle>
            <p className="text-xs text-muted-foreground">Brand vs. competitors on answer engines</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[260px]" />
            ) : sov && sov.byPlatform.length > 0 ? (
              <ShareOfVoicePlatformChart data={sov.byPlatform} overallSov={sov.overallSov} />
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                No platform data yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Competitor table + prompts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Competitors */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Competitor comparison
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Your brand vs. direct competitors on this topic
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[200px]" />
            ) : competitors && competitors.brands.length > 0 ? (
              <ul className="divide-y">
                {competitors.brands.slice(0, 6).map((c, i) => (
                  <li
                    key={c.name}
                    className={cn(
                      'flex items-center gap-3 py-2',
                      c.isOwnBrand && 'bg-primary/5 -mx-3 px-3 rounded',
                    )}
                    title={`Appeared in ${c.visiblePrompts} of ${c.promptCount} prompts · avg score ${c.avgVisibilityScore}%`}
                  >
                    <span className="w-5 text-xs text-muted-foreground tabular-nums text-right">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-sm font-medium truncate">
                      {c.name}
                      {c.isOwnBrand && (
                        <span className="ml-1.5 text-[10px] font-medium text-primary">YOU</span>
                      )}
                    </span>
                    <span className="text-sm tabular-nums w-10 text-right">{c.score ?? '—'}</span>
                    {c.scoreChange !== null && (
                      <span
                        className={cn(
                          'text-xs tabular-nums w-12 text-right',
                          c.scoreChange > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : c.scoreChange < 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-muted-foreground',
                        )}
                      >
                        {c.scoreChange > 0 ? '+' : ''}
                        {c.scoreChange}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground py-10 text-center">
                No competitor mentions yet.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Top / Weak prompts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Prompt performance</CardTitle>
            <p className="text-xs text-muted-foreground">
              Best & worst performing prompts in this topic (last 50 runs)
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <>
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </>
            ) : promptList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No prompt results yet.
              </p>
            ) : (
              <>
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-2">
                    <TrendingUp className="h-3 w-3" />
                    Top performers
                  </div>
                  <ul className="space-y-1.5">
                    {topPrompts.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {p.avg}%
                        </Badge>
                        <span className="flex-1 truncate">{p.text}</span>
                        <span className="text-xs text-muted-foreground">{p.runs} runs</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-rose-600 dark:text-rose-400 mb-2">
                    <TrendingDown className="h-3 w-3" />
                    Needs improvement
                  </div>
                  <ul className="space-y-1.5">
                    {weakPrompts.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {p.avg}%
                        </Badge>
                        <span className="flex-1 truncate">{p.text}</span>
                        <span className="text-xs text-muted-foreground">{p.runs} runs</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="pt-2 border-t">
                  <Link
                    href={`/dashboard/insights?topic=${topicId}`}
                    className="text-xs text-primary hover:underline"
                  >
                    View all prompt results for this topic →
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
