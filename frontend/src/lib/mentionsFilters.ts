import {
  PROMPT_RANGE_PRESETS,
  resolvePromptRange,
  type PromptRangePreset,
} from '@/config/promptOptions';

/**
 * The Mentions & Sentiment page's tab and filters (MS-05). One filter shape is
 * shared by every tab and kept in the URL, so a refresh or a shared link
 * restores the view. The V1.5 Sentiment and V2 Fact-check tabs join this list
 * when they are built.
 */
export const MENTIONS_TABS = ['overview', 'mentions', 'perception'] as const;
export type MentionsTab = (typeof MENTIONS_TABS)[number];

export interface MentionsFilters {
  range: PromptRangePreset;
  /** A custom range's first and last day, `YYYY-MM-DD`; empty otherwise. */
  from: string;
  to: string;
  /** A prompt_results platform id, e.g. `chatgpt-web`; empty for all. */
  platform: string;
  region: string;
  topic: string;
  /** Free text over the prompts' text, the same on every tab. */
  q: string;
}

/** The mockup opens on 30 days. */
export const DEFAULT_MENTIONS_FILTERS: MentionsFilters = {
  range: '30d',
  from: '',
  to: '',
  platform: '',
  region: '',
  topic: '',
  q: '',
};

export const DEFAULT_MENTIONS_TAB: MentionsTab = 'overview';

const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** The tab and filters a query string describes; anything unknown falls back to the default. */
export function readMentionsState(search: URLSearchParams): {
  tab: MentionsTab;
  filters: MentionsFilters;
} {
  const range = pick(search.get('range'), PROMPT_RANGE_PRESETS, DEFAULT_MENTIONS_FILTERS.range);
  const custom = range === 'custom';
  return {
    tab: pick(search.get('tab'), MENTIONS_TABS, DEFAULT_MENTIONS_TAB),
    filters: {
      range,
      from: custom ? (search.get('from') ?? '') : '',
      to: custom ? (search.get('to') ?? '') : '',
      platform: search.get('platform') ?? '',
      region: search.get('region') ?? '',
      topic: search.get('topic') ?? '',
      q: search.get('q') ?? '',
    },
  };
}

/**
 * The query params for a tab and filters, for writeUrlParams: a default or
 * empty value maps to null so the URL stays clean, and custom dates are kept
 * only for a custom range.
 */
export function mentionsStateParams(
  tab: MentionsTab,
  filters: MentionsFilters,
): Record<string, string | null> {
  const custom = filters.range === 'custom';
  const orNull = (value: string) => value || null;
  return {
    tab: tab === DEFAULT_MENTIONS_TAB ? null : tab,
    range: filters.range === DEFAULT_MENTIONS_FILTERS.range ? null : filters.range,
    from: custom ? orNull(filters.from) : null,
    to: custom ? orNull(filters.to) : null,
    platform: orNull(filters.platform),
    region: orNull(filters.region),
    topic: orNull(filters.topic),
    q: orNull(filters.q.trim()),
  };
}

/**
 * The Mentions page's address for a range and filters another page holds
 * (Insights' Mentions and Net sentiment cards link here), so the numbers it
 * opens on are taken over the same days. A range Mentions doesn't offer (All
 * time) opens its default.
 */
export function mentionsHref(f: {
  range: string;
  from?: string;
  to?: string;
  region?: string;
  topic?: string;
}): string {
  const range = (PROMPT_RANGE_PRESETS as readonly string[]).includes(f.range)
    ? (f.range as PromptRangePreset)
    : DEFAULT_MENTIONS_FILTERS.range;
  const params = mentionsStateParams(DEFAULT_MENTIONS_TAB, {
    ...DEFAULT_MENTIONS_FILTERS,
    range,
    from: f.from ?? '',
    to: f.to ?? '',
    region: f.region ?? '',
    topic: f.topic ?? '',
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null) search.set(key, value);
  const query = search.toString();
  return query ? `/dashboard/mentions?${query}` : '/dashboard/mentions';
}

/** What the page's reads take: the window's bounds and the filters. */
export interface MentionsQuery {
  from: string;
  to?: string;
  platform?: string;
  region?: string;
  topicId?: string;
  search?: string;
}

/**
 * The filters as a read, empty filters left out. A custom range's days are
 * UTC days: mentions_overview reads whole UTC days, as Insights does, so in
 * the viewer's zone a viewer west of UTC who picked Oct 1–7 read Oct 2–8,
 * and Insights' card link opened another window (gkhngyk on #1226). Null for
 * a custom range with no dates yet, which is not a window to read.
 */
export function mentionsQuery(filters: MentionsFilters): MentionsQuery | null {
  if (filters.range === 'custom' && !filters.from && !filters.to) return null;
  const range = resolvePromptRange(filters.range, { from: filters.from, to: filters.to }, 'UTC');
  const query: MentionsQuery = { from: range.from };
  if (range.to) query.to = range.to;
  if (filters.platform) query.platform = filters.platform;
  if (filters.region) query.region = filters.region;
  if (filters.topic) query.topicId = filters.topic;
  if (filters.q.trim()) query.search = filters.q.trim();
  return query;
}
