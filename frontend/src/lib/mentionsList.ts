import type { Sentiment } from '@/types';

/**
 * The Mentions tab's table (MS-07): one row per answer naming the brand, as
 * mentions_list (00158) returns them a page at a time, and the table's own
 * controls, kept in the URL beside the page's filters.
 */

export const MENTION_SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export const MENTION_SORTS = ['newest', 'oldest', 'co_mentions', 'negative'] as const;
export const MENTION_GROUPS = ['prompt', 'platform'] as const;

export type MentionSentiment = (typeof MENTION_SENTIMENTS)[number];
export type MentionSort = (typeof MENTION_SORTS)[number];
export type MentionGroup = (typeof MENTION_GROUPS)[number];

/** Answers naming no competitor, in the "Co-mentioned" filter. */
export const NO_COMPETITOR = 'none';

export interface MentionsTableState {
  /** Empty for every sentiment. */
  sentiment: MentionSentiment | '';
  /** A competitor named in the same answer, NO_COMPETITOR, or empty for any. */
  competitor: string;
  sort: MentionSort;
  /** Empty for no grouping. */
  group: MentionGroup | '';
}

export const DEFAULT_MENTIONS_TABLE: MentionsTableState = {
  sentiment: '',
  competitor: '',
  sort: 'newest',
  group: '',
};

/** The table pages at 100 rows (spec §15). */
export const MENTIONS_PAGE_SIZE = 100;

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | '' =>
  value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : '';

export function readMentionsTable(search: URLSearchParams): MentionsTableState {
  return {
    sentiment: pick(search.get('sentiment'), MENTION_SENTIMENTS),
    competitor: search.get('with') ?? '',
    sort: pick(search.get('sort'), MENTION_SORTS) || DEFAULT_MENTIONS_TABLE.sort,
    group: pick(search.get('group'), MENTION_GROUPS),
  };
}

/** The table's query params for writeUrlParams; defaults map to null. */
export function mentionsTableParams(state: MentionsTableState): Record<string, string | null> {
  return {
    sentiment: state.sentiment || null,
    with: state.competitor || null,
    sort: state.sort === DEFAULT_MENTIONS_TABLE.sort ? null : state.sort,
    group: state.group || null,
  };
}

export interface MentionRow {
  /** The answer's id (prompt_results). */
  id: string;
  createdAt: string;
  promptId: string;
  promptText: string;
  topicId: string | null;
  topicName: string | null;
  platform: string;
  model: string | null;
  region: string | null;
  sentiment: Sentiment | null;
  /** Times the brand is named in the answer. */
  occurrences: number;
  /** The brand's place among the brands the answer names (1 = first), and how many it names. */
  position: number | null;
  brandsNamed: number | null;
  /** Competitors named in the same answer, in the order they appear when known. */
  coMentioned: { competitorId: string; name: string; position: number | null }[];
  /** The passage around the brand's first mention. */
  excerpt: string;
  /** With grouping on: the row's group and the group's size over every page. */
  groupKey: string | null;
  groupCount: number | null;
}

export interface MentionsList {
  /** Mentions over every page, and the prompts they answer. */
  total: number;
  prompts: number;
  rows: MentionRow[];
  /** The names the brand is matched by (name and domains), for highlighting. */
  brandTerms: string[];
}

type Raw = Record<string, unknown>;
const num = (value: unknown): number | null =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null
    : Number(value);
const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;
const SENTIMENTS: readonly string[] = MENTION_SENTIMENTS;

/**
 * The function's jsonb as the table's rows, each answer's text cut down to
 * the excerpt by `excerptOf` (the page never receives the full text). Null
 * when there is nothing to read (the caller isn't in the brand's organization).
 */
export function parseMentionsList(
  raw: unknown,
  excerptOf: (response: string) => string,
): Omit<MentionsList, 'brandTerms'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const rows = Array.isArray(r.rows) ? (r.rows as Raw[]) : [];
  return {
    total: num(r.total) ?? 0,
    prompts: num(r.prompts) ?? 0,
    rows: rows.map((row) => ({
      id: String(row.id ?? ''),
      createdAt: String(row.created_at ?? ''),
      promptId: String(row.prompt_id ?? ''),
      promptText: String(row.prompt_text ?? ''),
      topicId: str(row.topic_id),
      topicName: str(row.topic_name),
      platform: String(row.platform ?? ''),
      model: str(row.model_used),
      region: str(row.region),
      sentiment: SENTIMENTS.includes(String(row.sentiment)) ? (row.sentiment as Sentiment) : null,
      occurrences: num(row.mention_count) ?? 0,
      position: num(row.mention_position),
      brandsNamed: num(row.mentioned_entity_count),
      coMentioned: (Array.isArray(row.co_mentioned) ? (row.co_mentioned as Raw[]) : []).map(
        (c) => ({
          competitorId: String(c.competitor_id ?? ''),
          name: String(c.name ?? ''),
          position: num(c.mention_position),
        }),
      ),
      excerpt: excerptOf(typeof row.response === 'string' ? row.response : ''),
      groupKey: str(row.group_key),
      groupCount: num(row.group_count),
    })),
  };
}

/** A correction of an answer's sentiment ("Sentiment is wrong", 00160). */
export interface SentimentOverride {
  sentiment: MentionSentiment;
  previousSentiment: MentionSentiment;
  note: string | null;
  /** As written when the correction was made. */
  userName: string | null;
  createdAt: string;
}

/** A sentiment_overrides row (or the function's `override`) as the page's shape. */
export function parseSentimentOverride(raw: unknown): SentimentOverride | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const tone = (v: unknown): MentionSentiment =>
    SENTIMENTS.includes(String(v)) ? (v as MentionSentiment) : 'neutral';
  return {
    sentiment: tone(r.sentiment),
    previousSentiment: tone(r.previous_sentiment),
    note: str(r.note),
    userName: str(r.user_name),
    createdAt: String(r.created_at ?? ''),
  };
}
