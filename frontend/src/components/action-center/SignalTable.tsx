'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart3,
  Check,
  ChevronRight,
  Eye,
  Gauge,
  Link2,
  MessageSquare,
  MoreHorizontal,
  MousePointerClick,
  RotateCcw,
  Search,
  Sparkles,
  Swords,
  TrendingDown,
  TrendingUp,
  Trophy,
  Unlink,
  X,
  Layers,
  Quote,
  Wrench,
} from 'lucide-react';
import { AIProviderAvatar, type AIProviderKey } from '@/components/AiProviderAvatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Signal } from '@/lib/actions/signals';
import {
  SIGNAL_KINDS,
  type SignalCategory,
  type SignalImpact,
  type SignalKind,
  type SignalSource,
  type SignalStatus,
} from '@/lib/signals/registry';
import { isSuperseded, signalAffected, signalTexts } from '@/lib/signals/display';
import { locationName, platformFamily, platformName } from '@/lib/signals/names';
import type { SignalWhere } from '@/lib/signals/where';
import { groupLead, groupStatus, groupWhere, type SignalGroup } from '@/lib/signals/group';
import { formatRelative } from '@/lib/formatRelative';
import { cn } from '@/lib/utils';

// Kept here for the pages that import it with the table.
export { isSuperseded };

/** Icons for the original kinds. The library's forty-seven take their
 *  category's — a traffic finding reads as traffic whichever detector wrote it. */
export const SIGNAL_ICONS: Partial<
  Record<SignalKind, React.ComponentType<{ className?: string }>>
> = {
  sharp_drop: TrendingDown,
  visibility_slipping: TrendingDown,
  platform_gap: Layers,
  competitor_citation_gap: Quote,
  prompt_gain: TrendingUp,
  new_engine: Sparkles,
  ai_platform_new: Sparkles,
  lost_citations: Unlink,
  first_citation: Link2,
  competitor_surge: Swords,
  competitor_crossed: Swords,
  competitor_overtaken: Trophy,
  page_opportunity: MousePointerClick,
  uncited_mentions: MessageSquare,
  audit_low_score: Gauge,
};

const SOURCE_ICONS: Record<SignalSource, React.ComponentType<{ className?: string }>> = {
  ai_results: Sparkles,
  ga4: BarChart3,
  gsc: Search,
  site_audit: Gauge,
};

/** Data sources as icon + name pairs — icons carry recognition, the text
 *  stays the accessible signal. */
export function SourceList({ sources }: { sources: SignalSource[] }) {
  const t = useTranslations('actionCenter.signalsPage');
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {sources.map((source) => {
        const Icon = SOURCE_ICONS[source];
        return (
          <span key={source} className="flex items-center gap-1 text-xs text-muted-foreground">
            {Icon && <Icon className="h-3 w-3" />}
            {t(`sources.${source}`)}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Impact as the mockup's multi-dot meter. Never color alone: the dots sit
 * beside the impact word, which carries the meaning for assistive tech.
 */
export function ImpactDots({ impact }: { impact: SignalImpact }) {
  const filled = impact === 'high' ? 3 : impact === 'medium' ? 2 : 1;
  const color =
    impact === 'high' ? 'bg-red-500' : impact === 'medium' ? 'bg-amber-500' : 'bg-muted-foreground';
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={cn('h-1.5 w-1.5 rounded-full', i < filled ? color : 'bg-muted')} />
      ))}
    </span>
  );
}

export const STATUS_BADGE: Record<SignalStatus, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  acknowledged: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  resolved: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  dismissed: 'border-border bg-muted/50 text-muted-foreground',
};

const STATE_TEXT: Record<string, string> = {
  dropped: 'text-red-600 dark:text-red-400',
  lost: 'text-red-600 dark:text-red-400',
  crossed: 'text-red-600 dark:text-red-400',
  gain: 'text-red-600 dark:text-red-400',
  gained: 'text-green-600 dark:text-green-400',
  overtaken: 'text-green-600 dark:text-green-400',
  opportunity: 'text-emerald-600 dark:text-emerald-400',
};

export function SignalStatusBadge({
  status,
  superseded = false,
}: {
  status: SignalStatus;
  superseded?: boolean;
}) {
  const t = useTranslations('actionCenter.signalsPage');
  return (
    <Badge variant="outline" className={superseded ? STATUS_BADGE.dismissed : STATUS_BADGE[status]}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {superseded ? t('superseded') : t(`status.${status}`)}
    </Badge>
  );
}

function detectedLabel(iso: string, tCommon: ReturnType<typeof useTranslations>): string {
  return formatRelative(iso, tCommon);
}

/** What a kind without its own icon falls back to. */
const SIGNAL_CATEGORY_ICONS: Record<SignalCategory, React.ComponentType<{ className?: string }>> = {
  visibility: TrendingDown,
  citation: Quote,
  mention: MessageSquare,
  traffic: MousePointerClick,
  technical: Wrench,
  competitor: Swords,
};

export function SignalKindIcon({
  kind,
  category,
  className = 'h-4 w-4 text-muted-foreground',
}: {
  kind: SignalKind;
  category: SignalCategory;
  className?: string;
}) {
  const Icon = SIGNAL_ICONS[kind] ?? SIGNAL_CATEGORY_ICONS[category] ?? BarChart3;
  return <Icon className={className} />;
}

const MAX_PLATFORM_ICONS = 4;
const MAX_LOCATIONS = 2;

/**
 * Where a signal happened (AC-002), as one line under Affected: an icon per
 * engine, then the location codes, with every platform and location named on
 * hover. A line rather than its own column, because the table is already as
 * wide as the page beside a pinned sidebar. Signals about a competitor, a
 * domain or the whole brand have no place of their own and show nothing, and
 * neither does a signal whose one place Affected already names ("Gemini").
 */
export function SignalWhereLine({
  where,
  besides = [],
}: {
  where: SignalWhere;
  /** What the cell already says, so a lone platform or location isn't repeated. */
  besides?: (string | null)[];
}) {
  const t = useTranslations('actionCenter.signalsPage');
  const places = [...where.platforms.map(platformName), ...where.regions.map(locationName)];
  if (places.length === 0 || (places.length === 1 && besides.includes(places[0]))) return null;

  // Engines sharing one icon (the ChatGPT app and its API) show it once.
  const engines = new Map<string, { family: AIProviderKey | null; names: string[] }>();
  for (const slug of where.platforms) {
    const family = platformFamily(slug);
    const key = family ?? slug;
    const entry = engines.get(key) ?? { family, names: [] };
    entry.names.push(platformName(slug));
    engines.set(key, entry);
  }
  const shown = [...engines.entries()].slice(0, MAX_PLATFORM_ICONS);
  const hidden = engines.size - shown.length;
  const platformNames = [...engines.values()].flatMap((engine) => engine.names).join(', ');
  const locationNames = where.regions.map(locationName).join(', ');
  const locations = where.regions.slice(0, MAX_LOCATIONS);
  const label = [
    platformNames && t('where.platforms', { names: platformNames }),
    locationNames && t('where.locations', { names: locationNames }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden" title={label}>
      <span className="sr-only">{label}</span>
      {shown.map(([key, { family, names }]) =>
        family ? (
          <span key={key} aria-hidden="true" className="flex shrink-0">
            <AIProviderAvatar provider={family} className="h-4 w-4 shrink-0" />
          </span>
        ) : (
          <span key={key} aria-hidden="true" className="min-w-0 truncate text-xs">
            {names[0]}
          </span>
        ),
      )}
      {hidden > 0 && (
        <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">
          +{hidden}
        </span>
      )}
      {locations.length > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            'min-w-0 truncate text-xs text-muted-foreground',
            engines.size > 0 && 'ml-1',
          )}
        >
          {locations.join(' · ')}
          {where.regions.length > locations.length &&
            ` +${where.regions.length - locations.length}`}
        </span>
      )}
    </div>
  );
}

/**
 * The row menu: each choice acts on the signals it applies to, so a group's
 * menu resolves its open copies and leaves the resolved ones alone. For one
 * signal it is that signal's own menu.
 */
function SignalMenu({
  signals,
  onStatusChange,
  disabled,
}: {
  signals: Signal[];
  onStatusChange: (signals: Signal[], status: SignalStatus) => void;
  disabled: boolean;
}) {
  const t = useTranslations('actionCenter.signalsPage');
  const fresh = signals.filter((s) => s.status === 'new');
  const open = signals.filter((s) => s.status === 'new' || s.status === 'acknowledged');
  const closed = signals.filter((s) => s.status === 'resolved' || s.status === 'dismissed');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded p-1 text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        aria-label={t('menu.label')}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {fresh.length > 0 && (
          <DropdownMenuItem onClick={() => onStatusChange(fresh, 'acknowledged')}>
            <Eye className="h-4 w-4" />
            {t('menu.acknowledge')}
          </DropdownMenuItem>
        )}
        {open.length > 0 && (
          <>
            <DropdownMenuItem onClick={() => onStatusChange(open, 'resolved')}>
              <Check className="h-4 w-4" />
              {t('menu.resolve')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onStatusChange(open, 'dismissed')}>
              <X className="h-4 w-4" />
              {t('menu.dismiss')}
            </DropdownMenuItem>
          </>
        )}
        {closed.length > 0 && (
          <DropdownMenuItem onClick={() => onStatusChange(closed, 'new')}>
            <RotateCcw className="h-4 w-4" />
            {t('menu.reopen')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DetectedCell({ iso }: { iso: string }) {
  const tCommon = useTranslations('common');
  const detected = new Date(iso);
  return (
    <TableCell>
      <p className="text-xs tabular-nums">
        {detected.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })}
        {', '}
        {detected.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })}
      </p>
      <p className="text-xs text-muted-foreground">{detectedLabel(iso, tCommon)}</p>
    </TableCell>
  );
}

/**
 * The signals list, one row per group (lib/signals/group.ts). A group of
 * copies leads with its newest signal and a "×N grouped" toggle; opened, it
 * lists each copy with the topic and place that tell it apart, and each copy
 * opens its own drawer and keeps its own status.
 */
export function SignalTable({
  groups,
  onSelect,
  onStatusChange,
  busyIds,
  selectedId = null,
}: {
  groups: SignalGroup[];
  onSelect: (signal: Signal) => void;
  onStatusChange: (signals: Signal[], status: SignalStatus) => void;
  busyIds: ReadonlySet<string>;
  /** The signal open in the drawer; its group opens so its row can be seen. */
  selectedId?: string | null;
}) {
  const t = useTranslations('actionCenter.signalsPage');
  const tTexts = useTranslations('actionCenter.signalTexts');
  const tCategories = useTranslations('actionCenter.signalCategories');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // A drawer opened from a link (an action's evidence) can name a copy inside
  // a closed group; open that group once, when the selection arrives.
  const [revealed, setRevealed] = useState<string | null>(null);
  if (selectedId !== revealed) {
    setRevealed(selectedId);
    const holder = groups.find(
      (g) => g.signals.length > 1 && g.signals.some((s) => s.id === selectedId),
    );
    if (holder && !expanded.has(holder.key)) setExpanded(new Set(expanded).add(holder.key));
  }

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const isBusy = (signals: Signal[]) => signals.some((s) => busyIds.has(s.id));

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{t('table.signal')}</TableHead>
            <TableHead className="text-xs">{t('table.type')}</TableHead>
            <TableHead className="text-xs">{t('table.impact')}</TableHead>
            <TableHead className="text-xs">{t('table.source')}</TableHead>
            <TableHead className="text-xs">{t('table.affected')}</TableHead>
            <TableHead className="text-xs">{t('table.detected')}</TableHead>
            <TableHead className="text-xs">{t('table.status')}</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">{t('table.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.flatMap(({ key, signals }) => {
            const lead = signals[0];
            const isGroup = signals.length > 1;
            const isOpen = isGroup && expanded.has(key);
            const texts = signalTexts(isGroup ? groupLead(signals) : lead, tTexts);
            const affected = signalAffected(lead, t);
            const stateKey = SIGNAL_KINDS[lead.kind].stateKey;
            const status = isGroup ? groupStatus(signals) : lead.status;
            const superseded = signals.every(isSuperseded);
            const where = isGroup ? groupWhere(signals) : lead.where;
            // Copies are one prompt text tracked as several prompts.
            const affectedLabel = isGroup
              ? t('affected.prompts', { count: signals.length })
              : affected.label;

            const rows = [
              <TableRow
                key={key}
                className="cursor-pointer"
                onClick={() => (isGroup ? toggle(key) : onSelect(lead))}
              >
                <TableCell className="max-w-[360px]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                      <SignalKindIcon kind={lead.kind} category={lead.category} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{texts.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{texts.description}</p>
                      {isGroup && (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={t('grouped.toggle', { count: signals.length })}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(key);
                          }}
                          className="mt-1 inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <ChevronRight
                            className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-90')}
                            aria-hidden="true"
                          />
                          {t('grouped.badge', { count: signals.length })}
                        </button>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <p className="text-xs font-medium">{tCategories(lead.category)}</p>
                  <p className={cn('text-xs', STATE_TEXT[stateKey] ?? 'text-muted-foreground')}>
                    {t(`states.${stateKey}`)}
                  </p>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">{t(`impact.${lead.impact}`)}</span>
                    <ImpactDots impact={lead.impact} />
                  </div>
                </TableCell>
                <TableCell>
                  <SourceList sources={lead.source} />
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <p className="truncate text-xs font-medium" title={affectedLabel}>
                    {affectedLabel}
                  </p>
                  {affected.detail && (
                    <p className="truncate text-xs text-muted-foreground">{affected.detail}</p>
                  )}
                  <SignalWhereLine where={where} besides={[affectedLabel, affected.detail]} />
                </TableCell>
                <DetectedCell iso={lead.detectedAt} />
                <TableCell>
                  <SignalStatusBadge status={status} superseded={superseded} />
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <SignalMenu
                    signals={signals}
                    onStatusChange={onStatusChange}
                    disabled={isBusy(signals)}
                  />
                </TableCell>
              </TableRow>,
            ];

            if (isOpen) {
              for (const signal of signals) {
                const topic = signal.where.topics[0];
                rows.push(
                  <TableRow
                    key={signal.id}
                    className="cursor-pointer bg-muted/30"
                    onClick={() => onSelect(signal)}
                  >
                    <TableCell className="max-w-[360px]">
                      <p className="truncate pl-11 text-xs">
                        {topic ? t('grouped.topic', { topic }) : t('grouped.noTopic')}
                      </p>
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell className="max-w-[180px]">
                      <SignalWhereLine where={signal.where} />
                    </TableCell>
                    <TableCell />
                    <TableCell>
                      <SignalStatusBadge status={signal.status} superseded={isSuperseded(signal)} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <SignalMenu
                        signals={[signal]}
                        onStatusChange={onStatusChange}
                        disabled={busyIds.has(signal.id)}
                      />
                    </TableCell>
                  </TableRow>,
                );
              }
            }
            return rows;
          })}
        </TableBody>
      </Table>
    </div>
  );
}
