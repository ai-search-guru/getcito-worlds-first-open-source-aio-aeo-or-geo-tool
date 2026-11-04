'use client';

import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { DateRangeFilter } from '@/components/filters/DateRangeFilter';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PROMPT_RANGE_PRESETS } from '@/config/promptOptions';
import { POSITION_PLATFORMS } from '@/lib/promptPositions';
import { formatRegionDisplay } from '@/lib/region';
import type { MentionsFilters } from '@/lib/mentionsFilters';
import type { Topic } from '@/types';

const ALL = '__all__';

/**
 * The filter bar every Mentions & Sentiment tab shares (MS-05): the date
 * range, AI platform, country, topic and a search over the prompts' text.
 * The brand is the app's active brand, chosen in the sidebar. A tab may word
 * the search its own way (Perception: "Search keywords…"); it still matches
 * the prompts' text.
 */
export function MentionsFilterBar({
  filters,
  onChange,
  regions,
  topics,
  searchPlaceholder,
}: {
  filters: MentionsFilters;
  onChange: (patch: Partial<MentionsFilters>) => void;
  regions: string[];
  topics: Topic[];
  /** The search box's hint; "Search prompts…" when not given. */
  searchPlaceholder?: string;
}) {
  const t = useTranslations('mentions.filters');
  const platformItems = [
    { value: ALL, label: t('allPlatforms') },
    ...POSITION_PLATFORMS.map((p) => ({ value: p.id as string, label: p.label as string })),
  ];
  const regionItems = [
    { value: ALL, label: t('allCountries') },
    ...regions.map((r) => ({ value: r, label: formatRegionDisplay(r) })),
  ];
  const topicItems = [
    { value: ALL, label: t('allTopics') },
    ...topics.map((topic) => ({ value: topic.id, label: topic.name })),
  ];
  const pick = (v: string | null) => (!v || v === ALL ? '' : v);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <DateRangeFilter
        value={filters.range}
        presets={PROMPT_RANGE_PRESETS}
        onChange={(range) => onChange({ range })}
        from={filters.from}
        to={filters.to}
        onFromChange={(from) => onChange({ from })}
        onToChange={(to) => onChange({ to })}
      />

      <FilterSelect
        label={t('platform')}
        value={filters.platform || ALL}
        items={platformItems}
        onChange={(v) => onChange({ platform: pick(v) })}
        className="w-44"
      />
      {regions.length > 1 && (
        <FilterSelect
          label={t('country')}
          value={filters.region || ALL}
          items={regionItems}
          onChange={(v) => onChange({ region: pick(v) })}
          className="w-44"
        />
      )}
      {topics.length > 0 && (
        <FilterSelect
          label={t('topic')}
          value={filters.topic || ALL}
          items={topicItems}
          onChange={(v) => onChange({ topic: pick(v) })}
          className="w-44"
        />
      )}

      <div className="min-w-48 flex-1">
        <label
          htmlFor="mentions-search"
          className="mb-1.5 block text-xs font-medium text-muted-foreground"
        >
          {t('search')}
        </label>
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            id="mentions-search"
            value={filters.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder={searchPlaceholder ?? t('searchPlaceholder')}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  items,
  onChange,
  className,
}: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string | null) => void;
  className?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={(v) => onChange(v as string | null)} items={items}>
        <SelectTrigger className={`h-8 text-xs ${className ?? ''}`} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
