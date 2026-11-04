import { computeAiVisibilityScore } from '@/lib/visibilityScore';
import { percentageChange } from '@/lib/metrics';
import type { DayWindow } from '@/lib/insightsWindows';
import type { PromptComparison } from '@/lib/insightsSamePrompts';

/**
 * The Insights "View breakdown" panel (VIS-001): which prompts, platforms and
 * topics moved a metric between two windows. The rows are built here from
 * the grouped components `insights_breakdown_groups` (00129) returns; the
 * totals come from the same aggregates as the KPI card, so the panel's
 * headline is the card's number.
 */

export type BreakdownMetric = 'mentions' | 'visibility';

/** The window and filters a breakdown explains: the ones the cards were loaded with. */
export interface BreakdownFilters {
  model?: string;
  region?: string;
  topicId?: string;
  dateFrom?: string;
  dateTo?: string;
  days?: DayWindow;
  /** "Compare: Same prompts" (VIS-002); on unless explicitly false. */
  samePrompts?: boolean;
}

export interface BreakdownRow {
  /** Unique identifier for the row: prompt_id / platform name / topic_id. */
  id: string;
  /** Display label: prompt text / platform name / topic name. */
  label: string;
  /** Optional secondary label (e.g. topic name for a prompt). */
  sublabel?: string;
  /** Metric value in the current window. */
  cur: number;
  /** Metric value in the previous window; null when there is none (All time). */
  prev: number | null;
  /** Absolute change (cur - prev); null without a previous window. */
  delta: number | null;
  /** Percentage change. Null when previous is zero or absent (use delta instead). */
  deltaPct: number | null;
  /** Answers that contributed in the current window. */
  curRuns: number;
  /** Answers that contributed in the previous window. */
  prevRuns: number;
}

export interface InsightsBreakdown {
  metric: BreakdownMetric;
  /** The card's number: every prompt in the current window. */
  curTotal: number;
  /**
   * The values the change is measured between: every prompt in each window,
   * or with Same prompts only the prompts answered in both (VIS-002).
   * prevTotal is null when there is no previous window (All time).
   */
  comparedCur: number;
  prevTotal: number | null;
  /** Which prompts the change compares, with the counts; null when unknown. */
  comparison: PromptComparison | null;
  delta: number | null;
  deltaPct: number | null;
  /** Days in each comparison window (24h is 1); null for All time. */
  windowDays: number | null;
  byPrompt: BreakdownRow[];
  byPlatform: BreakdownRow[];
  byTopic: BreakdownRow[];
  /** One-line rule-based root-cause summary for the drop/rise. */
  rootCause: string;
}

/** One (prompt, platform) entry of `insights_breakdown_groups`. */
export interface BreakdownGroup {
  prompt_id: string;
  platform: string;
  answers: number;
  mention_answers: number;
  citation_answers: number;
  sum_inv_position: number | null;
  position_count: number;
  mentions: number;
}

export interface BreakdownPrompt {
  id: string;
  text: string;
  topic_id: string | null;
  topic_name: string | null;
}

/** The payload of `insights_breakdown_groups` for one window. */
export interface BreakdownGroupsPayload {
  groups: BreakdownGroup[];
  prompts: BreakdownPrompt[];
}

export function parseBreakdownGroups(raw: unknown): BreakdownGroupsPayload {
  const payload = (raw ?? {}) as Partial<BreakdownGroupsPayload>;
  return {
    groups: (payload.groups ?? []).map((g) => ({
      prompt_id: String(g.prompt_id),
      platform: String(g.platform),
      answers: Number(g.answers ?? 0),
      mention_answers: Number(g.mention_answers ?? 0),
      citation_answers: Number(g.citation_answers ?? 0),
      sum_inv_position: g.sum_inv_position === null ? null : Number(g.sum_inv_position ?? 0),
      position_count: Number(g.position_count ?? 0),
      mentions: Number(g.mentions ?? 0),
    })),
    prompts: payload.prompts ?? [],
  };
}

interface Sums {
  answers: number;
  mentionAnswers: number;
  citationAnswers: number;
  sumInvPosition: number;
  positionCount: number;
  mentions: number;
}

const emptySums = (): Sums => ({
  answers: 0,
  mentionAnswers: 0,
  citationAnswers: 0,
  sumInvPosition: 0,
  positionCount: 0,
  mentions: 0,
});

function addGroup(s: Sums, g: BreakdownGroup) {
  s.answers += g.answers;
  s.mentionAnswers += g.mention_answers;
  s.citationAnswers += g.citation_answers;
  s.sumInvPosition += g.sum_inv_position ?? 0;
  s.positionCount += g.position_count;
  s.mentions += g.mentions;
}

/**
 * A group's value. Visibility is the card's formula over the group's own
 * answers, so a row reads exactly like the card would for that slice; a
 * group with no answers in the window scores 0.
 */
function valueOf(s: Sums, metric: BreakdownMetric): number {
  if (metric === 'mentions') return s.mentions;
  return (
    computeAiVisibilityScore({
      answers: s.answers,
      mentionAnswers: s.mentionAnswers,
      citationAnswers: s.citationAnswers,
      positionFactor: s.positionCount > 0 ? s.sumInvPosition / s.positionCount : null,
    }) ?? 0
  );
}

/**
 * Change between two values: points with one decimal for Visibility, a
 * count plus a percentage for Mentions. Null without a previous value.
 */
export function breakdownDelta(
  cur: number,
  prev: number | null,
  metric: BreakdownMetric,
): { delta: number | null; deltaPct: number | null } {
  if (prev === null) return { delta: null, deltaPct: null };
  if (metric === 'visibility') {
    return { delta: Math.round((cur - prev) * 10) / 10, deltaPct: null };
  }
  return { delta: cur - prev, deltaPct: percentageChange(cur, prev) };
}

function sumBy(groups: BreakdownGroup[], keyOf: (g: BreakdownGroup) => string): Map<string, Sums> {
  const out = new Map<string, Sums>();
  for (const g of groups) {
    const key = keyOf(g);
    const sums = out.get(key) ?? emptySums();
    addGroup(sums, g);
    out.set(key, sums);
  }
  return out;
}

const UNCATEGORIZED = '__uncategorized__';

/** Prompts with at least one answer in the window. */
const answeredPrompts = (p: BreakdownGroupsPayload) =>
  new Set(p.groups.filter((g) => g.answers > 0).map((g) => g.prompt_id));

/**
 * Per-prompt, per-platform and per-topic rows for one comparison. `prev` is
 * null when there is no previous window (All time): rows then carry no
 * previous value and no change. A slice missing from one window counts as 0
 * there. Rows come sorted by change, biggest drop first.
 *
 * With `samePrompts` (VIS-002), every row is measured on the prompts
 * answered in both windows, so a prompt added this period is never read as a
 * gain from 0.
 */
export function buildBreakdownRows(
  metric: BreakdownMetric,
  allCur: BreakdownGroupsPayload,
  allPrev: BreakdownGroupsPayload | null,
  platformLabel: (slug: string) => string,
  { samePrompts = false }: { samePrompts?: boolean } = {},
): { byPrompt: BreakdownRow[]; byPlatform: BreakdownRow[]; byTopic: BreakdownRow[] } {
  let cur = allCur;
  let prev = allPrev;
  if (samePrompts && allPrev) {
    const before = answeredPrompts(allPrev);
    const shared = new Set([...answeredPrompts(allCur)].filter((id) => before.has(id)));
    const only = (p: BreakdownGroupsPayload, keep: (id: string) => boolean) => ({
      ...p,
      groups: p.groups.filter((g) => keep(g.prompt_id)),
    });
    cur = only(allCur, (id) => shared.has(id));
    prev = only(allPrev, (id) => shared.has(id));
  }

  const prompts = new Map<string, BreakdownPrompt>();
  for (const p of [...(allPrev?.prompts ?? []), ...allCur.prompts]) prompts.set(p.id, p);
  const topicOf = (g: BreakdownGroup) => prompts.get(g.prompt_id)?.topic_id ?? UNCATEGORIZED;
  const topicNames = new Map<string, string>();
  for (const p of prompts.values()) {
    if (p.topic_id && p.topic_name) topicNames.set(p.topic_id, p.topic_name);
  }

  const rows = (
    keyOf: (g: BreakdownGroup) => string,
    describe: (key: string) => { label: string; sublabel?: string },
  ): BreakdownRow[] => {
    const curSums = sumBy(cur.groups, keyOf);
    const prevSums = prev ? sumBy(prev.groups, keyOf) : new Map<string, Sums>();
    const keys = new Set([...curSums.keys(), ...prevSums.keys()]);
    const out = [...keys].map((key): BreakdownRow => {
      const c = curSums.get(key) ?? emptySums();
      const p = prevSums.get(key) ?? emptySums();
      const curValue = valueOf(c, metric);
      const prevValue = prev ? valueOf(p, metric) : null;
      return {
        id: key,
        ...describe(key),
        cur: curValue,
        prev: prevValue,
        ...breakdownDelta(curValue, prevValue, metric),
        curRuns: c.answers,
        prevRuns: p.answers,
      };
    });
    out.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
    return out;
  };

  return {
    byPrompt: rows(
      (g) => g.prompt_id,
      (id) => {
        const info = prompts.get(id);
        return {
          label: info?.text ?? 'Unknown prompt',
          sublabel: info?.topic_name ?? undefined,
        };
      },
    ),
    byPlatform: rows(
      (g) => g.platform,
      (slug) => ({ label: platformLabel(slug) }),
    ),
    byTopic: rows(topicOf, (id) => ({
      label: id === UNCATEGORIZED ? 'Uncategorized' : (topicNames.get(id) ?? 'Unknown topic'),
    })),
  };
}

/**
 * The row that did the most in the direction of the overall change: the
 * biggest drop when the total fell, the biggest gain when it rose. Null when
 * nothing moved that way, or when there is no previous window. A row
 * answered in only one window has no change to credit: a new prompt didn't
 * "rise 80 pts" from nothing (VIS-005).
 */
export function pickDriver(rows: BreakdownRow[], totalDelta: number | null): BreakdownRow | null {
  if (totalDelta === null || totalDelta === 0) return null;
  let best: BreakdownRow | null = null;
  for (const r of rows) {
    if (r.delta === null || r.prevRuns === 0 || r.curRuns === 0) continue;
    if (totalDelta < 0 ? r.delta < (best?.delta ?? 0) : r.delta > (best?.delta ?? 0)) best = r;
  }
  return best;
}
