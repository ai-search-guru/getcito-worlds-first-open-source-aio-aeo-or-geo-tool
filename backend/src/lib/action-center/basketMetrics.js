/**
 * Measuring an action sent from a content opportunity on its own basket
 * (#857, Phase 4).
 *
 * validate.js measures an action's KPIs over a window before it was raised
 * and one after it closed. For signal-driven actions it reads the whole
 * brand. A content opportunity answers a handful of the brand's prompts, so
 * its action reads the same windows over just those prompts and the pages it
 * worked on — the spec's "measured for the same basket".
 */

import supabaseAdmin from '../../config/supabase.js';

/** What a basket is measured on, and in what unit. Every one reads higher-is-better. */
export const BASKET_KPIS = {
  ai_visibility: 'percent',
  share_of_voice: 'percent',
  // The brand's visibility minus the strongest competitor's; negative while behind.
  competitor_lead: 'points',
  mentions: 'count',
  citations: 'count',
  ai_referral_traffic: 'sessions',
  // The positive share of the answers naming the brand (learning D1, 00373),
  // as Insights' Positive Sentiment card reads it (00191): an answer only
  // citing the brand isn't in it.
  positive_sentiment: 'percent',
};

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Fewest answers naming the brand a basket's positive sentiment is read
 * from, as CONTROL_MIN_COUNT: from 2, one answer turning positive reads
 * +50 points.
 */
export const SENTIMENT_MIN_ANSWERS = 5;

/**
 * The pages as the three keys the metrics function matches on: URL without
 * scheme, www., query, fragment or trailing slash; host without www.; and
 * the GA landing-page path.
 */
export function pageScope(urls) {
  const keys = new Set();
  const domains = new Set();
  const paths = new Set();
  for (const raw of urls || []) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    keys.add(`${host}${path}`);
    domains.add(host);
    paths.add(url.pathname.replace(/\/+$/, '') || '/');
  }
  return { keys: [...keys], domains: [...domains], paths: [...paths] };
}

/**
 * The metrics from one window's raw figures. A metric the window cannot
 * answer is null — no answers for the prompts, no pages to cite, no GA — so
 * it is reported as unmeasured rather than as zero.
 */
export function basketValues(raw, { pageCount }) {
  const cells = Number(raw.cells) || 0;
  const visible = Number(raw.visible) || 0;
  const competitors = Number(raw.competitor_visible_total) || 0;
  const visibility = cells ? (visible / cells) * 100 : null;
  return {
    ai_visibility: visibility === null ? null : round1(visibility),
    share_of_voice:
      visible + competitors > 0 ? round1((visible / (visible + competitors)) * 100) : null,
    competitor_lead:
      visibility === null
        ? null
        : round1(visibility - ((Number(raw.top_competitor_visible) || 0) / cells) * 100),
    mentions: cells ? Number(raw.mention_answers) || 0 : null,
    citations: pageCount ? Number(raw.page_citations) || 0 : null,
    ai_referral_traffic: pageCount && raw.ga_connected ? Number(raw.page_ai_sessions) || 0 : null,
    // Null from fewer than SENTIMENT_MIN_ANSWERS answers naming the brand,
    // or while the window's sentiment isn't counted yet.
    positive_sentiment:
      raw.named_answers != null && Number(raw.named_answers) >= SENTIMENT_MIN_ANSWERS
        ? round1(((Number(raw.positive_answers) || 0) / Number(raw.named_answers)) * 100)
        : null,
  };
}

/**
 * The prompts and pages an action covers. Actions sent before the payload
 * carried prompt ids take them from the opportunity's clusters as they are
 * now, or, without clusters, from the one prompt it was written for. A topic
 * sent before any of its prompts was tracked (VIS-011) takes the prompts it
 * has now: the ones tracked from its suggestions.
 */
export async function basketScope(action, { db = supabaseAdmin } = {}) {
  const payload = action.payload || {};
  let promptIds = Array.isArray(payload.promptIds) ? payload.promptIds : [];
  if (!promptIds.length && payload.opportunityId) {
    const { data: opp } = await db
      .from('content_opportunities')
      .select('cluster_id, related_cluster_ids, prompt_id')
      .eq('id', payload.opportunityId)
      .maybeSingle();
    const clusterIds = [opp?.cluster_id, ...(opp?.related_cluster_ids || [])].filter(Boolean);
    if (clusterIds.length) {
      const { data: members, error } = await db
        .from('prompt_cluster_members')
        .select('prompt_id')
        .in('cluster_id', clusterIds);
      if (error) throw new Error(error.message);
      promptIds = (members || []).map((m) => m.prompt_id);
    }
    if (!promptIds.length && opp?.prompt_id) promptIds = [opp.prompt_id];
  }
  if (!promptIds.length && payload.topicId) {
    promptIds = await topicPromptIds(action.brand_id, [payload.topicId], { db });
  }
  return { promptIds, pages: scopePages(payload) };
}

/** The prompts the brand's topics have now, by id. */
export async function topicPromptIds(brandId, topicIds, { db = supabaseAdmin } = {}) {
  if (!topicIds.length) return [];
  const { data: prompts, error } = await db
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .in('topic_id', topicIds);
  if (error) throw new Error(error.message);
  return (prompts || []).map((p) => p.id);
}

/**
 * The pages an action is measured on: the ones it names, and the addresses
 * its drafts went live at (publishedPages by draft, CE-013), each once.
 */
function scopePages(payload) {
  const named = Array.isArray(payload.pages) ? payload.pages : [];
  const live =
    payload.publishedPages && typeof payload.publishedPages === 'object'
      ? Object.values(payload.publishedPages)
      : [];
  const seen = new Set();
  const pages = [];
  for (const url of [...named, ...live]) {
    if (typeof url !== 'string') continue;
    const key = pageScope([url]).keys[0] ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    pages.push(url);
  }
  return pages;
}

/** The basket's metrics over one window. */
export async function measureBasket(brandId, scope, from, to) {
  const pages = pageScope(scope.pages);
  const { data, error } = await supabaseAdmin.rpc('opportunity_basket_metrics', {
    p_brand_id: brandId,
    p_prompt_ids: scope.promptIds,
    p_page_keys: pages.keys,
    p_page_domains: pages.domains,
    p_page_paths: pages.paths,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`opportunity_basket_metrics: ${error.message}`);
  return basketValues(data || {}, { pageCount: pages.keys.length });
}

/** Fewest prompts a control basket is read from: fewer, and one prompt's swing is its result. */
export const CONTROL_MIN_PROMPTS = 5;
/** Most prompts it is read from. */
const CONTROL_MAX_PROMPTS = 300;

/**
 * The control basket (learning B2): the brand's active prompts the action
 * didn't touch — in the same topics as its own first, else any of the
 * brand's — read over the same windows, so what moved for every prompt (an
 * engine's update, a season, a night tracking missed) is told apart from
 * what moved for the action's own. Its prompts only, never another brand's,
 * and only ones tracked by `since` (the first day of the week before): one
 * added later reads in the week after alone, and would swell it. Null with
 * too few to read.
 *
 * @returns {Promise<{ basis: 'topics' | 'brand', promptIds: string[], pages: [] } | null>}
 */
export async function controlScope(brandId, promptIds, since) {
  if (!promptIds?.length) return null;
  const own = new Set(promptIds);
  const { data: targets, error } = await supabaseAdmin
    .from('prompts')
    .select('topic_id')
    .in('id', promptIds.slice(0, 200));
  if (error) throw new Error(error.message);
  const topics = [...new Set((targets ?? []).map((p) => p.topic_id).filter(Boolean))];
  const others = async (byTopic) => {
    let query = supabaseAdmin
      .from('prompts')
      .select('id, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId)
      .eq('is_active', true)
      .lt('created_at', `${since}T00:00:00Z`);
    if (byTopic) query = query.in('topic_id', topics);
    const { data, error: readError } = await query
      .order('id')
      .limit(CONTROL_MAX_PROMPTS + own.size);
    if (readError) throw new Error(readError.message);
    return (data ?? [])
      .map((p) => p.id)
      .filter((id) => !own.has(id))
      .slice(0, CONTROL_MAX_PROMPTS);
  };
  let basis = 'topics';
  let ids = topics.length ? await others(true) : [];
  if (ids.length < CONTROL_MIN_PROMPTS) {
    basis = 'brand';
    ids = await others(false);
  }
  return ids.length >= CONTROL_MIN_PROMPTS ? { basis, promptIds: ids, pages: [] } : null;
}

/**
 * Fewest the action's count must read before to be netted: from 2, one more
 * mention reads +50%, a swing no control speaks to.
 */
export const CONTROL_MIN_COUNT = 5;

/**
 * The action's change net of the control's (learning B2), a difference in
 * differences, for each metric both read: a rate in points (its move minus
 * theirs), a count in percent (its relative move minus theirs, so a basket
 * of 300 prompts weighs as one of 3), not from fewer than CONTROL_MIN_COUNT
 * before. Never AI sessions: they're read on pages, and a control of
 * prompts has none.
 *
 * @returns {Array<{ metric: string, net: number, unit: 'points' | 'percent', control: { before: number, after: number } }>}
 */
export function netEffect(metrics, controlValues) {
  const read = (before, after) => before != null && after != null;
  return metrics.flatMap((m) => {
    if (m.unit === 'sessions') return [];
    const before = controlValues.before[m.metric];
    const after = controlValues.after[m.metric];
    if (!read(m.before, m.after) || !read(before, after)) return [];
    if (m.unit === 'count') {
      if (!(m.before >= CONTROL_MIN_COUNT && before > 0)) return [];
      const net = round1((m.after / m.before - after / before) * 100);
      return [{ metric: m.metric, net, unit: 'percent', control: { before, after } }];
    }
    const net = round1(m.after - m.before - (after - before));
    return [{ metric: m.metric, net, unit: 'points', control: { before, after } }];
  });
}
