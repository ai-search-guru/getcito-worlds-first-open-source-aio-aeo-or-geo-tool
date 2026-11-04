'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useBrandStore } from '@/state/useBrandStore';
import { useFeatureGate } from '@/hooks/useFeatureGate';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import {
  getCompetitors,
  addCompetitor,
  deleteCompetitor,
  getCompetitorTimeline,
} from '@/lib/actions/competitor';
import type { CompetitorTimeline } from '@/lib/competitorTimeline';
import { CompetitorTimelineCard } from './_TimelineCard';
import type { SuggestedCompetitor } from '@/lib/aiBrandSetup';
import { SuggestCompetitorsDialog } from './_SuggestCompetitorsDialog';
import {
  getCompetitorComparison,
  getHeadToHeadComparison,
  getHeadToHeadRuns,
  type CompetitorComparisonData,
} from '@/lib/actions/tracking';
import type { HeadToHeadData, HeadToHeadGroup, HeadToHeadRun } from '@/lib/headToHead';
import { getSiteIconUrl } from '@/lib/siteIcon';
import { toCsv } from '@/lib/csv';
import { slugify } from '@/lib/slug';
import { readUrlChoice, readUrlParam, writeUrlParams } from '@/lib/urlState';
import { DateRangeFilter, type DateRangePreset } from '@/components/filters/DateRangeFilter';
import { getDateRange } from '@/lib/dateRange';
import { MODEL_LABELS } from '@/config/platformLabels';
import type { Competitor } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { exportFileName } from '@/lib/white-label/exportName';
import { AIProviderAvatar, resolveAIProvider } from '@/components/AiProviderAvatar';
import {
  Plus,
  Sparkles,
  Trash2,
  Loader2,
  Users,
  Globe,
  Crown,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Swords,
  TrendingUp,
  TrendingDown,
  Target,
  ShieldAlert,
  ChevronDown,
  Eye,
  Download,
} from 'lucide-react';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

// ─── Shared Visual Components (mirroring Insights) ───────────────────────────

function getModelDisplayName(model: string, platform?: string): string {
  // In h2h data, platform is already resolved (e.g. "ChatGPT", "Perplexity")
  // so use it directly if available
  if (platform) {
    const modelName = MODEL_LABELS[model];
    return modelName && modelName !== platform ? `${platform} · ${modelName}` : platform;
  }
  return MODEL_LABELS[model] ?? model;
}

function ModelBadge({ model, platform }: { model: string; platform?: string }) {
  const provider = resolveAIProvider(model, platform);
  return (
    <span className="inline-flex items-center gap-1.5">
      <AIProviderAvatar provider={provider} />
      <span className="text-xs">{getModelDisplayName(model, platform)}</span>
    </span>
  );
}

function SentimentBadge({ sentiment }: { sentiment: 'positive' | 'neutral' | 'negative' }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs capitalize',
        sentiment === 'positive' &&
          'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
        sentiment === 'neutral' &&
          'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
        sentiment === 'negative' &&
          'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
      )}
    >
      {sentiment}
    </Badge>
  );
}

// ─── Plan Gate ────────────────────────────────────────────────────────────────

function PlanGateOverlay() {
  const t = useTranslations('competitors');
  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
      </HeaderWithAiUsage>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
            <Crown className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-lg font-semibold">{t('upgradeTitle')}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t('upgradeDescription')}</p>
          <Badge variant="outline" className="mt-4">
            <Crown className="mr-1 h-3 w-3" />
            {t('upgradeRequiredPlan')}
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── No Brand ─────────────────────────────────────────────────────────────────

function NoBrandSelected() {
  const t = useTranslations('competitors');
  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
      </HeaderWithAiUsage>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white mb-4">
            <AlertCircle className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">{t('noBrandTitle')}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t('noBrandDescription')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

/** Without onAdd (a member who isn't an admin or a manager) there's nothing to start with here. */
function EmptyState({ onAdd, onSuggest }: { onAdd?: () => void; onSuggest?: () => void }) {
  const t = useTranslations('competitors');
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white mb-4">
          <Users className="h-7 w-7 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">{t('emptyTitle')}</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t('emptyDescription')}</p>
        {onAdd && onSuggest && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button className="gap-2" onClick={onAdd}>
              <Plus className="h-4 w-4" />
              {t('addCompetitor')}
            </Button>
            <Button variant="outline" className="gap-2" onClick={onSuggest}>
              <Sparkles className="h-4 w-4" />
              {t('suggestCompetitors')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Add Dialog ───────────────────────────────────────────────────────────────

function AddCompetitorDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, domain: string) => Promise<void>;
}) {
  const t = useTranslations('competitors');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    setName('');
    setDomain('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onAdd(name.trim(), domain.trim());
      reset();
      onOpenChange(false);
    } catch {
      toast.error(t('addError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('addCompetitor')}</DialogTitle>
            <DialogDescription>{t('addDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="comp-name">{t('name')}</Label>
              <Input
                id="comp-name"
                placeholder={t('namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="comp-domain">{t('domain')}</Label>
              <Input
                id="comp-domain"
                placeholder={t('domainPlaceholder')}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Diff Indicator ───────────────────────────────────────────────────────────

function DiffBadge({ diff }: { diff: number }) {
  if (diff > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-green-600 dark:text-green-400">
        <ArrowUpRight className="h-3 w-3" />+{diff}
      </span>
    );
  }
  if (diff < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-600 dark:text-red-400">
        <ArrowDownRight className="h-3 w-3" />
        {diff}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
      <Minus className="h-3 w-3" />0
    </span>
  );
}

// ─── Competitor Cards (Management) ────────────────────────────────────────────

function CompetitorCard({
  competitor,
  stats,
  isSelected,
  onSelect,
  onDelete,
  deleting,
}: {
  competitor: Competitor;
  stats: {
    score: number | null;
    mentionAnswers: number;
    citationAnswers: number;
    positionFactor: number | null;
    visiblePrompts: number;
    promptCount: number;
    mentions: number;
    citations: number;
  } | null;
  isSelected: boolean;
  onSelect: () => void;
  /** Absent for a member who isn't an admin or a manager: no delete button. */
  onDelete?: () => void;
  deleting: boolean;
}) {
  const t = useTranslations('competitors');

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 rounded-lg border p-3 transition-colors cursor-pointer hover:bg-accent/50',
        isSelected && 'border-primary bg-primary/5 ring-1 ring-primary/20',
      )}
      onClick={onSelect}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        {competitor.domain ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={getSiteIconUrl(competitor.domain)}
            alt=""
            className="h-5 w-5 rounded-sm"
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              el.style.display = 'none';
              el.parentElement!.innerHTML =
                '<svg class="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" /></svg>';
            }}
          />
        ) : (
          <Globe className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{competitor.name}</span>
          {isSelected && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {t('selected')}
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground truncate block">
          {competitor.domain || '—'}
        </span>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {stats ? (
          <div
            className="text-right"
            title={`Mentioned in ${stats.mentionAnswers} answers · cited in ${stats.citationAnswers}${
              stats.positionFactor !== null
                ? ` · position factor ${stats.positionFactor.toFixed(2)}`
                : ''
            } · ${stats.mentions} mentions · ${stats.citations} citations`}
          >
            <div className="text-sm font-semibold tabular-nums">{stats.score ?? '—'}</div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {stats.visiblePrompts}/{stats.promptCount} prompts
            </div>
          </div>
        ) : (
          <div className="text-right">
            <span className="text-xs text-muted-foreground">{t('noData')}</span>
          </div>
        )}

        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('delete')}
            title={t('delete')}
            className="h-7 w-7 opacity-0 group-hover:opacity-70 hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Head-to-Head: Platform Breakdown ─────────────────────────────────────────

function PlatformBreakdown({
  data,
  brandName,
  competitorName,
}: {
  data: HeadToHeadData;
  brandName: string;
  competitorName: string;
}) {
  const t = useTranslations('competitors');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('h2h.platformBreakdown')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.platformRows.map((row) => {
            const max = Math.max(row.brandScore, row.competitorScore, 1);
            return (
              <div key={row.platform} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{row.platform}</span>
                  <DiffBadge diff={row.diff} />
                </div>
                <div className="flex gap-1 items-center">
                  <div className="flex-1 flex gap-1">
                    <div
                      className="h-2 rounded-full bg-blue-500 dark:bg-blue-400 transition-all"
                      style={{ width: `${(row.brandScore / max) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums w-8 text-right font-medium">
                    {row.brandScore}%
                  </span>
                </div>
                <div className="flex gap-1 items-center">
                  <div className="flex-1 flex gap-1">
                    <div
                      className="h-2 rounded-full bg-orange-400 dark:bg-orange-500 transition-all"
                      style={{ width: `${(row.competitorScore / max) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums w-8 text-right font-medium">
                    {row.competitorScore}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-4 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-blue-500 dark:bg-blue-400" />
            {brandName}
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-orange-400 dark:bg-orange-500" />
            {competitorName}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Head-to-Head: Grouped Prompt Comparison ─────────────────────────────────

interface PromptComparisonGroup {
  promptId: string;
  promptText: string;
  promptCategory?: string;
  groups: HeadToHeadGroup[];
  runs: number;
  latestAt: string;
  avgBrandScore: number;
  avgCompetitorScore: number;
  avgDiff: number;
}

/** Fold engine groups into one row per prompt, weighting each engine by its runs. */
function groupH2HByPrompt(groups: HeadToHeadGroup[]): PromptComparisonGroup[] {
  const map = new Map<string, HeadToHeadGroup[]>();
  for (const g of groups) {
    const arr = map.get(g.promptId) || [];
    arr.push(g);
    map.set(g.promptId, arr);
  }
  return Array.from(map.entries())
    .map(([promptId, items]) => {
      const runs = items.reduce((s, g) => s + g.runs, 0);
      const avgB = Math.round(items.reduce((s, g) => s + g.brandScore * g.runs, 0) / runs);
      const avgC = Math.round(items.reduce((s, g) => s + g.competitorScore * g.runs, 0) / runs);
      return {
        promptId,
        promptText: items[0].promptText,
        promptCategory: items[0].promptCategory,
        groups: [...items].sort((a, b) => b.brandScore - a.brandScore),
        runs,
        latestAt: items.reduce((max, g) => (g.latestAt > max ? g.latestAt : max), ''),
        avgBrandScore: avgB,
        avgCompetitorScore: avgC,
        avgDiff: avgB - avgC,
      };
    })
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

type LoadRuns = (group: HeadToHeadGroup, limit: number) => Promise<HeadToHeadRun[]>;

const RUN_HISTORY_LIMIT = 50;

function ModelSubGroup({
  group,
  expanded,
  onToggle,
  onViewResult,
  loadRuns,
  brandName,
  competitorName,
}: {
  group: HeadToHeadGroup;
  expanded: boolean;
  onToggle: () => void;
  onViewResult: (resultId: string) => void;
  loadRuns: LoadRuns;
  brandName: string;
  competitorName: string;
}) {
  const t = useTranslations('competitors');
  const hasHistory = group.runs > 1;
  const [runs, setRuns] = useState<HeadToHeadRun[] | null>(null);
  const [runsFailed, setRunsFailed] = useState(false);
  const [openingLatest, setOpeningLatest] = useState(false);

  useEffect(() => {
    if (!expanded || !hasHistory || runs !== null) return;
    let cancelled = false;
    setRunsFailed(false);
    loadRuns(group, RUN_HISTORY_LIMIT)
      .then((loaded) => {
        if (!cancelled) setRuns(loaded);
      })
      .catch(() => {
        if (!cancelled) setRunsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, hasHistory, runs, group, loadRuns]);

  const viewLatest = async () => {
    if (openingLatest) return;
    setOpeningLatest(true);
    try {
      const [latest] = runs ?? (await loadRuns(group, 1));
      if (latest) onViewResult(latest.resultId);
    } catch {
      toast.error(t('h2h.loadError'));
    } finally {
      setOpeningLatest(false);
    }
  };

  return (
    <div className="rounded-md border bg-background/50">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          'flex w-full items-center gap-3 px-3 py-2 transition-colors select-none',
          hasHistory ? 'hover:bg-muted/40 cursor-pointer' : 'cursor-default',
        )}
      >
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            !expanded && '-rotate-90',
            !hasHistory && 'opacity-0',
          )}
        />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <ModelBadge model={group.modelUsed || group.platform} platform={group.platform} />
          {group.region && (
            <Badge variant="outline" className="text-[10px]">
              {group.region}
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground tabular-nums ml-1">
            {group.runs} run{group.runs !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">{t('h2h.you')}</p>
            <p className="text-xs font-semibold tabular-nums">{Math.round(group.brandScore)}%</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">{t('h2h.them')}</p>
            <p className="text-xs font-semibold tabular-nums">
              {Math.round(group.competitorScore)}%
            </p>
          </div>
          <div className="text-right min-w-[48px]">
            <p className="text-[10px] text-muted-foreground">{t('h2h.diff')}</p>
            <DiffBadge diff={Math.round(group.brandScore) - Math.round(group.competitorScore)} />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="View latest AI response"
            disabled={openingLatest}
            onClick={(e) => {
              e.stopPropagation();
              void viewLatest();
            }}
            aria-label="View latest AI response"
          >
            {openingLatest ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {expanded && hasHistory && (
        <div className="border-t bg-muted/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
            Previous runs
          </p>
          {runsFailed ? (
            <p className="py-2 text-xs text-muted-foreground">{t('h2h.loadError')}</p>
          ) : runs === null ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] h-7">Date</TableHead>
                  <TableHead className="text-[10px] h-7 text-center">{brandName}</TableHead>
                  <TableHead className="text-[10px] h-7 text-center">{competitorName}</TableHead>
                  <TableHead className="text-[10px] h-7 text-center">{t('h2h.diff')}</TableHead>
                  <TableHead className="text-[10px] h-7 text-center">Sentiment</TableHead>
                  <TableHead className="text-[10px] h-7 w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((row) => (
                  <TableRow key={row.resultId} className="hover:bg-muted/30">
                    <TableCell className="text-xs text-muted-foreground py-1.5">
                      {formatTimestamp(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-center py-1.5 text-xs font-semibold tabular-nums">
                      {Math.round(row.brandScore)}%
                    </TableCell>
                    <TableCell className="text-center py-1.5 text-xs font-semibold tabular-nums">
                      {Math.round(row.competitorScore)}%
                    </TableCell>
                    <TableCell className="text-center py-1.5">
                      <DiffBadge diff={Math.round(row.brandScore - row.competitorScore)} />
                    </TableCell>
                    <TableCell className="text-center py-1.5">
                      <SentimentBadge sentiment={row.sentiment} />
                    </TableCell>
                    <TableCell className="text-center py-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="View AI response"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewResult(row.resultId);
                        }}
                        aria-label="View AI response"
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}

function PromptComparisonGrouped({
  groups: engineGroups,
  brandName,
  competitorName,
  onViewResult,
  loadRuns,
}: {
  groups: HeadToHeadGroup[];
  brandName: string;
  competitorName: string;
  onViewResult: (resultId: string) => void;
  loadRuns: LoadRuns;
}) {
  const t = useTranslations('competitors');
  const groups = groupH2HByPrompt(engineGroups);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleModel = (id: string) =>
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t('h2h.noPromptData')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const isOpen = expanded.has(group.promptId);
        const modelGroups = group.groups;
        return (
          <div key={group.promptId} className="rounded-lg border overflow-hidden">
            {/* Group Header */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggle(group.promptId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(group.promptId);
                }
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors cursor-pointer select-none"
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  !isOpen && '-rotate-90',
                )}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium line-clamp-1">{group.promptText}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {group.promptCategory && (
                    <Badge variant="outline" className="text-[10px]">
                      {group.promptCategory}
                    </Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {modelGroups.length} platform
                    {modelGroups.length !== 1 ? 's' : ''} · {group.runs} result
                    {group.runs !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">{t('h2h.you')}</p>
                  <p className="text-sm font-semibold tabular-nums">{group.avgBrandScore}%</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">{t('h2h.them')}</p>
                  <p className="text-sm font-semibold tabular-nums">{group.avgCompetitorScore}%</p>
                </div>
                <div className="text-right min-w-[48px]">
                  <p className="text-[10px] text-muted-foreground">{t('h2h.diff')}</p>
                  <DiffBadge diff={group.avgDiff} />
                </div>
              </div>
            </div>

            {/* Platform/Model sub-groups */}
            {isOpen && (
              <div className="border-t px-3 py-2 space-y-1.5 bg-muted/10">
                {modelGroups.map((mg) => {
                  const compositeKey = `${group.promptId}::${mg.rawPlatform ?? ''}|${mg.rawModelUsed ?? ''}|${mg.region ?? ''}`;
                  return (
                    <ModelSubGroup
                      key={compositeKey}
                      group={mg}
                      expanded={expandedModels.has(compositeKey)}
                      onToggle={() => toggleModel(compositeKey)}
                      onViewResult={onViewResult}
                      loadRuns={loadRuns}
                      brandName={brandName}
                      competitorName={competitorName}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Gap / Strength Cards ─────────────────────────────────────────────────────

interface GapStrengthGroup {
  promptId: string;
  promptText: string;
  items: HeadToHeadGroup[];
  avgBrandScore: number;
  avgCompetitorScore: number;
  avgDiff: number;
}

function groupGapStrengthByPrompt(items: HeadToHeadGroup[]): GapStrengthGroup[] {
  const map = new Map<string, HeadToHeadGroup[]>();
  for (const item of items) {
    const arr = map.get(item.promptId) || [];
    arr.push(item);
    map.set(item.promptId, arr);
  }
  return Array.from(map.entries())
    .map(([promptId, groupItems]) => {
      const avgB = Math.round(groupItems.reduce((s, r) => s + r.brandScore, 0) / groupItems.length);
      const avgC = Math.round(
        groupItems.reduce((s, r) => s + r.competitorScore, 0) / groupItems.length,
      );
      return {
        promptId,
        promptText: groupItems[0].promptText,
        items: groupItems,
        avgBrandScore: avgB,
        avgCompetitorScore: avgC,
        avgDiff: avgB - avgC,
      };
    })
    .sort((a, b) => a.avgDiff - b.avgDiff);
}

function GapStrengthList({ items, type }: { items: HeadToHeadGroup[]; type: 'gap' | 'strength' }) {
  const t = useTranslations('competitors');
  const isGap = type === 'gap';
  const groups = groupGapStrengthByPrompt(items);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        {isGap ? t('h2h.noGaps') : t('h2h.noStrengths')}
      </div>
    );
  }

  // For strengths, reverse so best performers appear first
  const sorted = isGap ? groups : [...groups].reverse();

  return (
    <div className="space-y-2">
      {sorted.map((group, i) => {
        const isOpen = expanded.has(group.promptId);
        const hasMultiple = group.items.length > 1;

        return (
          <div
            key={group.promptId}
            className={cn(
              'rounded-lg border overflow-hidden',
              isGap
                ? 'border-red-200/50 bg-red-50/50 dark:border-red-900/30 dark:bg-red-950/20'
                : 'border-green-200/50 bg-green-50/50 dark:border-green-900/30 dark:bg-green-950/20',
            )}
          >
            {/* Group Header */}
            <div
              role={hasMultiple ? 'button' : undefined}
              tabIndex={hasMultiple ? 0 : undefined}
              onClick={() => hasMultiple && toggle(group.promptId)}
              onKeyDown={(e) => {
                if (hasMultiple && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  toggle(group.promptId);
                }
              }}
              className={cn(
                'flex items-start gap-3 p-3',
                hasMultiple &&
                  'cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors select-none',
              )}
            >
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold mt-0.5',
                  isGap
                    ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                    : 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400',
                )}
              >
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {hasMultiple && (
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                        !isOpen && '-rotate-90',
                      )}
                    />
                  )}
                  <p className="text-sm line-clamp-2">{group.promptText}</p>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>
                    {t('h2h.you')}: {group.avgBrandScore}%
                  </span>
                  <span>
                    {t('h2h.them')}: {group.avgCompetitorScore}%
                  </span>
                  {hasMultiple ? (
                    <span>{group.items.length} models</span>
                  ) : group.items[0].modelUsed || group.items[0].platform ? (
                    <ModelBadge
                      model={group.items[0].modelUsed || group.items[0].platform}
                      platform={group.items[0].platform}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                  {!hasMultiple && group.items[0].latestAt && (
                    <span className="text-muted-foreground">
                      {new Date(group.items[0].latestAt).toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                <DiffBadge diff={group.avgDiff} />
              </div>
            </div>

            {/* Expanded: per-model breakdown */}
            {isOpen && hasMultiple && (
              <div className="border-t px-3 pb-3 pt-2 space-y-1.5">
                {group.items.map((item, j) => (
                  <div
                    key={`${item.promptId}-${item.modelUsed}-${j}`}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-xs',
                      isGap
                        ? 'bg-red-100/50 dark:bg-red-900/20'
                        : 'bg-green-100/50 dark:bg-green-900/20',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      {item.modelUsed || item.platform ? (
                        <ModelBadge
                          model={item.modelUsed || item.platform}
                          platform={item.platform}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                    {item.region && (
                      <Badge variant="outline" className="text-[10px]">
                        {item.region}
                      </Badge>
                    )}
                    <span className="tabular-nums text-muted-foreground">
                      {t('h2h.you')}: {Math.round(item.brandScore)}%
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {t('h2h.them')}: {Math.round(item.competitorScore)}%
                    </span>
                    {item.latestAt && (
                      <span className="text-muted-foreground whitespace-nowrap">
                        {new Date(item.latestAt).toLocaleDateString('en-US', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    )}
                    <DiffBadge diff={Math.round(item.diff)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Head-to-Head Section ─────────────────────────────────────────────────────

function HeadToHeadSection({
  data,
  brandName,
  competitorName,
  loadRuns,
}: {
  data: HeadToHeadData;
  brandName: string;
  competitorName: string;
  loadRuns: LoadRuns;
}) {
  const t = useTranslations('competitors');
  const router = useRouter();
  const overallDiff = data.brandAvg - data.competitorAvg;

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Target className="h-3.5 w-3.5" />
              {t('h2h.yourAvg')}
            </div>
            <div className="text-2xl font-bold tabular-nums">{data.brandAvg}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Swords className="h-3.5 w-3.5" />
              {t('h2h.theirAvg')}
            </div>
            <div className="text-2xl font-bold tabular-nums">{data.competitorAvg}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              {overallDiff >= 0 ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              {t('h2h.overallDiff')}
            </div>
            <div
              className={cn(
                'text-2xl font-bold tabular-nums',
                overallDiff > 0 && 'text-green-600 dark:text-green-400',
                overallDiff < 0 && 'text-red-600 dark:text-red-400',
              )}
            >
              {overallDiff > 0 ? '+' : ''}
              {overallDiff}%
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Platform Breakdown */}
        <PlatformBreakdown data={data} brandName={brandName} competitorName={competitorName} />

        {/* Gaps & Strengths */}
        <Card className="lg:col-span-2">
          <CardContent className="pt-4">
            <Tabs defaultValue="gaps">
              <TabsList className="mb-3">
                <TabsTrigger value="gaps" className="gap-1.5 text-xs">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {t('h2h.gaps')} ({data.gaps.length})
                </TabsTrigger>
                <TabsTrigger value="strengths" className="gap-1.5 text-xs">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {t('h2h.strengths')} ({data.strengths.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="gaps">
                <GapStrengthList items={data.gaps} type="gap" />
              </TabsContent>
              <TabsContent value="strengths">
                <GapStrengthList items={data.strengths} type="strength" />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Grouped Prompt-by-Prompt Comparison */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('h2h.promptByPrompt')}</CardTitle>
          <p className="text-xs text-muted-foreground">{t('h2h.promptByPromptDesc')}</p>
        </CardHeader>
        <CardContent className="pt-0">
          <PromptComparisonGrouped
            groups={data.groups}
            brandName={brandName}
            competitorName={competitorName}
            onViewResult={(resultId) => router.push(`/dashboard/insights/${resultId}`)}
            loadRuns={loadRuns}
          />
        </CardContent>
      </Card>
    </div>
  );
}

type CompetitorDatePreset = Exclude<DateRangePreset, '24h'>;

const COMPETITOR_DATE_PRESETS: readonly CompetitorDatePreset[] = [
  '7d',
  '30d',
  '90d',
  'all',
  'custom',
];

function competitorComparisonWindow(
  preset: CompetitorDatePreset,
  custom: { from: string; to: string },
) {
  const range = getDateRange(preset, custom);
  // Always provide a days window so competitor_aggregates_daily is used, even
  // for all-time and partially specified custom ranges.
  return { ...range, days: range.days ?? {} };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const BENCHMARK_EXPORT_HEADERS = [
  'name',
  'is_own_brand',
  'visibility_score',
  'visible_prompts',
  'prompt_count',
  'mention_answers',
  'citation_answers',
  'mentions',
  'citations',
];

const HEAD_TO_HEAD_EXPORT_HEADERS = [
  'prompt',
  'platform',
  'model',
  'region',
  'runs',
  'brand_score',
  'competitor_score',
  'difference',
  'latest_at',
];

function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function CompetitorsPage() {
  const t = useTranslations('competitors');
  const common = useTranslations('common');
  const { canUse, isCloud } = useFeatureGate();
  const brand = useBrandStore((s) => s.getActiveBrand());

  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [comparisonData, setComparisonData] = useState<CompetitorComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [datePreset, setDatePreset] = useState<CompetitorDatePreset>('30d');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateParamsReady, setDateParamsReady] = useState(false);
  const competitorsRequestId = useRef(0);
  const comparisonRequestId = useRef(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [suggestDialogOpen, setSuggestDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Competitor | null>(null);
  // A read-only workspace (plan not active): Add, Suggest (it asks the AI as
  // it opens) and Delete open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Admins and managers add and remove competitors; others only read them.
  const { canManage } = useUserRole();
  const openAdd = guard(() => setDialogOpen(true), { action: tActions('addCompetitors') });
  const openSuggest = guard(() => setSuggestDialogOpen(true), {
    action: tActions('suggestCompetitors'),
  });

  // Head-to-head
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null);
  // ?competitor=<id> (#893): the head-to-head selection survives a refresh and
  // can be linked to, e.g. from the Insights leaderboard. Read after mount;
  // applied once the brand's competitors are known, so an unknown id is ignored.
  const [linkedCompetitorId, setLinkedCompetitorId] = useState<string | null>(null);

  useEffect(() => {
    setLinkedCompetitorId(readUrlParam('competitor') || null);
    setDatePreset(readUrlChoice('preset', COMPETITOR_DATE_PRESETS, '30d'));
    setDateFrom(readUrlParam('from'));
    setDateTo(readUrlParam('to'));
    setDateParamsReady(true);
  }, []);

  useEffect(() => {
    if (!dateParamsReady) return;
    writeUrlParams({ preset: datePreset, from: dateFrom, to: dateTo }, { preset: '30d' });
  }, [dateParamsReady, dateFrom, datePreset, dateTo]);

  const selectCompetitor = useCallback((id: string | null) => {
    setSelectedCompetitorId(id);
    writeUrlParams({ competitor: id });
  }, []);
  const [h2hData, setH2hData] = useState<HeadToHeadData | null>(null);
  const [h2hLoading, setH2hLoading] = useState(false);
  // The selected competitor's pages over time (learning C3), kept with whose they are.
  const [timeline, setTimeline] = useState<{
    competitorId: string;
    data: CompetitorTimeline | 'failed';
  } | null>(null);

  const loadCompetitors = useCallback(async () => {
    if (!brand) return;
    const requestId = ++competitorsRequestId.current;
    setLoading(true);
    try {
      const comps = await getCompetitors(brand.id);
      if (requestId !== competitorsRequestId.current) return;
      setCompetitors(comps);
    } catch {
      if (requestId === competitorsRequestId.current) toast.error(t('loadError'));
    } finally {
      if (requestId === competitorsRequestId.current) setLoading(false);
    }
  }, [brand, t]);

  const loadComparison = useCallback(async () => {
    const requestId = ++comparisonRequestId.current;
    if (!brand || !dateParamsReady) return;

    // Custom is not a query until both bounds are selected. Keep the previous
    // comparison visible rather than accidentally turning an incomplete range
    // into an unbounded all-time read.
    if (datePreset === 'custom' && (!dateFrom || !dateTo)) {
      setComparisonLoading(false);
      return;
    }

    setComparisonLoading(true);
    try {
      const comparison = await getCompetitorComparison(
        brand.id,
        competitorComparisonWindow(datePreset, { from: dateFrom, to: dateTo }),
      );
      if (requestId !== comparisonRequestId.current) return;
      setComparisonData(comparison.brands.length > 1 ? comparison : null);
    } catch {
      if (requestId === comparisonRequestId.current) toast.error(t('loadError'));
    } finally {
      if (requestId === comparisonRequestId.current) setComparisonLoading(false);
    }
  }, [brand, dateFrom, dateParamsReady, datePreset, dateTo, t]);

  useEffect(() => {
    loadCompetitors();
  }, [loadCompetitors]);

  useEffect(() => {
    loadComparison();
  }, [loadComparison]);

  useEffect(() => {
    if (!linkedCompetitorId || loading) return;
    selectCompetitor(
      competitors.some((c) => c.id === linkedCompetitorId) ? linkedCompetitorId : null,
    );
    setLinkedCompetitorId(null);
  }, [linkedCompetitorId, loading, competitors, selectCompetitor]);

  // Load head-to-head when a competitor is selected
  const loadH2H = useCallback(
    async (competitorId: string) => {
      if (!brand) return;
      setH2hLoading(true);
      setH2hData(null);
      try {
        const data = await getHeadToHeadComparison(brand.id, competitorId);
        setH2hData(data);
      } catch {
        toast.error(t('h2h.loadError'));
      } finally {
        setH2hLoading(false);
      }
    },
    [brand, t],
  );

  useEffect(() => {
    if (selectedCompetitorId) {
      loadH2H(selectedCompetitorId);
    } else {
      setH2hData(null);
    }
  }, [selectedCompetitorId, loadH2H]);

  useEffect(() => {
    if (!brand || !selectedCompetitorId) return;
    let cancelled = false;
    const competitorId = selectedCompetitorId;
    getCompetitorTimeline(brand.id, competitorId).then(
      (data) => {
        if (!cancelled) setTimeline({ competitorId, data });
      },
      (err) => {
        console.error('Failed to load the competitor timeline:', err);
        if (!cancelled) setTimeline({ competitorId, data: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [brand, selectedCompetitorId]);

  const loadRuns = useCallback(
    (group: HeadToHeadGroup, limit: number) => {
      if (!brand || !selectedCompetitorId) return Promise.resolve([]);
      return getHeadToHeadRuns(
        brand.id,
        selectedCompetitorId,
        {
          promptId: group.promptId,
          rawPlatform: group.rawPlatform,
          rawModelUsed: group.rawModelUsed,
          region: group.region ?? null,
        },
        limit,
      );
    },
    [brand, selectedCompetitorId],
  );

  if (isCloud && !canUse('competitor_tracking')) {
    return <PlanGateOverlay />;
  }

  if (!brand) return <NoBrandSelected />;

  // Build score map from comparison data. The headline number is the AI
  // Visibility Score — the same metric as the Insights leaderboard — with
  // coverage kept for the sub-line and components in the tooltip.
  const scoreMap = new Map<
    string,
    {
      score: number | null;
      mentionAnswers: number;
      citationAnswers: number;
      positionFactor: number | null;
      visiblePrompts: number;
      promptCount: number;
      mentions: number;
      citations: number;
    }
  >();
  if (comparisonData) {
    for (const entry of comparisonData.brands) {
      if (!entry.isOwnBrand) {
        scoreMap.set(entry.name, {
          score: entry.score,
          mentionAnswers: entry.mentionAnswers,
          citationAnswers: entry.citationAnswers,
          positionFactor: entry.positionFactor,
          visiblePrompts: entry.visiblePrompts,
          promptCount: entry.promptCount,
          mentions: entry.totalMentions,
          citations: entry.totalCitations,
        });
      }
    }
  }

  async function handleAdd(name: string, domain: string) {
    if (!brand) return;
    await addCompetitor(brand.id, { name, domain });
    toast.success(t('addSuccess'));
    void loadCompetitors();
    void loadComparison();
  }

  async function handleAddSuggested(
    suggestions: SuggestedCompetitor[],
  ): Promise<{ added: number; failed: number }> {
    if (!brand) return { added: 0, failed: suggestions.length };

    const results = await Promise.allSettled(
      suggestions.map((suggestion) =>
        addCompetitor(brand.id, { name: suggestion.name, domain: suggestion.domain }),
      ),
    );
    const added = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - added;

    if (added > 0) {
      // Refresh in place rather than toggling the page-wide initial loader:
      // the suggestion dialog should remain open when some inserts fail.
      try {
        const comparisonPromise =
          datePreset === 'custom' && (!dateFrom || !dateTo)
            ? Promise.resolve(null)
            : getCompetitorComparison(
                brand.id,
                competitorComparisonWindow(datePreset, { from: dateFrom, to: dateTo }),
              );
        const [currentCompetitors, comparison] = await Promise.all([
          getCompetitors(brand.id),
          comparisonPromise,
        ]);
        setCompetitors(currentCompetitors);
        if (comparison) {
          setComparisonData(comparison.brands.length > 1 ? comparison : null);
        }
      } catch {
        toast.error(t('loadError'));
      }
    }
    return { added, failed };
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteCompetitor(id);
      toast.success(t('deleteSuccess'));
      if (selectedCompetitorId === id) {
        selectCompetitor(null);
      }
      void loadCompetitors();
      void loadComparison();
    } catch {
      toast.error(t('deleteError'));
    } finally {
      setDeleting(null);
    }
  }

  const selectedCompetitor = competitors.find((c) => c.id === selectedCompetitorId);
  const today = new Date().toISOString().slice(0, 10);

  async function exportBenchmark() {
    if (!brand || !comparisonData?.brands.length) return;
    const rows = comparisonData.brands.map((e) => ({
      name: e.name,
      is_own_brand: e.isOwnBrand,
      visibility_score: e.score ?? '',
      visible_prompts: e.visiblePrompts,
      prompt_count: e.promptCount,
      mention_answers: e.mentionAnswers,
      citation_answers: e.citationAnswers,
      mentions: e.totalMentions,
      citations: e.totalCitations,
    }));
    downloadCsv(
      toCsv(rows, BENCHMARK_EXPORT_HEADERS),
      await exportFileName(`${brand.slug}_competitors_${today}.csv`),
    );
  }

  async function exportHeadToHead() {
    if (!brand || !h2hData?.groups.length || !selectedCompetitor) return;
    const rows = h2hData.groups.map((g) => ({
      prompt: g.promptText,
      platform: g.platform,
      model: g.modelUsed,
      region: g.region ?? '',
      runs: g.runs,
      brand_score: g.brandScore,
      competitor_score: g.competitorScore,
      difference: g.diff,
      latest_at: g.latestAt,
    }));
    downloadCsv(
      toCsv(rows, HEAD_TO_HEAD_EXPORT_HEADERS),
      await exportFileName(
        `${brand.slug}_head-to-head_${slugify(selectedCompetitor.name)}_${today}.csv`,
      ),
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <HeaderWithAiUsage>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground">{t('description')}</p>
          </div>
        </HeaderWithAiUsage>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header: the meter and Ask Chat at its bottom, beside the range's buttons. */}
      <HeaderWithAiUsage align="end">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground">{t('description')}</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2">
              <DateRangeFilter
                value={datePreset}
                presets={COMPETITOR_DATE_PRESETS}
                onChange={setDatePreset}
                from={dateFrom}
                to={dateTo}
                onFromChange={setDateFrom}
                onToChange={setDateTo}
              />
              {comparisonLoading && (
                <Loader2
                  className="mb-2 h-4 w-4 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </div>
            {canManage && (
              <>
                <Button variant="outline" className="gap-2" onClick={openSuggest}>
                  <Sparkles className="h-4 w-4" />
                  {t('suggestCompetitors')}
                </Button>
                <Button className="gap-2" onClick={openAdd}>
                  <Plus className="h-4 w-4" />
                  {t('addCompetitor')}
                </Button>
              </>
            )}
          </div>
        </div>
      </HeaderWithAiUsage>

      {competitors.length === 0 ? (
        <EmptyState
          onAdd={canManage ? openAdd : undefined}
          onSuggest={canManage ? openSuggest : undefined}
        />
      ) : (
        <>
          {/* Competitor List */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" />
                  {t('trackedCompetitors')}
                  <Badge variant="secondary" className="text-xs">
                    {competitors.length}
                  </Badge>
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={exportBenchmark}
                  disabled={!comparisonData?.brands.length}
                >
                  <Download className="h-4 w-4" />
                  {common('exportCsv')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('selectToCompare')}{' '}
                {datePreset === '30d'
                  ? t('windowLast30Days')
                  : datePreset === 'all'
                    ? t('windowAllTime')
                    : t('windowSelectedRange')}
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {competitors.map((comp) => (
                  <CompetitorCard
                    key={comp.id}
                    competitor={comp}
                    stats={scoreMap.get(comp.name) ?? null}
                    isSelected={selectedCompetitorId === comp.id}
                    onSelect={() =>
                      selectCompetitor(selectedCompetitorId === comp.id ? null : comp.id)
                    }
                    onDelete={
                      canManage
                        ? guard(() => setConfirmDelete(comp), {
                            action: tActions('deleteCompetitors'),
                          })
                        : undefined
                    }
                    deleting={deleting === comp.id}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Head-to-Head Section */}
          {selectedCompetitorId && (
            <>
              <div className="flex items-center gap-2 pt-2">
                <Swords className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">
                  {t('h2h.title', {
                    brand: brand.name,
                    competitor: selectedCompetitor?.name ?? '',
                  })}
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto gap-2"
                  onClick={exportHeadToHead}
                  disabled={h2hLoading || !h2hData?.groups.length}
                >
                  <Download className="h-4 w-4" />
                  {common('exportCsv')}
                </Button>
              </div>

              {h2hLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : h2hData && h2hData.groups.length > 0 ? (
                <HeadToHeadSection
                  data={h2hData}
                  brandName={brand.name}
                  competitorName={selectedCompetitor?.name ?? ''}
                  loadRuns={loadRuns}
                />
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <Swords className="h-8 w-8 text-muted-foreground mb-3" />
                    <h3 className="text-sm font-semibold">{t('h2h.noDataTitle')}</h3>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      {t('h2h.noDataDescription')}
                    </p>
                  </CardContent>
                </Card>
              )}

              <CompetitorTimelineCard
                timeline={timeline?.competitorId === selectedCompetitorId ? timeline.data : null}
                brandName={brand.name}
                competitorName={selectedCompetitor?.name ?? ''}
              />
            </>
          )}
        </>
      )}

      <AddCompetitorDialog open={dialogOpen} onOpenChange={setDialogOpen} onAdd={handleAdd} />

      <SuggestCompetitorsDialog
        open={suggestDialogOpen}
        onOpenChange={setSuggestDialogOpen}
        brand={brand}
        existingCompetitors={competitors}
        onAddSelected={handleAddSuggested}
      />

      <ConfirmDeleteCompetitorDialog
        competitor={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        onConfirm={async () => {
          if (!confirmDelete) return;
          const id = confirmDelete.id;
          setConfirmDelete(null);
          await handleDelete(id);
        }}
        deleting={confirmDelete !== null && deleting === confirmDelete.id}
      />
    </div>
  );
}

function ConfirmDeleteCompetitorDialog({
  competitor,
  onOpenChange,
  onConfirm,
  deleting,
}: {
  competitor: Competitor | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  const t = useTranslations('competitors');
  const name = competitor?.name ?? '';

  return (
    <Dialog open={competitor !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            {t('confirmDeleteTitle', { name })}
          </DialogTitle>
          <DialogDescription>{t('confirmDeleteDescription', { name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Trash2 className="mr-1.5 h-4 w-4" />
            {t('confirmDeleteAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
