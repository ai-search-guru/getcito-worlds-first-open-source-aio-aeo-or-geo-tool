'use client';

/**
 * Shared filter bar for citation surfaces: the Citations overview and the
 * per-URL citation detail page (#535). Owns the UI filter shape, the
 * date-preset → date-range resolution and the platform grouping so both
 * pages scope their data with identical semantics.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { Topic } from '@/types';
import { cn } from '@/lib/utils';
import type { CitationsDatePreset } from '@/lib/actions/citations';
import { modelLabel } from '@/lib/modelFamilies';
import { DateRangeFilter } from '@/components/filters/DateRangeFilter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox';

export const DATE_PRESETS: CitationsDatePreset[] = ['24h', '7d', '30d', '90d', 'all', 'custom'];

export interface CitationsUIFilters {
  datePreset: CitationsDatePreset;
  dateFrom: string;
  dateTo: string;
  platform: string;
  region: string;
  topic: string;
  prompt: string;
  sourceScope: 'all' | 'third_party' | 'competitors' | 'own';
}

export const DEFAULT_CITATIONS_FILTERS: CitationsUIFilters = {
  datePreset: '24h',
  dateFrom: '',
  dateTo: '',
  platform: '',
  region: '',
  topic: '',
  prompt: '',
  sourceScope: 'own',
};

export type SourceScope = CitationsUIFilters['sourceScope'];

const SOURCE_SCOPES: { value: SourceScope; label: string }[] = [
  { value: 'own', label: 'Brand' },
  { value: 'competitors', label: 'Competitors' },
  { value: 'third_party', label: 'Third-Party' },
  { value: 'all', label: 'All' },
];

/**
 * Which sources the table below covers.
 *
 * It belongs with the table rather than in the filter bar, because it scopes
 * only that table: the KPIs above count every citation whatever this says, and
 * Competitor Gaps and Source Types ignore it outright. Sitting among the
 * page-wide filters it read as another one of them, and as a dropdown whose
 * value defaulted to "All" the trigger was the only label on screen — the word
 * "All" with nothing saying all of what.
 *
 * Shaped like the date-range control it now sits near, so the two read as the
 * same kind of choice.
 */
export function SourceScopeFilter({
  value,
  onChange,
  className,
}: {
  value: SourceScope;
  onChange: (scope: SourceScope) => void;
  className?: string;
}) {
  const t = useTranslations('common');
  const scopeLabel: Record<SourceScope, string> = {
    all: t('sourceAll'),
    own: t('sourceBrand'),
    competitors: t('sourceCompetitors'),
    third_party: t('sourceThirdParty'),
  };
  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="group" aria-label={t('sources')}>
      {SOURCE_SCOPES.map((scope) => (
        <button
          key={scope.value}
          type="button"
          onClick={() => onChange(scope.value)}
          aria-pressed={value === scope.value}
          className={cn(
            'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
            value === scope.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'bg-card text-foreground hover:bg-muted',
          )}
        >
          {scopeLabel[scope.value]}
        </button>
      ))}
    </div>
  );
}

export interface PromptOption {
  id: string;
  text: string;
}

// base-ui's Combobox auto-uses `label` for display and `value` for selection
// when items are `{ value, label }` shaped — no extra helpers needed.
interface PromptComboboxItem {
  value: string;
  label: string;
  /** Untruncated prompt text, shown as a native tooltip on hover (#298). */
  fullText: string;
}

export interface PlatformOption {
  value: string;
  label: string;
}

/** The name a model slug is shown by, as Brand Visibility's filter names it. */
export function getPlatformDisplayLabel(slug: string): string {
  return modelLabel(slug);
}

export function getGroupedPlatformLabel(value: string): string {
  const firstSlug = value
    .split(',')
    .map((slug) => slug.trim())
    .find(Boolean);
  return firstSlug ? getPlatformDisplayLabel(firstSlug) : value;
}

/**
 * Group observed model slugs into provider-family options (one dropdown entry
 * per display label, value = comma-joined slugs of the family).
 */
export function buildPlatformOptions(rows: { models: string[] }[]): PlatformOption[] {
  const slugToLabel = new Map<string, string>();
  for (const row of rows) {
    for (const slug of row.models) {
      if (!slug || slugToLabel.has(slug)) continue;
      slugToLabel.set(slug, getPlatformDisplayLabel(slug));
    }
  }

  const familyToSlugs = new Map<string, string[]>();
  for (const [slug, label] of slugToLabel) {
    const slugs = familyToSlugs.get(label) ?? [];
    slugs.push(slug);
    familyToSlugs.set(label, slugs);
  }

  return Array.from(familyToSlugs.entries())
    .map(([label, slugs]) => ({
      label,
      value: slugs.sort().join(','),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

/** Resolve a date preset (+ custom range) into API date bounds. */
export function getDateRange(
  preset: CitationsDatePreset,
  custom: { from: string; to: string },
): { dateFrom?: string; dateTo?: string } {
  if (preset === 'all') return {};
  if (preset === 'custom') {
    return {
      dateFrom: custom.from || undefined,
      dateTo: custom.to ? `${custom.to}T23:59:59.999Z` : undefined,
    };
  }
  if (preset === '24h') {
    const from = new Date();
    from.setHours(from.getHours() - 24);
    return { dateFrom: from.toISOString() };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { dateFrom: from.toISOString() };
}

/**
 * Href for the per-URL citation detail page, carrying the current scoping
 * filters so the detail page opens with the same window applied (#535).
 */
export function buildCitationDetailHref(
  url: string,
  filters?: Partial<CitationsUIFilters>,
): string {
  const params = new URLSearchParams({ u: url });
  if (filters?.datePreset && filters.datePreset !== DEFAULT_CITATIONS_FILTERS.datePreset) {
    params.set('preset', filters.datePreset);
  }
  if (filters?.datePreset === 'custom') {
    if (filters.dateFrom) params.set('from', filters.dateFrom);
    if (filters.dateTo) params.set('to', filters.dateTo);
  }
  if (filters?.platform) params.set('platform', filters.platform);
  if (filters?.region) params.set('region', filters.region);
  return `/dashboard/citations/url?${params.toString()}`;
}

export function CitationsFilterBar({
  filters,
  onChange,
  topics = [],
  prompts = [],
  platforms,
  regions,
}: {
  filters: CitationsUIFilters;
  onChange: (patch: Partial<CitationsUIFilters>) => void;
  topics?: Topic[];
  prompts?: PromptOption[];
  platforms: PlatformOption[];
  regions: string[];
}) {
  // base-ui Combobox needs `{ value, label }` shaped items so it can use the
  // built-in filter and display logic without custom item-to-string helpers.
  // Truncate long prompt text so the dropdown stays a sensible width.
  const t = useTranslations('common');
  const promptComboboxItems = useMemo<PromptComboboxItem[]>(
    () =>
      prompts.map((p) => ({
        value: p.id,
        // Let the combobox's CSS `truncate` handle visual overflow; keep the
        // full text for the hover tooltip instead of slicing it away (#298).
        label: p.text,
        fullText: p.text,
      })),
    [prompts],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <DateRangeFilter
        value={filters.datePreset}
        presets={DATE_PRESETS}
        onChange={(datePreset) => onChange({ datePreset })}
        from={filters.dateFrom}
        to={filters.dateTo}
        onFromChange={(dateFrom) => onChange({ dateFrom })}
        onToChange={(dateTo) => onChange({ dateTo })}
      />

      {topics.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t('topic')}
          </label>
          <Select
            value={filters.topic || null}
            onValueChange={(v) => onChange({ topic: !v || v === '__all__' ? '' : v })}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder={t('allTopics')}>
                {(value) =>
                  value && value !== '__all__'
                    ? (topics.find((t) => t.id === value)?.name ?? t('allTopics'))
                    : t('allTopics')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('allTopics')}</SelectItem>
              {topics.map((topic) => (
                <SelectItem key={topic.id} value={topic.id}>
                  {topic.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {prompts.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t('prompt')}
          </label>
          <Combobox
            items={promptComboboxItems}
            value={
              filters.prompt
                ? (promptComboboxItems.find((item) => item.value === filters.prompt) ?? null)
                : null
            }
            onValueChange={(item: PromptComboboxItem | null) =>
              onChange({
                prompt: !item || item.value === '__all__' ? '' : item.value,
              })
            }
          >
            <ComboboxTrigger className="h-8 w-56 text-xs">
              <ComboboxValue placeholder={t('allPrompts')} />
            </ComboboxTrigger>
            <ComboboxContent>
              <ComboboxInput placeholder={t('searchPrompts')} />
              <ComboboxList>
                <ComboboxEmpty>{t('noPromptsMatch')}</ComboboxEmpty>
                <ComboboxCollection>
                  {(item: PromptComboboxItem) => (
                    <ComboboxItem key={item.value} value={item} title={item.fullText}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('platform')}
        </label>
        <Select
          value={filters.platform || null}
          onValueChange={(v) => onChange({ platform: !v || v === '__all__' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder={t('allPlatforms')}>
              {(value) =>
                value && value !== '__all__'
                  ? (platforms.find((platform) => platform.value === value)?.label ??
                    getGroupedPlatformLabel(value))
                  : t('allPlatforms')
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('allPlatforms')}</SelectItem>
            {platforms.map((platform) => (
              <SelectItem key={platform.value} value={platform.value}>
                {platform.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('region')}
        </label>
        <Select
          value={filters.region || null}
          onValueChange={(v) => onChange({ region: !v || v === '__all__' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder={t('allRegions')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('allRegions')}</SelectItem>
            {regions.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
