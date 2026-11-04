/**
 * The V1 library's detectors, as decisions over numbers already fetched.
 *
 * Each function takes the compact summaries the `ae_*` reads return and says
 * which signal kinds they amount to. No database, no clock beyond what is
 * passed in — the same split as `classifyVisibilityFall` and
 * `classifyPlatformGap`, for the same reason: the decision is the part worth
 * testing, and it should be testable without a brand.
 *
 * Two rules run through all of them.
 *
 * Every prompt, source, page or query lands in at most one kind per family.
 * The specification gives similar conditions separate definitions with
 * separate work — a prompt with demand and no page needs content created, one
 * with a page needs it optimised — and a target counted twice would put the
 * same work in front of the user under two titles.
 *
 * Groups are signals; single rows are not. A prompt-level finding becomes one
 * signal listing the prompts, because the action it feeds is "Expand
 * visibility across 14 prompts", not fourteen actions.
 */

const round1 = (n) => Math.round(n * 10) / 10;
const ratio = (part, whole) => (whole > 0 ? part / whole : 0);

/** Keeps the strongest `max`, so a noisy night writes a bounded number of rows. */
export function strongest(items, score, max) {
  return [...items].sort((a, b) => score(b) - score(a)).slice(0, max);
}

// ─── Prompts ────────────────────────────────────────────────────────────────

/**
 * Which absence or loss a prompt amounts to, if any.
 *
 * Losses are checked first: a prompt that was visible and is not has a
 * history worth recovering, which is different work from one that was never
 * visible. Among the never-visible, demand and an existing page decide the
 * work: create content, optimise the page that exists, or map one.
 */
/**
 * Whether a prompt has been observed enough this window to judge: on enough
 * days, or in enough answers. Answers only accumulate inside the window, so a
 * prompt that qualifies on its first day still qualifies on its second — the
 * signal it raises does not flap closed while the days catch up.
 */
export function isTracked(p, t) {
  return p.cur_days >= t.promptMinDays || (p.cur_answers ?? 0) >= t.promptMinAnswers;
}

export function classifyPrompt(p, t) {
  const tracked = isTracked(p, t);
  const highValue = (p.volume ?? 0) >= t.highDemandVolume;

  if (tracked && p.cur_mention_days === 0 && p.prev_mention_days >= t.lostMentionMinDays) {
    return highValue ? 'high_value_prompt_lost' : 'lost_mentions';
  }
  if (!tracked || p.cur_mention_days > 0) return null;

  const everCited = Boolean(p.last_citation_day);
  if (highValue && !p.has_target_url && !everCited) return 'uncovered_demand';
  if (highValue) return 'high_demand_gap';
  if (p.has_target_url) return 'content_underperforming';
  if (!everCited) return 'prompt_unmapped';
  return 'prompt_visibility_gap';
}

/** Citations thinning without disappearing — the Protect grade of what
 *  `lost_citations` reports once they are gone. */
export function isCitationAtRisk(p, t) {
  return (
    p.prev_citation_days >= t.citationRiskMinDays &&
    p.cur_citation_days > 0 &&
    p.cur_citation_days < p.prev_citation_days * t.citationRiskRatio
  );
}

/**
 * Prompt rows → grouped findings, one list per kind.
 *
 * A loss of one prompt stands on its own; an absence needs company before it
 * is an action's worth — three prompts nobody sees is a pattern, one is a
 * prompt.
 */
export function groupPrompts(prompts, t) {
  const groups = {};
  const add = (kind, p) => (groups[kind] ??= []).push(p);

  for (const p of prompts) {
    const kind = classifyPrompt(p, t);
    if (kind) add(kind, p);
    if (isCitationAtRisk(p, t)) add('citation_at_risk', p);
  }

  const minimum = {
    lost_mentions: 2,
    high_value_prompt_lost: 1,
    citation_at_risk: 2,
  };
  for (const [kind, list] of Object.entries(groups)) {
    if (list.length < (minimum[kind] ?? t.promptGroupMin)) delete groups[kind];
  }
  return groups;
}

// ─── Topics ─────────────────────────────────────────────────────────────────

/**
 * A topic's coverage — the share of its tracked prompts the brand appeared on
 * — now and before, and what that amounts to.
 *
 * Declines are judged before levels, relatively, the way the visibility fall
 * is: a topic that went from 60% to 45% coverage is slipping even though 45%
 * would be a fine place to be for a topic that had never been higher.
 */
export function classifyTopic({ tracked, visible, prevTracked, prevVisible }, t) {
  if (tracked < t.topicMinPrompts) return null;
  const cur = ratio(visible, tracked);
  const prev = ratio(prevVisible, prevTracked);

  if (prevTracked >= t.topicMinPrompts && prev > 0) {
    const fall = (prev - cur) / prev;
    if (prev >= t.topicLeadershipCoverage && fall >= t.slipRatio && fall < t.dropRatio) {
      return 'topic_slipping';
    }
    if (prev >= t.topicUncoveredCoverage && fall >= t.dropRatio) return 'topic_drop';
  }
  if (cur < t.topicUncoveredCoverage) return 'topic_uncovered';
  if (cur < t.topicPartialCoverage) return 'topic_gap';
  return null;
}

export function topicCoverage(prompts, t) {
  const byTopic = new Map();
  for (const p of prompts) {
    if (!p.topic_id) continue;
    const e = byTopic.get(p.topic_id) ?? {
      topicId: p.topic_id,
      tracked: 0,
      visible: 0,
      prevTracked: 0,
      prevVisible: 0,
      prompts: [],
      mapped: 0,
    };
    if (isTracked(p, t)) {
      e.tracked += 1;
      if (p.cur_mention_days > 0) e.visible += 1;
    }
    if (p.prev_days >= t.promptMinDays) {
      e.prevTracked += 1;
      if (p.prev_mention_days > 0) e.prevVisible += 1;
    }
    if (p.has_target_url) e.mapped += 1;
    e.prompts.push(p);
    byTopic.set(p.topic_id, e);
  }
  return [...byTopic.values()];
}

// ─── Platforms and regions ──────────────────────────────────────────────────

/** A platform's mention rate, now against before: slipping, collapsing, or
 *  neither. A platform that was never worth anything cannot slip. */
export function classifyRateFall(row, t, { slip, drop }) {
  if ((row.prev_answers ?? 0) < t.platformMinAnswers) return null;
  if ((row.cur_answers ?? 0) < t.platformMinAnswers) return null;
  const prev = ratio(row.prev_mentions, row.prev_answers);
  const cur = ratio(row.cur_mentions, row.cur_answers);
  if (prev < t.rateFloor) return null;
  const fall = (prev - cur) / prev;
  if (fall >= t.dropRatio) return drop;
  if (fall >= t.slipRatio) return slip;
  return null;
}

/** Strong in one tracked region, weak in another. Needs two regions with
 *  enough answers to be regions at all, which few brands have. */
export function classifyCountryGap(regions, t) {
  const rated = regions
    .filter((r) => (r.cur_answers ?? 0) >= t.platformMinAnswers && r.key)
    .map((r) => ({ key: r.key, rate: ratio(r.cur_mentions, r.cur_answers) }));
  if (rated.length < 2) return null;
  const sorted = [...rated].sort((a, b) => b.rate - a.rate);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (best.rate < t.rateFloor) return null;
  if (best.rate - worst.rate < t.countryGapPoints) return null;
  return { best, worst, points: round1((best.rate - worst.rate) * 100) };
}

// ─── Competitors ────────────────────────────────────────────────────────────

/**
 * What each competitor's week amounts to against the brand's.
 *
 * Leading and gaining are separate kinds and a competitor can be both: one is
 * a standing gap to close, the other a trend to answer, and the specification
 * gives them separate work.
 */
export function classifyCompetitor(c, brandMentions, t) {
  const kinds = [];
  const cur = c.cur_mentions ?? 0;
  const prev = c.prev_mentions ?? 0;
  if (cur >= t.competitorLeadMinMentions && cur >= brandMentions * t.competitorLeadMultiple) {
    kinds.push('competitor_leads');
  }
  if (prev >= t.competitorMomentumMin && (cur - prev) / prev >= t.competitorMomentumRatio) {
    kinds.push('competitor_momentum');
  }
  return kinds;
}

/**
 * A topic a competitor holds and the brand does not. Split by whether the
 * brand has a page for any of it: with one, the work is optimising; without,
 * it is creating — and the specification gives those different definitions.
 */
export function classifyCompetitorTopic(topic, competitorPresent, t) {
  const contested = topic.prompts.filter((p) => isTracked(p, t));
  if (contested.length < t.topicMinPrompts) return null;
  const lost = contested.filter(
    (p) => p.cur_mention_days === 0 && competitorPresent.has(p.prompt_id),
  );
  if (ratio(lost.length, contested.length) < t.competitorTopicShare) return null;
  return topic.mapped === 0 ? 'competitor_uncovered_topic' : 'competitor_topic_lead';
}

// ─── Citation sources ───────────────────────────────────────────────────────

/**
 * Which third-party gap a cited domain represents, if any.
 *
 * In order: a source competitors win and the brand never appears beside;
 * one where only a competitor sometimes appears; one where the brand simply
 * never appears; a high-traffic source the brand rarely appears beside; and
 * a source used when answers talk about the brand, which could reference the
 * brand's own pages and does not. Owned domains are not third parties.
 */
export function classifySource(d, t) {
  if (d.owned) return null;
  if ((d.results ?? 0) < t.sourceMinResults || (d.prompts ?? 0) < t.sourceMinPrompts) return null;

  const brandShare = ratio(d.with_brand, d.results);
  const competitorShare = ratio(d.competitor_only, d.results);

  if (d.with_brand === 0) {
    if (competitorShare >= t.competitorSourceShare && d.prompts >= 3) {
      return 'competitor_winning_source';
    }
    if (d.competitor_only > 0) return 'competitor_cited_source';
    return 'third_party_presence_gap';
  }
  if (d.results >= t.authorityMinResults && brandShare < t.authorityBrandShare) {
    return 'authority_citation_gap';
  }
  return 'third_party_citation_gap';
}

// ─── Owned pages ────────────────────────────────────────────────────────────

export function classifyOwnedPage(u, t) {
  const prev = u.prev_citations ?? 0;
  const cur = u.cur_citations ?? 0;
  if (prev < t.ownedPageMinCitations) return null;
  if (cur === 0) return 'owned_page_citation_lost';
  if (cur < prev * t.ownedPageSlipRatio) return 'page_citation_slipping';
  return null;
}

// ─── Fan-outs ───────────────────────────────────────────────────────────────

/** A fan-out query engines ran across several prompts where the brand never
 *  appeared; a competitor appearing on it makes it a competitive one. */
export function classifyFanout(q, t) {
  if ((q.prompts ?? 0) < t.fanoutMinPrompts) return null;
  return (q.competitor_only ?? 0) >= 2 ? 'competitor_fanout_gap' : 'fanout_gap';
}

// ─── Search Console ─────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'what',
  'how',
  'best',
  'are',
  'is',
  'of',
  'to',
  'in',
  'a',
  'an',
  've',
  'ile',
  'için',
  'nedir',
  'nasıl',
  'en',
  'bir',
  'mi',
  'mı',
  'da',
  'de',
]);

export function tokens(text) {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/**
 * The tracked prompt a search query is about, if one is close enough.
 *
 * Share of the query's words the prompt also uses. Deliberately simple — a
 * query is short, a prompt is a sentence, and "most of what was searched for
 * is in what we track" is the relation the Search Console definitions need.
 * A semantic match would be better and would be the first LLM call in the
 * detection path, which the specification rules out.
 */
export function matchPrompt(queryTokens, promptTokens, t) {
  if (queryTokens.size === 0) return null;
  let best = null;
  for (const [id, words] of promptTokens) {
    let shared = 0;
    for (const w of queryTokens) if (words.has(w)) shared += 1;
    const overlap = shared / queryTokens.size;
    if (overlap >= t.gscMatchOverlap && (!best || overlap > best.overlap)) best = { id, overlap };
  }
  return best;
}

/** Organic CTR a query usually earns at a position — a published industry
 *  curve, rounded. Used only to say "far below", never as a target. */
export function expectedCtr(position) {
  if (position <= 1.5) return 0.28;
  if (position <= 2.5) return 0.15;
  if (position <= 3.5) return 0.1;
  if (position <= 5.5) return 0.06;
  if (position <= 10.5) return 0.03;
  return 0.01;
}

export function classifyGscQuery(q, prompt, t) {
  const kinds = [];
  const curClicks = q.cur_clicks ?? 0;
  const prevClicks = q.prev_clicks ?? 0;
  const impressions = q.cur_impressions ?? 0;
  if (impressions < t.gscMinImpressions || !prompt) return kinds;

  if (prevClicks >= t.gscMinClicks && curClicks <= prevClicks * (1 - t.gscDeclineRatio)) {
    kinds.push('gsc_decline');
  } else if (
    curClicks >= t.gscMinClicks &&
    prompt.prev_mention_days > 0 &&
    prompt.cur_mention_days < prompt.prev_mention_days
  ) {
    kinds.push('gsc_risk');
  } else if (prompt.cur_mention_days === 0) {
    const position = q.cur_position ?? 100;
    kinds.push(
      position <= 3 && curClicks >= t.gscMinClicks ? 'search_ai_misalignment' : 'gsc_demand_gap',
    );
  }

  const ctr = impressions > 0 ? curClicks / impressions : 0;
  if (ctr < expectedCtr(q.cur_position ?? 100) * t.gscCtrShortfall) kinds.push('gsc_low_ctr');
  return kinds;
}

// ─── AI traffic ─────────────────────────────────────────────────────────────

/**
 * The days Analytics counted in an ai_traffic_merged read (00176): a jsonb
 * array of those days, not a number.
 */
export function analyticsDayCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * AI-referred traffic per page, from analytics where connected and the
 * tracking snippet otherwise. Analytics wins where both exist: it is the
 * brand's own measurement, and the snippet is ours.
 */
export function mergeTrafficPages({ analytics = [], snippet = [] }) {
  const pages = new Map();
  for (const s of snippet) pages.set(s.page, { ...s, source: 'snippet' });
  for (const g of analytics) pages.set(g.page, { ...g, source: 'analytics' });
  return [...pages.values()];
}

export function classifyTrafficPage(p, site, t) {
  const kinds = [];
  const cur = p.cur_sessions ?? 0;
  const prev = p.prev_sessions ?? 0;

  if (prev >= t.aiTrafficMinSessions) {
    const fall = (prev - cur) / prev;
    if (fall >= t.aiTrafficSlipRatio && fall < t.aiTrafficDropRatio)
      kinds.push('ai_traffic_slipping');
  }
  if (p.source !== 'analytics' || cur < t.aiTrafficMinSessions) return kinds;

  const keyRate = ratio(p.cur_key_events, cur);
  const engaged = ratio(p.cur_engaged, cur);
  if (
    (p.cur_key_events ?? 0) >= 1 &&
    site.keyRate > 0 &&
    keyRate >= site.keyRate * t.landingWinnerMultiple
  ) {
    kinds.push('ai_landing_page_winner');
  }
  if (site.engagedRate > 0 && engaged < site.engagedRate * t.landingUnderperformMultiple) {
    kinds.push('ai_landing_underperforming');
  }
  if ((p.prev_key_events ?? 0) >= 1 && prev > 0 && cur < prev * (1 - t.aiTrafficSlipRatio)) {
    kinds.push('converting_page_slipping');
  }
  return kinds;
}

export function siteTrafficRates(pages) {
  const analytics = pages.filter((p) => p.source === 'analytics');
  const sessions = analytics.reduce((s, p) => s + (p.cur_sessions ?? 0), 0);
  return {
    keyRate: ratio(
      analytics.reduce((s, p) => s + (p.cur_key_events ?? 0), 0),
      sessions,
    ),
    engagedRate: ratio(
      analytics.reduce((s, p) => s + (p.cur_engaged ?? 0), 0),
      sessions,
    ),
    cur: pages.reduce((s, p) => s + (p.cur_sessions ?? 0), 0),
    prev: pages.reduce((s, p) => s + (p.prev_sessions ?? 0), 0),
  };
}

export function relativeFall(prev, cur) {
  return prev > 0 ? (prev - cur) / prev : 0;
}

/**
 * The pages AI visits fell on between two windows of ai_traffic_merged
 * (00176), biggest fall first: what a week-over-week drop is made of
 * (AT-013). Its pages are paths, matched without case as the Pages section
 * matches them.
 */
export function fallingPages(prevPages = [], curPages = []) {
  const now = new Map();
  for (const p of curPages) {
    const key = String(p.page ?? '').toLowerCase();
    now.set(key, (now.get(key) ?? 0) + (Number(p.visits) || 0));
  }
  const before = new Map();
  for (const p of prevPages) {
    const key = String(p.page ?? '').toLowerCase();
    const entry = before.get(key) ?? { page: p.page, visits: 0 };
    entry.visits += Number(p.visits) || 0;
    before.set(key, entry);
  }
  return [...before.entries()]
    .map(([key, p]) => ({ page: p.page, before: p.visits, now: now.get(key) ?? 0 }))
    .filter((p) => p.before > p.now)
    .sort((a, b) => b.before - b.now - (a.before - a.now) || a.page.localeCompare(b.page));
}

// ─── Site Audit ─────────────────────────────────────────────────────────────

/** Which failing audit check points at which fix. Checks not listed here are
 *  already covered by the overall low-score definition. */
export const AUDIT_SIGNAL_KINDS = Object.freeze({
  'ai-bot-access': 'crawler_blocked',
  'json-ld-presence': 'structured_data_issue',
  'json-ld-validity': 'structured_data_issue',
  'json-ld-relevance': 'structured_data_issue',
  'faq-schema': 'structured_data_issue',
  freshness: 'outdated_content',
  'date-markup': 'outdated_content',
  'brand-entity': 'weak_entity',
  'entity-coverage': 'weak_entity',
  'internal-linking': 'weak_internal_links',
  'query-coverage': 'content_gap',
  'sub-query-coverage': 'content_gap',
});
