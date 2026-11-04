import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { mayUseBrand } from './data';
import { expandDateToEndOfDay } from '@/lib/dates';
import { mentionExcerpt } from '@/lib/mentionMatch';
import {
  mentionPlatformLabel,
  mentionsHeadline,
  platformNetChange,
  wholeNet,
} from '@/lib/mentionsHeadline';
import {
  MENTION_SENTIMENTS,
  MENTION_SORTS,
  MENTIONS_PAGE_SIZE,
  parseMentionsList,
  parseSentimentOverride,
  type MentionRow,
  type MentionSentiment,
  type MentionSort,
  type SentimentOverride,
} from '@/lib/mentionsList';
import {
  averagePosition,
  changeBasis,
  isLowSample,
  LOW_SAMPLE_MENTIONS,
  mentionRate,
  mentionTrend,
  parseMentionsOverview,
  relativeChange,
  sentimentSplit,
  type MentionTotals,
  type MentionsOverview,
} from '@/lib/mentionsOverview';
import {
  attributeShares,
  biggestGap,
  parseMentionsPerception,
  shareOf,
  type PerceptionGap,
} from '@/lib/mentionsPerception';
import type { Citation } from '@/types';

/**
 * Mentions & Sentiment over the API and MCP (MS-13): the page's figures for a
 * brand, under the filters the page takes (window, platform, country, topic,
 * prompt search), for AI Agent Chat and other clients to answer "why did
 * sentiment drop on Gemini?". Each function checks the brand is the API key's
 * organization's, then reads through the page's own database functions as the
 * service role (00157, 00158 and 00161 let it through), so the numbers are
 * the dashboard's. No LLM is called.
 */

/** The page opens on 30 days, and so does a read without date_from. */
export const MENTIONS_DEFAULT_DAYS = 30;

export interface MentionsFilterParams {
  brandId: string;
  /** ISO timestamps; a date_to of `YYYY-MM-DD` covers that whole day. */
  dateFrom?: string;
  dateTo?: string;
  /** A prompt_results platform id, e.g. `gemini-web`. */
  platform?: string;
  region?: string;
  topicId?: string;
  /** Matched against the prompts' text, as the page's search box. */
  search?: string;
}

/** The filters every /api/mcp/mentions endpoint reads from its query string. */
export function mentionsFiltersFromUrl(url: URL): MentionsFilterParams | null {
  const q = url.searchParams;
  const brandId = q.get('brand_id');
  if (!brandId) return null;
  return {
    brandId,
    dateFrom: q.get('date_from') ?? undefined,
    dateTo: q.get('date_to') ?? undefined,
    platform: q.get('platform') ?? undefined,
    region: q.get('region') ?? undefined,
    topicId: q.get('topic_id') ?? undefined,
    search: q.get('search') ?? undefined,
  };
}

function filterArgs(p: MentionsFilterParams, now = Date.now()) {
  return {
    p_brand_id: p.brandId,
    p_date_from: p.dateFrom || new Date(now - MENTIONS_DEFAULT_DAYS * 86_400_000).toISOString(),
    p_date_to: expandDateToEndOfDay(p.dateTo),
    p_platform: p.platform || undefined,
    p_region: p.region || undefined,
    p_topic_id: p.topicId || undefined,
    p_search: p.search?.trim() || undefined,
  };
}

interface OwnedBrand {
  id: string;
  name: string;
  /** The names tracking matches the brand by: its name and domains. */
  terms: string[];
}

/**
 * The brand, when it belongs to the key's organization and its owner may use
 * it; null otherwise. The Mentions functions (00434) run with the service
 * role here, which they don't check, so every read asks this first.
 */
async function ownedBrand(auth: McpAuthContext, brandId: string): Promise<OwnedBrand | null> {
  if (!auth.organizationId) return null;
  const { data } = await supabaseAdmin
    .from('brands')
    .select('id, name, brand_domains(domain)')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!data || !(await mayUseBrand(auth, data.id))) return null;
  const row = data as { id: string; name: string; brand_domains?: { domain?: string }[] };
  return {
    id: row.id,
    name: row.name,
    terms: [row.name, ...(row.brand_domains ?? []).map((d) => d.domain ?? '')].filter(Boolean),
  };
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const whole = (n: number | null) => (n === null ? null : Math.round(n));

export interface MentionFigures {
  trackedResponses: number;
  /** Responses naming the brand at least once. */
  mentions: number;
  /** mentions ÷ trackedResponses, in percent (one decimal); null with no responses. */
  mentionRate: number | null;
  /** Times the brand is named over all responses. */
  timesNamed: number;
  trackedPrompts: number;
  promptsWithMentions: number;
  /** The brand's average place among the brands an answer names (1 = first). */
  averagePosition: number | null;
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
    /** Shares of the mentions, in whole percent; null with no mentions. */
    positivePct: number | null;
    neutralPct: number | null;
    negativePct: number | null;
    /** positivePct − negativePct, −100…+100; null with no mentions. */
    net: number | null;
    /** n under 20: quote the figure as a low sample and read no change into it. */
    lowSample: boolean;
  };
}

function figures(t: MentionTotals): MentionFigures {
  const split = sentimentSplit(t);
  return {
    trackedResponses: t.answers,
    mentions: t.mentions,
    mentionRate: round1(mentionRate(t)),
    timesNamed: t.occurrences,
    trackedPrompts: t.prompts,
    promptsWithMentions: t.promptsWithMentions,
    averagePosition: round1(averagePosition(t)),
    sentiment: {
      positive: t.positive,
      neutral: Math.max(0, t.mentions - t.positive - t.negative),
      negative: t.negative,
      positivePct: whole(split?.positive ?? null),
      neutralPct: whole(split?.neutral ?? null),
      negativePct: whole(split?.negative ?? null),
      net: wholeNet(t),
      lowSample: isLowSample(t),
    },
  };
}

export interface MentionsSummary {
  brand: { id: string; name: string };
  /** The window read, and the one of the same length before it that `previous` covers. */
  window: MentionsOverview['window'];
  current: MentionFigures;
  previous: MentionFigures;
  /**
   * Each change as the page's cards take it (00195): on the prompts both
   * windows answered (`basis`), while the figures above are the whole windows'.
   */
  changes: {
    /** Total mentions (times named, as the page counts them) against before, in percent; null with none before. */
    mentionsPct: number | null;
    /** Mention rate's change in points; null when a window has under 20 responses, as on the page's card. */
    mentionRatePoints: number | null;
    /** Prompts with mentions against before, in percent; null with none before. */
    promptsWithMentionsPct: number | null;
    /** Net sentiment's change in points; null when a window is a low sample. */
    netSentimentPoints: number | null;
    /** The prompts both windows answered, and those left out of every change; null before 00195. */
    basis: { sharedPrompts: number; newPrompts: number; droppedPrompts: number } | null;
  };
  /** What the page's summary line says: the platform that moved the net most, and who AI names beside you. */
  headline: {
    mover: { platform: string; label: string; change: number } | null;
    companions: string[];
  };
  platforms: Array<{
    platform: string;
    label: string;
    trackedResponses: number;
    mentions: number;
    /** Times named on the platform. */
    timesNamed: number;
    mentionRate: number | null;
    netSentiment: number | null;
    /** Against the window before; null when either has under 20 mentions. */
    netSentimentChange: number | null;
    lowSample: boolean;
  }>;
  daily: Array<{
    day: string;
    trackedResponses: number;
    mentions: number;
    /** Times named that day: the page's Mentions line. */
    timesNamed: number;
    mentionRate: number | null;
    netSentiment: number | null;
  }>;
}

async function readOverview(p: MentionsFilterParams): Promise<MentionsOverview | null> {
  const { data, error } = await supabaseAdmin.rpc('mentions_overview', filterArgs(p));
  if (error) throw new Error(error.message);
  return parseMentionsOverview(data);
}

/**
 * The Overview's figures (get_mentions_summary): totals now and before, the
 * changes the page shows (none read into a low sample), the summary line's
 * facts, each platform, and the days. Null when the brand isn't the key's.
 */
export async function getMentionsSummaryFor(
  auth: McpAuthContext,
  params: MentionsFilterParams,
): Promise<MentionsSummary | null> {
  const brand = await ownedBrand(auth, params.brandId);
  if (!brand) return null;
  const o = await readOverview(params);
  if (!o) return null;

  const { current: cur, previous: prev } = o;
  // As the page's cards: every change on the prompts both windows answered,
  // and none read from or into a window under the floor.
  const { current: base, previous: before } = changeBasis(o);
  const rate = mentionRate(cur);
  const baseRate = mentionRate(base);
  const beforeRate = mentionRate(before);
  const rateChangeLow =
    cur.answers < LOW_SAMPLE_MENTIONS ||
    base.answers < LOW_SAMPLE_MENTIONS ||
    before.answers < LOW_SAMPLE_MENTIONS;
  const headline = mentionsHeadline(o);

  return {
    brand: { id: brand.id, name: brand.name },
    window: o.window,
    current: figures(cur),
    previous: figures(prev),
    changes: {
      mentionsPct: whole(relativeChange(base.occurrences, before.occurrences)),
      mentionRatePoints:
        rateChangeLow || rate === null || baseRate === null || beforeRate === null
          ? null
          : round1(baseRate - beforeRate),
      promptsWithMentionsPct: whole(
        relativeChange(base.promptsWithMentions, before.promptsWithMentions),
      ),
      netSentimentPoints: headline.netChange,
      basis: o.same
        ? {
            sharedPrompts: o.same.prompts,
            newPrompts: o.same.newPrompts,
            droppedPrompts: o.same.droppedPrompts,
          }
        : null,
    },
    headline: {
      mover: headline.mover
        ? { ...headline.mover, label: mentionPlatformLabel(headline.mover.platform) }
        : null,
      companions: headline.companions,
    },
    platforms: o.platforms.map((row) => ({
      platform: row.platform,
      label: mentionPlatformLabel(row.platform),
      trackedResponses: row.answers,
      mentions: row.mentions,
      timesNamed: row.occurrences,
      mentionRate: round1(mentionRate(row)),
      netSentiment: wholeNet(row),
      netSentimentChange: platformNetChange(row),
      lowSample: isLowSample(row),
    })),
    daily: mentionTrend(o).map((d) => ({
      day: d.day,
      trackedResponses: d.answers,
      mentions: d.mentions,
      timesNamed: d.occurrences,
      mentionRate: round1(d.rate),
      netSentiment: whole(d.net),
    })),
  };
}

export interface MentionCompetitors {
  brand: { id: string; name: string; mentions: number; shareOfResponses: number | null };
  trackedResponses: number;
  /** Most mentioned first. Sentiment is measured for your brand only (V1). */
  competitors: Array<{
    competitorId: string;
    name: string;
    /** Responses naming the competitor, and its share of the tracked responses (%). */
    mentions: number;
    shareOfResponses: number | null;
    /** Of those, the responses naming your brand too. */
    sameResponseAsYou: number;
    previousMentions: number;
    /** Against the window before, in percent; null with none before. */
    mentionsChangePct: number | null;
  }>;
}

/**
 * The Overview's competitor framing (get_mention_competitors): how often AI
 * names each competitor in the brand's tracked responses, and how often in the
 * same response as the brand.
 */
export async function getMentionCompetitorsFor(
  auth: McpAuthContext,
  params: MentionsFilterParams,
): Promise<MentionCompetitors | null> {
  const brand = await ownedBrand(auth, params.brandId);
  if (!brand) return null;
  const o = await readOverview(params);
  if (!o) return null;
  const answers = o.current.answers;
  const share = (n: number) => round1(answers > 0 ? (n * 100) / answers : null);
  return {
    brand: {
      id: brand.id,
      name: brand.name,
      mentions: o.current.mentions,
      shareOfResponses: share(o.current.mentions),
    },
    trackedResponses: answers,
    competitors: [...o.competitors]
      .sort((a, b) => b.mentions - a.mentions)
      .map((c) => ({
        competitorId: c.competitorId,
        name: c.name,
        mentions: c.mentions,
        shareOfResponses: share(c.mentions),
        sameResponseAsYou: c.coMentions,
        previousMentions: c.previousMentions,
        mentionsChangePct: whole(relativeChange(c.mentions, c.previousMentions)),
      })),
  };
}

export interface MentionListParams extends MentionsFilterParams {
  sentiment?: MentionSentiment;
  /** A competitor named in the same response, or `none` for responses naming none. */
  competitorId?: string;
  sort?: MentionSort;
  /** 1-based, 100 rows a page. */
  page?: number;
}

export interface MentionListItem {
  /** The answer's id: pass it to get_mention or override_mention_sentiment. */
  id: string;
  createdAt: string;
  prompt: string;
  promptId: string;
  topic: string | null;
  platform: string;
  platformLabel: string;
  model: string | null;
  region: string | null;
  sentiment: MentionSentiment | null;
  timesNamed: number;
  position: number | null;
  brandsNamed: number | null;
  coMentioned: string[];
  /** The passage around the brand's first mention. */
  excerpt: string;
}

export interface MentionList {
  total: number;
  prompts: number;
  page: number;
  pageSize: number;
  mentions: MentionListItem[];
}

export function isMentionSentiment(value: unknown): value is MentionSentiment {
  return (MENTION_SENTIMENTS as readonly unknown[]).includes(value);
}

export function isMentionSort(value: unknown): value is MentionSort {
  return (MENTION_SORTS as readonly unknown[]).includes(value);
}

function listItem(row: MentionRow): MentionListItem {
  return {
    id: row.id,
    createdAt: row.createdAt,
    prompt: row.promptText,
    promptId: row.promptId,
    topic: row.topicName,
    platform: row.platform,
    platformLabel: mentionPlatformLabel(row.platform),
    model: row.model,
    region: row.region,
    sentiment: row.sentiment,
    timesNamed: row.occurrences,
    position: row.position,
    brandsNamed: row.brandsNamed,
    coMentioned: row.coMentioned.map((c) => c.name),
    excerpt: row.excerpt,
  };
}

/**
 * The Mentions tab's table (list_mentions): the responses naming the brand,
 * 100 a page, with the table's filters and sorts, each cut to its excerpt.
 */
export async function listMentionsFor(
  auth: McpAuthContext,
  params: MentionListParams,
): Promise<MentionList | null> {
  const brand = await ownedBrand(auth, params.brandId);
  if (!brand) return null;
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const { data, error } = await supabaseAdmin.rpc('mentions_list', {
    ...filterArgs(params),
    p_sentiment: params.sentiment,
    p_competitor_id: params.competitorId || undefined,
    p_sort: params.sort ?? 'newest',
    p_limit: MENTIONS_PAGE_SIZE,
    p_offset: (page - 1) * MENTIONS_PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  const list = parseMentionsList(data, (response) => mentionExcerpt(response, brand.terms));
  if (!list) return null;
  return {
    total: list.total,
    prompts: list.prompts,
    page,
    pageSize: MENTIONS_PAGE_SIZE,
    mentions: list.rows.map(listItem),
  };
}

export interface MentionDetail {
  id: string;
  brandId: string;
  createdAt: string;
  prompt: string | null;
  platform: string;
  platformLabel: string;
  model: string | null;
  region: string | null;
  sentiment: MentionSentiment | null;
  timesNamed: number;
  position: number | null;
  brandsNamed: number | null;
  competitorsNamed: string[];
  /** The full stored response. */
  response: string;
  citations: Citation[];
  /** The latest "Sentiment is wrong" correction, if any. */
  sentimentOverride: SentimentOverride | null;
}

interface ResultRow {
  id: string;
  brand_id: string;
  created_at: string;
  platform: string;
  model_used: string | null;
  region: string | null;
  sentiment: string | null;
  mention_count: number | null;
  mention_position: number | null;
  mentioned_entity_count: number | null;
  competitor_mentions: unknown;
  response: string | null;
  citations: unknown;
  prompts: { text?: string } | null;
  brands: { organization_id?: string } | null;
}

interface StoredCompetitorMention {
  competitor_id?: string;
  name?: string;
  mention_count?: number;
  mention_position?: number | null;
}

/**
 * The competitors an answer names, as the Mentions table lists them
 * (mentions_list, 00158): each by its current name, the name stored at
 * tracking time when it has none, in the order the answer names them.
 */
async function competitorsNamed(row: ResultRow): Promise<string[]> {
  const named = (
    Array.isArray(row.competitor_mentions)
      ? (row.competitor_mentions as StoredCompetitorMention[])
      : []
  ).filter((c) => c.competitor_id && (c.mention_count ?? 0) > 0);
  if (named.length === 0) return [];
  const { data } = await supabaseAdmin
    .from('competitors')
    .select('id, name')
    .eq('brand_id', row.brand_id)
    .in(
      'id',
      named.map((c) => String(c.competitor_id)),
    );
  const current = new Map(
    ((data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  return named
    .map((c) => ({
      name: current.get(String(c.competitor_id)) ?? String(c.name ?? ''),
      position: c.mention_position ?? Number.POSITIVE_INFINITY,
    }))
    .filter((c) => c.name)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((c) => c.name);
}

/**
 * One response in full (get_mention): the stored text, its citations, the
 * competitors it names and its latest sentiment correction, as the page's
 * response drawer shows it. Null unless the answer's brand is the key's.
 */
export async function getMentionFor(
  auth: McpAuthContext,
  resultId: string,
): Promise<MentionDetail | null> {
  if (!auth.organizationId) return null;
  const [answer, correction] = await Promise.all([
    supabaseAdmin
      .from('prompt_results')
      .select(
        'id, brand_id, created_at, platform, model_used, region, sentiment, mention_count, ' +
          'mention_position, mentioned_entity_count, competitor_mentions, response, citations, ' +
          'prompts(text), brands!inner(organization_id)',
      )
      .eq('id', resultId)
      .eq('brands.organization_id', auth.organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('sentiment_overrides')
      .select('sentiment, previous_sentiment, note, user_name, created_at')
      .eq('result_id', resultId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (answer.error) throw new Error(answer.error.message);
  const row = answer.data as unknown as ResultRow | null;
  if (!row || row.brands?.organization_id !== auth.organizationId) return null;
  if (!(await mayUseBrand(auth, row.brand_id))) return null;

  return {
    id: row.id,
    brandId: row.brand_id,
    createdAt: row.created_at,
    prompt: row.prompts?.text ?? null,
    platform: row.platform,
    platformLabel: mentionPlatformLabel(row.platform),
    model: row.model_used,
    region: row.region,
    sentiment: isMentionSentiment(row.sentiment) ? row.sentiment : null,
    timesNamed: row.mention_count ?? 0,
    position: row.mention_position,
    brandsNamed: row.mentioned_entity_count,
    competitorsNamed: await competitorsNamed(row),
    response: row.response ?? '',
    citations: Array.isArray(row.citations) ? (row.citations as Citation[]) : [],
    // A missing table (a database before 00160) reads as no correction.
    sentimentOverride: correction.error ? null : parseSentimentOverride(correction.data),
  };
}

export interface MentionsPerceptionResult {
  brand: { id: string; name: string };
  window: { from: string; to: string; days: number };
  /** The brand first, then up to four competitors by mentions, now and before. */
  entities: Array<{
    entity: string;
    name: string;
    isBrand: boolean;
    mentions: number;
    previousMentions: number;
  }>;
  /** What AI says next to the brand: responses with the term, their share of the brand's mentions, and before. */
  brandTerms: Array<{
    term: string;
    responses: number;
    sharePct: number | null;
    previousResponses: number;
  }>;
  /** Each attribute's share of each entity's mentions (%), in `entities` order; null without mentions. */
  attributes: Array<{ term: string; sharePct: (number | null)[] }>;
  /** Competitors named in the same responses as the brand, now and before. */
  coMentions: Array<{
    competitorId: string;
    name: string;
    responses: number;
    previousResponses: number;
  }>;
  /** The attribute a competitor leads by 20+ points, over 20+ mentions each; null when none. */
  biggestGap: PerceptionGap | null;
}

/**
 * The Perception tab (get_mentions_perception): terms found by rule in the
 * sentences that name each brand (no LLM), the attributes that tell the brand
 * and its competitors apart, co-mentions, and the biggest gap.
 */
export async function getMentionsPerceptionFor(
  auth: McpAuthContext,
  params: MentionsFilterParams,
): Promise<MentionsPerceptionResult | null> {
  const brand = await ownedBrand(auth, params.brandId);
  if (!brand) return null;
  const { data, error } = await supabaseAdmin.rpc('mentions_perception', filterArgs(params));
  if (error) throw new Error(error.message);
  const p = parseMentionsPerception(data);
  if (!p) return null;
  const brandMentions = p.entities.find((e) => e.isBrand)?.mentions ?? 0;
  return {
    brand: { id: brand.id, name: brand.name },
    window: p.window,
    entities: p.entities,
    brandTerms: p.brandTerms.map((t) => ({
      term: t.term,
      responses: t.answers,
      sharePct: whole(shareOf(t.answers, brandMentions)),
      previousResponses: t.previousAnswers,
    })),
    attributes: attributeShares(p).map((a) => ({
      term: a.term,
      sharePct: a.shares.map((s) => whole(s)),
    })),
    coMentions: p.coMentions.map((c) => ({
      competitorId: c.competitorId,
      name: c.name,
      responses: c.coMentions,
      previousResponses: c.previousCoMentions,
    })),
    biggestGap: biggestGap(p),
  };
}

export type MentionOverrideResult =
  | {
      changed: boolean;
      previous: MentionSentiment | null;
      sentiment: MentionSentiment;
      override: SentimentOverride | null;
    }
  | { error: 'forbidden' | 'invalid' | 'missing'; message: string };

/**
 * "Sentiment is wrong" (override_mention_sentiment): sets a response's tone
 * toward the brand, as the API key's owner, who must be an admin or manager
 * of the brand's organization (00223). The answer's day is refreshed in the
 * rollups at once, and the correction is kept with its note.
 */
export async function overrideMentionSentimentFor(
  auth: McpAuthContext,
  resultId: string,
  sentiment: MentionSentiment,
  note?: string,
): Promise<MentionOverrideResult> {
  // An answer of another organization, or of a brand the owner may not use, reads as missing.
  if (!auth.organizationId) return { error: 'missing', message: 'Answer not found' };
  const { data: owned, error: ownedError } = await supabaseAdmin
    .from('prompt_results')
    .select('id, brand_id, brands!inner(organization_id)')
    .eq('id', resultId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (ownedError) throw new Error(ownedError.message);
  if (!owned || !(await mayUseBrand(auth, owned.brand_id))) {
    return { error: 'missing', message: 'Answer not found' };
  }

  const { data, error } = await supabaseAdmin.rpc('override_mention_sentiment', {
    p_result_id: resultId,
    p_sentiment: sentiment,
    p_note: note?.trim() || undefined,
    p_user_id: auth.userId,
  });
  if (error) {
    if (error.code === '42501') return { error: 'forbidden', message: error.message };
    if (error.code === '22023') return { error: 'invalid', message: error.message };
    if (error.code === 'P0002') return { error: 'missing', message: error.message };
    throw new Error(error.message);
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    changed: r.changed === true,
    previous: isMentionSentiment(r.previous) ? r.previous : null,
    sentiment,
    override: parseSentimentOverride(r.override),
  };
}
