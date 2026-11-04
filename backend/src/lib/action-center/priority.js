/**
 * An action's priority score (AC-006): how soon to work on it, 0–100.
 *
 * Impact says how much an action could matter. Priority says what to do
 * first, and weighs seven things the evidence shows (config/actionEngine.js
 * `priority`):
 *
 *   impact          the action's impact grade;
 *   demand          how much the affected prompts, queries or pages are
 *                   searched or visited — the most demanded few of them —
 *                   at least what a prompt's measured demand level says
 *                   (PROMPT-014: High, Medium);
 *   severity        how bad the change is: lost before dropping, dropping
 *                   before slipping, slipping before a gap;
 *   business value  how commercial the searches are (intent), or what the
 *                   page is worth to the business;
 *   confidence      how many independent kinds and sources of evidence agree
 *                   — not how many signals repeat one finding;
 *   recoverability  whether the brand held this before and lost it, which is
 *                   nearer to hand than winning it from nothing;
 *   recency         how new the latest evidence is, halving every few days.
 *
 * And, on top, past success: a kind of action that has improved results at
 * this brand before sits a little higher, one that rarely has a little
 * lower (learning B4).
 *
 * Pure: the caller reads the signals and the prompts' demand and passes them
 * in. Alongside the score it returns the facts it rests on, from which the
 * app writes "Why this priority?" in the reader's language. Its scales, sum,
 * past success and levels are the ones every screen's score shares
 * (priorityCore.js, learning D4).
 */

import { resolve } from '../../config/actionEngine.js';
import {
  INTENT_WEIGHTS,
  clamp,
  levelOf,
  logScale,
  pastSuccessOf as pastSuccessAt,
  round,
  weightedScore,
} from '../priorityCore.js';

const DAY_MS = 86_400_000;

const { priority: P } = resolve();

const IMPACT = { high: 1, medium: 0.6, low: 0.3 };

/**
 * How bad a finding is, by its kind, and what kind of change it is. A loss
 * outranks a drop, a drop a slip, a slip a gap; a gain is barely urgent.
 */
const SEVERITY = {
  lost: 1,
  dropped: 0.85,
  slipping: 0.6,
  gap: 0.5,
  issue: 0.5,
  opportunity: 0.35,
  gain: 0.2,
};

const KIND_CHANGE = {
  // Something held is gone.
  lost_citations: 'lost',
  broken_citation_target: 'lost',
  owned_page_citation_lost: 'lost',
  high_value_prompt_lost: 'lost',
  lost_mentions: 'lost',
  // A clear fall.
  sharp_drop: 'dropped',
  platform_drop: 'dropped',
  topic_drop: 'dropped',
  ai_traffic_drop: 'dropped',
  ai_visits_weekly_drop: 'dropped',
  gsc_decline: 'dropped',
  visibility_traffic_loss: 'dropped',
  cross_channel_risk: 'dropped',
  converting_page_slipping: 'dropped',
  competitor_crossed: 'dropped',
  competitor_overtaken: 'dropped',
  competitor_surge: 'dropped',
  crawler_blocked: 'dropped',
  // Starting to fall.
  visibility_slipping: 'slipping',
  platform_slipping: 'slipping',
  topic_slipping: 'slipping',
  ai_traffic_slipping: 'slipping',
  page_citation_slipping: 'slipping',
  citation_at_risk: 'slipping',
  gsc_risk: 'slipping',
  competitor_momentum: 'slipping',
  // Something to fix on the site.
  structured_data_issue: 'issue',
  outdated_content: 'issue',
  weak_entity: 'issue',
  weak_internal_links: 'issue',
  content_gap: 'issue',
  audit_low_score: 'issue',
  cited_page_uncrawled: 'issue',
  // Ground to win.
  page_opportunity: 'opportunity',
  ai_landing_page_winner: 'opportunity',
  new_engine: 'opportunity',
  ai_platform_new: 'opportunity',
  gsc_low_ctr: 'opportunity',
  // Ground never held: a gap to close or a lead to answer.
  prompt_visibility_gap: 'gap',
  high_demand_gap: 'gap',
  uncovered_demand: 'gap',
  prompt_unmapped: 'gap',
  content_underperforming: 'gap',
  topic_gap: 'gap',
  topic_uncovered: 'gap',
  country_gap: 'gap',
  platform_gap: 'gap',
  competitor_leads: 'gap',
  competitor_topic_lead: 'gap',
  competitor_high_value_lead: 'gap',
  competitor_uncovered_topic: 'gap',
  competitor_citation_gap: 'gap',
  authority_citation_gap: 'gap',
  third_party_citation_gap: 'gap',
  third_party_presence_gap: 'gap',
  competitor_cited_source: 'gap',
  competitor_winning_source: 'gap',
  fanout_gap: 'gap',
  competitor_fanout_gap: 'gap',
  gsc_demand_gap: 'gap',
  search_ai_misalignment: 'gap',
  ai_landing_underperforming: 'gap',
  uncited_mentions: 'gap',
  // Good news.
  prompt_gain: 'gain',
  first_citation: 'gain',
};

/** AI-traffic kinds whose page targets carry sessions (`before`/`now`). */
const SESSION_KINDS = new Set([
  'ai_traffic_slipping',
  'ai_traffic_drop',
  'ai_visits_weekly_drop',
  'ai_landing_page_winner',
  'ai_landing_underperforming',
  'converting_page_slipping',
]);

/** Severity when an action has no open evidence left: its findings resolved. */
const NO_EVIDENCE_SEVERITY = 0.3;

/** Kinds that report losing ground the brand held: nearer to hand than new ground. */
const HELD_BEFORE = new Set([
  'lost_citations',
  'owned_page_citation_lost',
  'high_value_prompt_lost',
  'lost_mentions',
  'sharp_drop',
  'visibility_slipping',
  'platform_drop',
  'platform_slipping',
  'topic_drop',
  'topic_slipping',
  'page_citation_slipping',
  'citation_at_risk',
  'ai_traffic_drop',
  'ai_visits_weekly_drop',
  'ai_traffic_slipping',
  'converting_page_slipping',
  'broken_citation_target',
  'gsc_decline',
  'gsc_risk',
  'visibility_traffic_loss',
  'cross_channel_risk',
]);

/** Kinds whose cure is a fix on the brand's own site. */
const SITE_FIX = new Set([
  'crawler_blocked',
  'cited_page_uncrawled',
  'broken_citation_target',
  'structured_data_issue',
  'outdated_content',
  'weak_internal_links',
  'audit_low_score',
]);

/** Without a kind to go by, how recoverable an action's category usually is. */
const CATEGORY_RECOVERABILITY = { recover: 1, protect: 0.9, fix: 0.9, compete: 0.6, growth: 0.5 };

/** What a page is worth to the business, by the signal that ranked it. */
const PAGE_VALUE = { revenue: 1, transactions: 0.95, key_events: 0.85, engagement: 0.65 };

/** Commercial enough to say so in "Why this priority?". */
const COMMERCIAL = 0.85;

const LEVEL_RANK = { low: 1, medium: 2, high: 3 };

/**
 * The highest measured demand level (PROMPT-014) among the prompts the
 * evidence names, and the demand it brings the action up to: High and
 * Medium raise it (`realDemandHigh`, `realDemandMedium`), Low leaves it.
 * Null without a level read.
 */
function realDemandOf(payloads, prompts) {
  let level = null;
  for (const id of promptIdsOf(payloads)) {
    const known = prompts.get(id)?.level;
    if (LEVEL_RANK[known] && (!level || LEVEL_RANK[known] > LEVEL_RANK[level])) level = known;
  }
  const floor =
    level === 'high' ? P.realDemandHigh : level === 'medium' ? P.realDemandMedium : null;
  return { level, floor };
}

/** What kind of change a finding is; a kind this table has not met counts as a gap. */
function changeOf(kind) {
  return KIND_CHANGE[kind] ?? 'gap';
}

/** Demand on the shared log scale: 0 → 0, `demandFullAt` and above → 1. */
function demandScale(value) {
  return logScale(value, P.demandFullAt);
}

/** The sum of the `demandTopTargets` largest values. */
function topSum(values) {
  return [...values]
    .sort((a, b) => b - a)
    .slice(0, P.demandTopTargets)
    .reduce((sum, v) => sum + v, 0);
}

function targetsOf(payload) {
  return Array.isArray(payload?.targets) ? payload.targets.filter(Boolean) : [];
}

/**
 * The prompts an action is about, from its signals' payloads and its own:
 * a prompt id, a list of them, or targets naming prompts.
 */
export function promptIdsOf(payloads) {
  const ids = new Set();
  for (const p of payloads) {
    if (!p) continue;
    if (typeof p.promptId === 'string') ids.add(p.promptId);
    // The first 50, as signals named them before they listed every prompt
    // (AC-009): demand is read for the prompts an action leads with.
    for (const id of Array.isArray(p.promptIds) ? p.promptIds.slice(0, 50) : []) {
      if (typeof id === 'string') ids.add(id);
    }
    const entity = p.entity ?? p.targetEntity;
    if (entity === 'prompts') {
      for (const t of targetsOf(p)) if (typeof t.id === 'string') ids.add(t.id);
    }
  }
  return [...ids];
}

/**
 * Demand and business value from what the evidence names: prompts (their
 * monthly AI searches and intent), search queries (impressions) and pages
 * (sessions, and what the page is worth). Null where nothing is measured.
 */
function demandAndValue(payloads, signals, prompts) {
  // Prompts: the stored demand, else the volume the detector put on a target.
  const promptVolume = new Map();
  for (const id of promptIdsOf(payloads)) {
    const known = prompts.get(id);
    if (known && Number.isFinite(known.volume)) promptVolume.set(id, known.volume);
  }
  for (const p of payloads) {
    if ((p?.entity ?? p?.targetEntity) !== 'prompts') continue;
    for (const t of targetsOf(p)) {
      if (typeof t.id === 'string' && !promptVolume.has(t.id) && Number.isFinite(t.volume)) {
        promptVolume.set(t.id, t.volume);
      }
    }
  }

  const queryImpressions = [];
  const pageSessions = [];
  let pageValue = null;
  for (const p of payloads) {
    const entity = p?.entity ?? p?.targetEntity;
    for (const t of targetsOf(p)) {
      if (entity === 'queries' && Number.isFinite(t.impressions)) {
        queryImpressions.push(t.impressions);
      }
    }
    if (typeof p?.valueSignal === 'string' && PAGE_VALUE[p.valueSignal]) {
      pageValue = Math.max(pageValue ?? 0, PAGE_VALUE[p.valueSignal]);
    }
    // Pages sent from AI Traffic (AT-006) carry their sessions over the range.
    if (p?.source === 'traffic_pages') {
      for (const t of targetsOf(p)) {
        if (Number.isFinite(t.sessions) && t.sessions > 0) pageSessions.push(t.sessions);
      }
    }
  }
  for (const s of signals) {
    // Sessions only from the AI-traffic kinds: other page targets carry
    // other counts in the same fields (an owned page's citations).
    if (SESSION_KINDS.has(s.kind)) {
      for (const t of targetsOf(s.payload)) {
        if (Number.isFinite(t.now) || Number.isFinite(t.before)) {
          pageSessions.push(Math.max(t.now ?? 0, t.before ?? 0));
        }
      }
    }
    // A page opportunity's value is the page's sessions over its window.
    if (s.kind === 'page_opportunity' && Number.isFinite(Number(s.current_value))) {
      pageSessions.push(Number(s.current_value));
    }
    // Pages that convert are worth more than pages that are read.
    if (s.kind === 'converting_page_slipping' || s.kind === 'ai_landing_page_winner') {
      pageValue = Math.max(pageValue ?? 0, PAGE_VALUE.key_events);
    }
  }

  const promptDemand = promptVolume.size ? topSum(promptVolume.values()) : null;
  const measured = [
    promptDemand,
    queryImpressions.length ? topSum(queryImpressions) : null,
    pageSessions.length ? topSum(pageSessions) : null,
  ].filter((v) => v !== null);
  const demand = measured.length ? Math.max(...measured.map(demandScale)) : null;

  // Intent, weighted by each prompt's demand so a long tail does not outvote
  // the prompts people search for.
  let weighted = 0;
  let weight = 0;
  for (const [id, volume] of promptVolume) {
    const intent = prompts.get(id)?.intent;
    if (!intent || INTENT_WEIGHTS[intent] === undefined) continue;
    const w = Math.max(volume, 1);
    weighted += INTENT_WEIGHTS[intent] * w;
    weight += w;
  }
  const intentValue = weight ? weighted / weight : null;
  const values = [intentValue, pageValue].filter((v) => v !== null);
  const businessValue = values.length ? Math.max(...values) : null;

  return { demand, promptDemand, businessValue };
}

/**
 * Independent confirmation: distinct kinds of finding and distinct data
 * sources, never the number of signals. One kind from one source is 0.3.
 */
function confidenceOf(signals) {
  const kinds = new Set(signals.map((s) => s.kind));
  const sources = new Set(signals.flatMap((s) => (Array.isArray(s.source) ? s.source : [])));
  const value = clamp(
    0.3 + 0.2 * Math.max(kinds.size - 1, 0) + 0.2 * Math.max(sources.size - 1, 0),
  );
  return { value, kinds: kinds.size, sources: sources.size };
}

/**
 * What an action sent by a person rests on, without detection signals: an
 * Improve action names its platforms and their state, a content opportunity
 * its prompts. Read from the action's own payload. The shopping check's
 * actions (fromShoppingCheck.js) have no signals either.
 */
function sentByHand(action) {
  const p = action.payload ?? {};
  if (action.kind === 'prompt_improve') {
    const states = Array.isArray(p.platforms) ? p.platforms.map((x) => x?.state) : [];
    const gaps = states.filter(
      (s) => s === 'not_mentioned' || s === 'mentioned_late' || s === 'not_cited',
    );
    const severity = states.includes('not_mentioned')
      ? 0.7
      : states.includes('mentioned_late')
        ? 0.55
        : gaps.length
          ? 0.45
          : 0.3;
    return {
      change: 'gap',
      severity,
      confidence: clamp(0.3 + 0.15 * gaps.length),
      recoverability: 0.7,
      subject: { entity: 'platforms', count: gaps.length },
    };
  }
  // A draft sent from the Content Editor (CE-015) is the same work as an
  // opportunity's page: content for its prompts.
  if (action.kind === 'content_opportunity' || action.kind === 'content_draft') {
    return {
      change: 'gap',
      severity: 0.45,
      confidence: 0.6,
      recoverability: 0.5,
      subject: { entity: p.targetEntity ?? 'prompts', count: p.targetCount ?? null },
    };
  }
  // A product or category sent from Product Visibility (ECOM-013): getting
  // onto AI shopping shelves its rivals hold.
  if (action.kind === 'shopping_product' || action.kind === 'shopping_category') {
    return {
      change: 'gap',
      severity: 0.5,
      confidence: 0.55,
      recoverability: 0.6,
      subject: { entity: p.targetEntity ?? 'prompts', count: p.targetCount ?? null },
    };
  }
  // A live page linking products that no longer sell (shopping path, part 7):
  // the catalog says so, and swapping the links is quick work.
  if (action.kind === 'shopping_links') {
    return {
      change: 'issue',
      severity: 0.6,
      confidence: 0.9,
      recoverability: 0.9,
      subject: { entity: 'pages', count: 1 },
    };
  }
  // Pages sent from AI Traffic (AT-006). Answers citing a page nobody clicks
  // rest on two sources, citations and traffic, and the page already earns
  // the answer; a page AI skips rests on traffic alone.
  if (action.kind === 'traffic_pages') {
    const cited = p.reason === 'cited_not_clicked';
    return {
      change: 'gap',
      severity: cited ? 0.55 : 0.45,
      confidence: cited ? 0.6 : 0.45,
      recoverability: cited ? 0.7 : 0.5,
      subject: { entity: 'pages', count: p.targetCount ?? null },
    };
  }
  // A finding sent from Chat (CHAT-09 §E): what it is about, as the person
  // approved it. Recover work rests on something lost, Fix on an issue, the
  // rest on a gap; its prompts, pages or competitors are its subject.
  if (action.kind === 'chat_finding') {
    const change =
      action.category === 'recover' ? 'slipping' : action.category === 'fix' ? 'issue' : 'gap';
    return {
      change,
      severity: SEVERITY[change],
      confidence: 0.5,
      recoverability: 0.6,
      subject: { entity: p.targetEntity ?? 'prompts', count: p.targetCount ?? null },
    };
  }
  // A page sent from a Site Audit report (learning D2): a fix on the site,
  // as urgent as the checks it fails are many, near to hand.
  if (action.kind === 'audit_page') {
    const failing = Array.isArray(p.checks) ? p.checks.length : 0;
    return {
      change: 'issue',
      severity: failing >= 5 ? 0.6 : 0.5,
      confidence: 0.6,
      recoverability: 0.9,
      subject: { entity: 'pages', count: 1 },
    };
  }
  return null;
}

/** The factors' weights, in the order they add up. */
const WEIGHTS = {
  impact: P.weightImpact,
  demand: P.weightDemand,
  severity: P.weightSeverity,
  businessValue: P.weightBusinessValue,
  confidence: P.weightConfidence,
  recoverability: P.weightRecoverability,
  recency: P.weightRecency,
};

/**
 * Past success (learning B4): from a kind's results at this brand, the
 * share that improved, shrunk toward the prior by a few imagined results,
 * and the points that moves the score. None read: the prior, no points.
 *
 * @param {{ improved?: number, results?: number } | undefined} track
 */
export function pastSuccessOf(track) {
  return pastSuccessAt(track, {
    prior: P.pastSuccessPrior,
    pseudoCount: P.pastSuccessPseudoCount,
    swing: P.pastSuccessSwing,
  });
}

/** The level a score falls in. */
export function priorityLevel(score) {
  return levelOf(score, { critical: P.levelCritical, high: P.levelHigh, medium: P.levelMedium });
}

/**
 * An action's priority.
 *
 * @param {object} input
 * @param {{ kind: string, category: string, impact: string, payload?: object, created_at?: string }} input.action
 *   An action, or a candidate shaped like one.
 * @param {Array<{ kind: string, impact?: string, source?: string[], payload?: object,
 *   detected_at?: string, current_value?: number|null }>} input.signals
 *   Its open signals: the evidence it rests on now.
 * @param {Map<string, { volume: number|null, intent: string|null, level?: string|null }>} [input.prompts]
 *   Demand, intent and measured demand level of the prompts the evidence names.
 * @param {Map<string, { improved: number, results: number }>} [input.track]
 *   Per kind, the brand's results with a verdict and how many improved (loadKindTrack).
 * @param {Date} now
 * @returns {{ score: number, level: string, reason: object }}
 */
export function scorePriority(
  { action, signals = [], prompts = new Map(), track = new Map() },
  now = new Date(),
) {
  const payloads = [action.payload, ...signals.map((s) => s.payload)].filter(Boolean);
  const byHand = signals.length === 0 ? sentByHand(action) : null;

  // Severity and what kind of change: the worst finding speaks for the action.
  let change = byHand?.change ?? null;
  let severity = byHand?.severity ?? -1;
  for (const s of signals) {
    const c = changeOf(s.kind);
    if (SEVERITY[c] > severity) {
      severity = SEVERITY[c];
      change = c;
    }
  }
  // Every finding behind it resolved: nothing open says what changed.
  if (change === null) severity = NO_EVIDENCE_SEVERITY;

  const scaled = demandAndValue(payloads, signals, prompts);
  const { promptDemand, businessValue } = scaled;
  // A measured level is better evidence of demand than the estimate it
  // stands beside: High or Medium raise the demand to at least theirs.
  const real = realDemandOf(payloads, prompts);
  const demand = real.floor === null ? scaled.demand : Math.max(scaled.demand ?? 0, real.floor);

  const confidence = byHand
    ? { value: byHand.confidence, kinds: 0, sources: 0 }
    : confidenceOf(signals);

  let recoverability = CATEGORY_RECOVERABILITY[action.category] ?? 0.6;
  if (byHand) recoverability = byHand.recoverability;
  if (signals.some((s) => HELD_BEFORE.has(s.kind))) recoverability = 1;
  else if (signals.some((s) => SITE_FIX.has(s.kind)))
    recoverability = Math.max(recoverability, 0.9);
  // Cited once, not mentioned now: the ground was held, if not lately.
  else if (signals.some((s) => s.kind === 'prompt_visibility_gap')) {
    recoverability = Math.max(recoverability, 0.8);
  }

  const newest = Math.max(
    ...signals.map((s) => Date.parse(s.detected_at ?? '') || 0),
    signals.length ? 0 : Date.parse(action.created_at ?? '') || now.getTime(),
  );
  const days = Math.max(0, (now.getTime() - (newest || now.getTime())) / DAY_MS);
  const recency = Math.max(0.1, 0.5 ** (days / P.recencyHalfLifeDays));

  const factors = {
    impact: IMPACT[action.impact] ?? IMPACT.low,
    demand: demand ?? P.demandUnknown,
    severity,
    businessValue: businessValue ?? P.businessValueUnknown,
    confidence: confidence.value,
    recoverability,
    recency,
  };
  const past = pastSuccessOf(track.get(action.kind));
  const score = Math.round(weightedScore(factors, WEIGHTS).total + past.points);
  const bounded = Math.min(100, Math.max(0, score));

  const p = action.payload ?? {};
  const subject = byHand?.subject ?? {
    entity: p.targetEntity ?? null,
    count: Number.isFinite(p.targetCount) ? p.targetCount : null,
  };

  return {
    score: bounded,
    level: priorityLevel(bounded),
    reason: {
      version: 1,
      change,
      subject,
      // Measured demand only: an unmeasured one is not called low.
      demand: demand === null ? null : demand >= 0.67 ? 'high' : demand >= 0.4 ? 'medium' : 'low',
      // The prompts' measured demand level (PROMPT-014), the highest, when it
      // raised the demand (High, Medium); null otherwise. Low raises nothing,
      // so it's no reason for the score.
      realDemand: real.floor === null ? null : real.level,
      searches: promptDemand,
      commercial: businessValue !== null && businessValue >= COMMERCIAL,
      heldBefore: recoverability >= 1,
      days: signals.length ? Math.floor(days) : null,
      kinds: confidence.kinds,
      sources: confidence.sources,
      // How its kind did here before (learning B4); null with nothing to go on.
      pastSuccess: past.results
        ? { improved: past.improved, results: past.results, points: round(past.points) }
        : null,
      // Its rate only with a result behind it: with none, the prior would
      // read as a measured 0.5.
      factors: Object.fromEntries(
        Object.entries({ ...factors, ...(past.results ? { pastSuccess: past.rate } : {}) }).map(
          ([k, v]) => [k, round(v)],
        ),
      ),
    },
  };
}

/** The columns an action's priority is stored in. */
export function priorityColumns({ score, level, reason }, now) {
  return {
    priority_score: score,
    priority_level: level,
    priority_reason: reason,
    priority_updated_at: now.toISOString(),
  };
}
