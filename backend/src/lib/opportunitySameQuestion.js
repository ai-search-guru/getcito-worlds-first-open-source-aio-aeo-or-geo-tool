/**
 * One open opportunity per question.
 *
 * The basket check (opportunityDedup.js) catches a cluster whose prompts and
 * AI searches largely overlap an existing opportunity's. Two opportunities
 * can still answer the very same question with little overlap: a regrouping
 * puts the question in a new cluster, a prompt is suggested again from its
 * row, or an Action Center task asks for it. So an opportunity also stands
 * for its question, the prompt it was written for (source_data.promptText).
 * When a new one would answer a question an open opportunity already
 * answers, in the same words (years aside), for the same prompt or on the
 * same cluster, it is added to that one instead: its prompts, AI searches and
 * sources join it, the stronger signal stays, and the merge is recorded on it
 * (`merged`). A cluster's other prompts don't count: two opportunities whose
 * questions merely sit in one cluster are different work (on the dev
 * database that chained four distinct opportunities into one). Neither does
 * an "Another angle" opportunity (source_data.alternativeOf): it is asked for
 * on purpose next to its original, on the same cluster and question.
 *
 * Pure on purpose: callers load the rows and write what this returns.
 */

import { normalize } from './opportunityDedup.js';
import { OPEN_OPPORTUNITY_STATUSES } from './opportunityLimits.js';

/** Merges an opportunity keeps a record of, the latest last. */
export const MERGED_KEPT = 20;
/** AI searches kept on a merged opportunity, most searched first (as the generator keeps them). */
const QUERIES_KEPT = 15;
const KEYWORDS_KEPT = 8;
const COMPETITORS_KEPT = 5;

const YEAR = /\b(?:19|20)\d{2}\b/g;

/**
 * A question as compared: lowercase, no punctuation, no years, single
 * spaces. "What are the best coffee subscriptions in 2026?" and "…in 2025"
 * are one question.
 */
export function questionKey(text) {
  return normalize(text).replace(YEAR, ' ').replace(/\s+/g, ' ').trim();
}

/** The question an opportunity stands for, from a full row or one read with `promptText`. */
export function questionOf(row) {
  return row?.source_data?.promptText ?? row?.promptText ?? null;
}

export function isOpen(row) {
  return OPEN_OPPORTUNITY_STATUSES.includes(row?.status);
}

/** An "Another angle" opportunity: kept beside its original, never merged. */
export function isAlternative(row) {
  return !!row?.source_data?.alternativeOf;
}

export function clustersOf(row) {
  return [row?.cluster_id, ...(row?.related_cluster_ids || [])].filter(Boolean);
}

/**
 * Whether an existing opportunity answers the candidate's question: the same
 * question, the same prompt, or a shared cluster.
 *
 * @param {{ question?: string | null, promptId?: string | null, clusterIds?: string[] }} candidate
 */
export function answersSameQuestion(candidate, row) {
  if (isAlternative(row)) return false;
  const key = questionKey(questionOf(row));
  if (key && key === questionKey(candidate.question)) return true;
  if (row.prompt_id && row.prompt_id === candidate.promptId) return true;
  const clusters = new Set(candidate.clusterIds || []);
  return clustersOf(row).some((id) => clusters.has(id));
}

/** An opportunity as a candidate for the check: its question, its prompt and its clusters. */
export function candidateOf(row) {
  return {
    question: questionOf(row),
    promptId: row.prompt_id ?? null,
    clusterIds: clustersOf(row),
  };
}

const STAGE = { in_progress: 0, sent: 1, reviewed: 2, new: 3 };

/** Whether work hangs on the row: a draft, Action Center actions, a brief or a workflow send. */
function hasWork(row, withDrafts) {
  return (
    !!withDrafts?.has(row.id) ||
    Object.keys(row.source_data?.actions || {}).length > 0 ||
    !!row.brief ||
    !!row.webhook_sent_at
  );
}

/**
 * Which of two open opportunities on one question stays: the one furthest
 * along, then the one with work on it, then the higher score, then the older.
 */
export function keeperOrder(withDrafts) {
  return (a, b) =>
    (STAGE[a.status] ?? 9) - (STAGE[b.status] ?? 9) ||
    Number(hasWork(b, withDrafts)) - Number(hasWork(a, withDrafts)) ||
    (Number(b.opportunity_score) || 0) - (Number(a.opportunity_score) || 0) ||
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
}

/** The open opportunity that already answers the candidate's question, or null. */
export function findSameQuestion(candidate, rows, { withDrafts } = {}) {
  const matches = (rows || []).filter((r) => isOpen(r) && answersSameQuestion(candidate, r));
  return matches.sort(keeperOrder(withDrafts))[0] ?? null;
}

/** The texts of both lists, once each by their question (the first spelling stays). */
function unionTexts(a, b, limit = Infinity) {
  const seen = new Set();
  const out = [];
  for (const text of [...(a || []), ...(b || [])]) {
    const key = questionKey(text) || normalize(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.slice(0, limit);
}

function promptsOf(sd) {
  return Array.isArray(sd.prompts) && sd.prompts.length ? sd.prompts : [sd.promptText];
}

/**
 * Both AI search baskets as one: times searched add up, the most searched
 * first. With `shared` (both hold a cluster, so both baskets count its
 * searches) a query counts once, at the higher of the two.
 */
export function mergeQueries(a, b, { shared = false } = {}) {
  if (!a && !b) return undefined;
  const times = new Map();
  for (const q of [...(a?.top || []), ...(b?.top || [])]) {
    const prev = times.get(q.query) || 0;
    const n = q.timesSearched || 0;
    times.set(q.query, shared ? Math.max(prev, n) : prev + n);
  }
  return {
    included: Math.max(a?.included || 0, b?.included || 0, times.size),
    excluded: Math.max(a?.excluded || 0, b?.excluded || 0),
    top: [...times]
      .sort((x, y) => y[1] - x[1])
      .slice(0, QUERIES_KEPT)
      .map(([query, timesSearched]) => ({ query, timesSearched })),
  };
}

/** What a merge is of: an opportunity, a task or a cluster. */
const mergeRef = (entry) => entry?.opportunityId ?? entry?.taskId ?? entry?.clusterId ?? null;

/** The merge record with this one added, once, the latest MERGED_KEPT kept. */
function recordMerge(list, entry, at) {
  const ref = mergeRef(entry);
  const kept = (list || []).filter((m) => !ref || mergeRef(m) !== ref);
  return [...kept, { ...entry, at }].slice(-MERGED_KEPT);
}

const SIGNAL_FIELDS = [
  'estAiVolume',
  'visibilityScore',
  'topCompetitorVisibility',
  'competitorGap',
  'intent',
  'scoreComponents',
  'windowDays',
];
const IMPACT_RANK = { low: 0, medium: 1, high: 2 };

/**
 * What the open opportunity `target` becomes when `incoming` (a cluster's
 * would-be opportunity, a task or a duplicate row) joins it. Its decision,
 * pages, assets and text stay as they are.
 *
 * @param {object} target - the open row: { cluster_id, related_cluster_ids, opportunity_score, impact, source_data }
 * @param {object} incoming - the same fields, as far as it has them
 * @param {object} entry - the record of the merge: { source, … } (`at` is added)
 * @returns {{ source_data: object, related_cluster_ids: string[], opportunity_score: number, impact: string }}
 */
export function mergeOpportunity(target, incoming, entry, at = new Date().toISOString()) {
  const t = target.source_data || {};
  const s = incoming.source_data || {};
  const targetScore = Number(target.opportunity_score) || 0;
  const incomingScore = Number(incoming.opportunity_score) || 0;
  // The stronger signal stays, with its score, so the score and its
  // breakdown agree: a task's higher priority doesn't replace a measured
  // signal, since it carries none of its own.
  const measured = (sd) => Boolean(sd.scoreComponents) || sd.estAiVolume !== undefined;
  const stronger = incomingScore > targetScore && (measured(s) || !measured(t));
  const signal = stronger ? s : t;
  const related = [
    ...new Set([...(target.related_cluster_ids || []), ...clustersOf(incoming)]),
  ].filter((id) => id !== target.cluster_id);
  const impact =
    (IMPACT_RANK[incoming.impact] ?? -1) > (IMPACT_RANK[target.impact] ?? -1)
      ? incoming.impact
      : target.impact;

  const sourceData = {
    ...t,
    prompts: unionTexts(promptsOf(t), promptsOf(s)),
    keywords: unionTexts(t.keywords, s.keywords, KEYWORDS_KEPT),
    competitorsCited: unionTexts(t.competitorsCited, s.competitorsCited, COMPETITORS_KEPT),
    merged: recordMerge(t.merged, entry, at),
  };
  // A cluster both already hold counts once: its searches are in both baskets.
  const held = new Set(clustersOf(target));
  const shared = clustersOf(incoming).some((id) => held.has(id));
  const queries = mergeQueries(t.queries, s.queries, { shared });
  if (queries) sourceData.queries = queries;
  for (const field of SIGNAL_FIELDS) {
    if (signal[field] !== undefined) sourceData[field] = signal[field];
  }
  // A duplicate's Action Center results stay in view on the one kept.
  const theirActions = [...(s.pastActions || []), ...Object.values(s.actions || {})];
  if (theirActions.length) {
    sourceData.pastActions = [...new Set([...(t.pastActions || []), ...theirActions])];
  }
  for (const key of ['prompts', 'keywords', 'competitorsCited']) {
    if (!sourceData[key].length) delete sourceData[key];
  }

  return {
    source_data: sourceData,
    related_cluster_ids: related,
    opportunity_score: stronger ? incomingScore : targetScore,
    impact: impact ?? target.impact,
  };
}

/**
 * The one-off clean-up of open opportunities that already answer the same
 * question: per group, the one that stays and those merged into it, with
 * what the one that stays becomes.
 *
 * @param {object[]} rows - a brand's opportunities (full rows); only open ones
 *   are grouped, and never an "Another angle" one
 * @param {{ withDrafts?: Set<string>, at?: string }} [opts] - `withDrafts`: ids with a draft
 * @returns {{ keep: object, merge: object[], update: object }[]}
 */
export function planSameQuestionMerges(rows, { withDrafts, at } = {}) {
  const open = (rows || []).filter((r) => isOpen(r) && !isAlternative(r));
  const parent = open.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const candidates = open.map(candidateOf);
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      if (
        answersSameQuestion(candidates[i], open[j]) ||
        answersSameQuestion(candidates[j], open[i])
      ) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map();
  open.forEach((row, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) || []), row]);
  });

  const plans = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [keep, ...merge] = [...group].sort(keeperOrder(withDrafts));
    let current = keep;
    for (const row of merge) {
      const update = mergeOpportunity(
        current,
        row,
        { source: row.source ?? 'system', opportunityId: row.id, title: row.title },
        at,
      );
      current = { ...current, ...update };
    }
    plans.push({
      keep,
      merge,
      update: {
        source_data: current.source_data,
        related_cluster_ids: current.related_cluster_ids,
        opportunity_score: current.opportunity_score,
        impact: current.impact,
      },
    });
  }
  return plans;
}
