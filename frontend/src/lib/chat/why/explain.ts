/**
 * Why did it move (CHAT-22 §1, explain_change): the analysis itself, from
 * the counts the server read of scheduled tracking (chat_why_cells), with no
 * model call and no engine query (Addendum 2 G). Pure, so every number the
 * answer may say is computed here and kept in chat_why_analyses (00420).
 *
 * The metrics are the app's own (Insights' cards): visibility is the share
 * of tracked prompts the brand was named or cited in (a prompt is one cell,
 * its engines together); the others are rates per prompt × engine cell
 * (mention rate, citation rate, share of voice by mentions, average position).
 * The Insights Visibility score (visibility_score) blends three of them;
 * why/score.ts explains it with these same steps, part by part.
 *
 * The steps, as §1 item 5 has them:
 *   1. Noise: the change's standard error from the pooled rate of the two
 *      periods; a change of at most 2 × SE is within normal swing (none at
 *      all always is). The average position has no spread within a cell, so
 *      with few cells it can't be measured.
 *   2. Change point: the day the daily series splits into the two most
 *      different halves (at least 3 days each).
 *   3. Mix effect: what the set's change explains. First the engines
 *      tracked in one period only (the change minus the change counted on
 *      the engines in both; visibility's prompts are recounted on those),
 *      then the prompts (minus the change on the cells tracked in both).
 *      Cells tracked in both but counted in one only (the brand not named,
 *      for the average position or share of voice) are a line of their own,
 *      never a set change; cells in both with fewer than 3 runs in a period
 *      are "not enough data", one more.
 *   4. Attribution: each stable cell's own rate change (at its average
 *      weight) goes to one cause, first rule that matches its evidence (a
 *      site change, a citation lost to a competitor, a citation lost, a
 *      competitor entering), or gained ones; its change of weight stays in
 *      the remainder. A cell whose answers couldn't all be read gets none.
 *   5. Engine weather: not in Wave 2 (no benchmark panel yet).
 *   6. Shares of the change, against the parts that moved its way: whole
 *      percents that add up to 100 (largest remainder); a part that moved
 *      the other way partly offset it, in points. Within normal swing, no
 *      shares. The rest is normal swing or unexplained.
 *   7. Confidence by the cells that show the cause.
 * Never "caused": the words are the answer's, from these shares (§ shared 2).
 */

export const WHY_METRICS = [
  'visibility',
  'mention_rate',
  'share_of_voice',
  'citations',
  'avg_position',
  'visibility_score',
] as const;
export type WhyMetric = (typeof WHY_METRICS)[number];

/** Runs a cell needs in each period to count (§1 item 5.1). */
export const MIN_RUNS = 3;
/** Bars shown, at most, "other" included (§1 item 4). */
export const MAX_CAUSES = 5;
/** A cause under this share of the change folds into "other". */
export const MIN_SHARE = 10;
/** Stable cells the average position needs to measure its swing (no spread within a cell). */
export const MIN_POSITION_CELLS = 5;
/** Evidence rows kept per cause. */
const MAX_REFS = 10;

/** A cell's counts in one period, as chat_why_cells sums them. */
export interface CellCounts {
  /** Tracked day rows, and those where the brand was named or cited. */
  runs: number;
  visibleRuns: number;
  /** Answers, those naming the brand and those citing its pages. */
  answers: number;
  mentionAnswers: number;
  citationAnswers: number;
  /** Mentions of the brand, and of its tracked competitors (share of voice). */
  brandMentions: number;
  competitorMentions: number;
  /** Positions where the brand was named: their sum, the sum of 1/position, and their count. */
  sumPosition: number;
  sumInvPosition: number;
  positionCount: number;
}

/** A day of the series: the counts, with the prompts named or cited and those tracked. */
export interface DayCounts extends CellCounts {
  visiblePrompts: number;
  activePrompts: number;
}

/**
 * One cell, its counts in a and in b: a prompt × engine × location, or for
 * visibility a prompt (its engines together).
 */
export interface WhyCell {
  key: string;
  promptId: string;
  /** The engine's slug (platform or model); "all" for a visibility prompt. */
  engine: string;
  a: CellCounts | null;
  b: CellCounts | null;
}

/** An answer, a cited page or an audit the evidence drawer opens (§1 item 4). */
export interface EvidenceRef {
  type: 'answer' | 'audit';
  id: string;
  /** The day it was tracked or audited, ISO date. */
  date: string;
  period: 'a' | 'b';
  url?: string;
}

/** What a cell's answers show, read for the cells that moved most. */
export interface CellEvidence {
  /** The brand's own pages cited in its answers, per period. */
  ownCitedA: string[];
  ownCitedB: string[];
  /** Tracked competitors' pages cited, per period. */
  competitorCitedA: string[];
  competitorCitedB: string[];
  /** Answers naming a tracked competitor, as a share of the period's answers. */
  competitorRateA: number;
  competitorRateB: number;
  /** Own pages whose AI-reach signals changed between the periods (Site Audit). */
  siteChanges: {
    url: string;
    direction: 'worse' | 'better';
    signals: string[];
    ref: EvidenceRef;
  }[];
  /** The answers read, per period. */
  answersA: EvidenceRef[];
  answersB: EvidenceRef[];
  /** Not all its answers could be read: no cause is drawn from it. */
  partial?: boolean;
  /** The prompt's text, for the cause's rows. */
  prompt?: string;
}

/** One prompt a cause shows (§1 item 4's table): what was cited before and now, and when. */
export interface CauseRow {
  prompt: string;
  /** The page cited in the earlier period, or null. */
  before: string | null;
  /** The page cited in the later one, or null when none of the brand's or a rival's was. */
  now: string | null;
  /** The newest answer of the later period, ISO date. */
  date: string | null;
  /** That answer, for the evidence drawer. */
  answer: EvidenceRef | null;
}

export type CauseKind =
  | 'site_change'
  | 'lost_citation_to_competitor'
  | 'lost_citation'
  | 'competitor_entered'
  | 'won_citation_from_competitor'
  | 'gained_citation'
  | 'competitor_left'
  | 'engines_changed'
  | 'prompt_set_changed'
  | 'not_mentioned'
  | 'not_enough_data'
  | 'other';

export type Confidence = 'low' | 'medium' | 'high';

/** The Visibility score's three parts (lib/visibilityScore.ts). */
export type ScoreComponent = 'mention' | 'citation' | 'position';

/** The next step a cause offers (§1 item 4 "One fix per cause"), by its skill. */
const FIX_SKILL: Partial<Record<CauseKind, string>> = {
  site_change: 'site_audit_fix',
  lost_citation_to_competitor: 'winback',
  lost_citation: 'winback',
  competitor_entered: 'beat',
  prompt_set_changed: 'restore_prompt',
};

export interface WhyCause {
  kind: CauseKind;
  /**
   * Its share of the change, 0–100, among the parts that moved its way;
   * null when it partly offset the change, or the change is within normal swing.
   */
  share: number | null;
  /** Its part of the change, in the metric's unit (points, or positions), signed. */
  contribution: number;
  /** It moved against the change: it partly offset it. */
  offset: boolean;
  confidence: Confidence;
  /** The cells that show it. */
  cells: number;
  evidence_refs: EvidenceRef[];
  fix_skill: string | null;
  /** The pages it is about (own pages lost or gained, a changed page). */
  urls?: string[];
  /** visibility_score: its points through each part of the score. */
  components?: Partial<Record<ScoreComponent, number>>;
  /** The prompts that show it, up to 10. */
  rows?: CauseRow[];
}

/** The explain_change contract (§1 item 6), engine weather aside (not in Wave 2). */
export interface WhyResult {
  metric: WhyMetric;
  /** "pts" for a rate, "positions" for the average position. */
  unit: 'pts' | 'positions';
  period_a: { from: string; to: string };
  period_b: { from: string; to: string };
  value_a: number | null;
  value_b: number | null;
  delta: number | null;
  /** The standard error of the change; null when it can't be measured. */
  se: number | null;
  noise_verdict: 'beyond_normal_swing' | 'within_normal_swing' | 'not_measurable';
  /** A decline is a lower rate, or a higher average position. */
  direction: 'declined' | 'improved' | 'flat';
  change_point: { date: string; before: number; after: number } | null;
  mix_effect: {
    contribution: number;
    share: number | null;
    prompts_added: number;
    prompts_removed: number;
    engines_added: string[];
    engines_removed: string[];
  };
  /** Up to 5 bars, "other" included, largest first. */
  causes: WhyCause[];
  /** Cells tracked in both periods with fewer than 3 runs in one ("Not enough data"). */
  excluded_cells: number;
  /** Cells compared in both periods. */
  stable_cells: number;
  /** Cells tracked in a period where the metric had nothing to count (the brand not named). */
  unmentioned_cells: { a: number; b: number };
  /** The moved cells' answers couldn't all be read: some got no cause. */
  evidence_partial: boolean;
  /**
   * visibility_score: each part of the score, its value in each period (a
   * rate in points, the position factor 0–1) and its points of the change.
   */
  components?: {
    kind: ScoreComponent;
    weight: number;
    value_a: number | null;
    value_b: number | null;
    contribution: number;
  }[];
  unexplained: {
    kind: 'normal_swing' | 'unexplained';
    contribution: number;
    share: number | null;
  };
}

const round = (value: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** A metric's count over what it counts in, for one cell's period. */
export function ratioOf(metric: WhyMetric, c: CellCounts): { num: number; den: number } {
  switch (metric) {
    // A prompt: named or cited at all in the period, of it being tracked.
    case 'visibility':
      return { num: c.visibleRuns > 0 ? 1 : 0, den: c.runs > 0 ? 1 : 0 };
    case 'mention_rate':
      return { num: c.mentionAnswers, den: c.answers };
    case 'citations':
      return { num: c.citationAnswers, den: c.answers };
    case 'share_of_voice':
      return { num: c.brandMentions, den: c.brandMentions + c.competitorMentions };
    case 'avg_position':
      return { num: c.sumPosition, den: c.positionCount };
    // The score isn't one ratio (why/score.ts): this is what it counts in, answers.
    case 'visibility_score':
      return { num: c.mentionAnswers, den: c.answers };
  }
}

/** A day's value: visibility as Insights counts it per day, the others as their cells. */
function dayRatio(metric: WhyMetric, day: DayCounts): { num: number; den: number } {
  return metric === 'visibility'
    ? { num: day.visiblePrompts, den: day.activePrompts }
    : ratioOf(metric, day);
}

/** A rate reads in points (0–100); the average position as it is. */
const scaleOf = (metric: WhyMetric) => (metric === 'avg_position' ? 1 : 100);

/** For the average position, a lower number is better. */
const betterSign = (metric: WhyMetric) => (metric === 'avg_position' ? -1 : 1);

/** Tracked in the period: the cell had runs, whatever the metric counted. */
export const tracked = (c: CellCounts | null): c is CellCounts => !!c && c.runs > 0;

/** The pooled value of some cells' parts, in the metric's unit; null with nothing to count. */
function valueOf(metric: WhyMetric, parts: { num: number; den: number }[]): number | null {
  const den = parts.reduce((sum, p) => sum + p.den, 0);
  if (den <= 0) return null;
  return (parts.reduce((sum, p) => sum + p.num, 0) / den) * scaleOf(metric);
}

/**
 * The change's standard error over the stable cells, or null when it can't
 * be measured. A rate: the pooled rate of the two periods, p(1−p)(1/Na + 1/Nb).
 * The average position: the cells' spread around the mean, with enough cells.
 */
export function changeSe(
  metric: WhyMetric,
  a: { num: number; den: number }[],
  b: { num: number; den: number }[],
): number | null {
  const denA = a.reduce((s, p) => s + p.den, 0);
  const denB = b.reduce((s, p) => s + p.den, 0);
  if (denA <= 0 || denB <= 0) return null;
  if (metric !== 'avg_position') {
    const p = (a.reduce((s, x) => s + x.num, 0) + b.reduce((s, x) => s + x.num, 0)) / (denA + denB);
    const rate = Math.min(1, Math.max(0, p));
    return Math.sqrt(rate * (1 - rate) * (1 / denA + 1 / denB)) * scaleOf(metric);
  }
  if (a.length < MIN_POSITION_CELLS) return null;
  const spread = (parts: { num: number; den: number }[], den: number) => {
    const mean = parts.reduce((s, p) => s + p.num, 0) / den;
    return parts.reduce((s, p) => s + (p.den / den) ** 2 * (p.num / p.den - mean) ** 2, 0);
  };
  return Math.sqrt(spread(a, denA) + spread(b, denB));
}

/**
 * The day the daily series changed most: the split into two runs of days
 * (3 at least each) whose means differ most, weighted by their lengths.
 */
export function changePoint(
  metric: WhyMetric,
  daily: { day: string; counts: DayCounts }[],
): WhyResult['change_point'] {
  return changePointOf(
    daily
      .map((d) => ({ day: d.day, ...dayRatio(metric, d.counts) }))
      .filter((d) => d.den > 0)
      .map((d) => ({ day: d.day, value: (d.num / d.den) * scaleOf(metric) })),
  );
}

/** The change point of a daily series of values, in any order. */
export function changePointOf(values: { day: string; value: number }[]): WhyResult['change_point'] {
  const series = [...values].sort((x, y) => x.day.localeCompare(y.day));
  if (series.length < 2 * 3) return null;
  let best: { at: number; score: number } | null = null;
  for (let at = 3; at <= series.length - 3; at++) {
    const left = series.slice(0, at);
    const right = series.slice(at);
    const m1 = left.reduce((s, d) => s + d.value, 0) / left.length;
    const m2 = right.reduce((s, d) => s + d.value, 0) / right.length;
    const score = ((left.length * right.length) / series.length) * (m1 - m2) ** 2;
    if (!best || score > best.score) best = { at, score };
  }
  if (!best || best.score === 0) return null;
  const mean = (list: { value: number }[]) => list.reduce((s, d) => s + d.value, 0) / list.length;
  return {
    date: series[best.at].day,
    before: round(mean(series.slice(0, best.at))),
    after: round(mean(series.slice(best.at))),
  };
}

const minus = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));

/**
 * The cause one stable cell's move goes to, first rule that matches (§1
 * item 5.4); null when its answers show none, or couldn't all be read.
 * `worse`: the cell's own rate moved the bad way.
 */
export function cellCause(
  evidence: CellEvidence | undefined,
  worse: boolean,
  /** Only these kinds (a part of the Visibility score explains its own); all when absent. */
  kinds?: readonly CauseKind[],
): { kind: CauseKind; urls: string[]; refs: EvidenceRef[] } | null {
  if (!evidence || evidence.partial) return null;
  const allowed = (kind: CauseKind) => !kinds || kinds.includes(kind);
  const refsOf = (period: 'a' | 'b') => (period === 'a' ? evidence.answersA : evidence.answersB);
  const site = evidence.siteChanges.filter(
    (change) => change.direction === (worse ? 'worse' : 'better'),
  );
  if (allowed('site_change') && site.length > 0) {
    return {
      kind: 'site_change',
      urls: site.map((change) => change.url),
      refs: [...site.map((change) => change.ref), ...refsOf(worse ? 'b' : 'a').slice(0, 2)],
    };
  }
  // An own page cited in one period only; a tracked competitor's cited instead (or before).
  const moved = worse
    ? minus(evidence.ownCitedA, evidence.ownCitedB)
    : minus(evidence.ownCitedB, evidence.ownCitedA);
  const swapped = (worse ? evidence.competitorCitedB : evidence.competitorCitedA).length > 0;
  const citation: CauseKind = worse
    ? swapped
      ? 'lost_citation_to_competitor'
      : 'lost_citation'
    : swapped
      ? 'won_citation_from_competitor'
      : 'gained_citation';
  if (allowed(citation) && moved.length > 0) {
    return {
      kind: citation,
      urls: moved,
      refs: [...refsOf('a').slice(0, 2), ...refsOf('b').slice(0, 2)],
    };
  }
  const rival: CauseKind = worse ? 'competitor_entered' : 'competitor_left';
  const rivalMoved = worse
    ? evidence.competitorRateB > evidence.competitorRateA
    : evidence.competitorRateB < evidence.competitorRateA;
  if (allowed(rival) && rivalMoved) {
    return { kind: rival, urls: [], refs: refsOf('b').slice(0, 3) };
  }
  return null;
}

/**
 * A cell's row for its cause's table, by the way the cell moved (`worse`,
 * as cellCause has it): a loss shows the own page cited before and what is
 * cited now; a gain the competitor's page cited before and the own page now.
 */
export function rowOf(evidence: CellEvidence, worse: boolean): CauseRow | null {
  if (!evidence.prompt) return null;
  const latest = evidence.answersB[0] ?? null;
  return {
    prompt: evidence.prompt,
    before: worse
      ? (minus(evidence.ownCitedA, evidence.ownCitedB)[0] ?? evidence.ownCitedA[0] ?? null)
      : (evidence.competitorCitedA[0] ?? null),
    now: worse
      ? (evidence.competitorCitedB[0] ?? evidence.ownCitedB[0] ?? null)
      : (minus(evidence.ownCitedB, evidence.ownCitedA)[0] ?? evidence.ownCitedB[0] ?? null),
    date: latest?.date ?? null,
    answer: latest,
  };
}

/** High: shown in 10 cells or more; Medium: in 3 to 9; Low: fewer (§1 item 5.7). */
export function confidenceOf(cells: number): Confidence {
  if (cells >= 10) return 'high';
  if (cells >= 3) return 'medium';
  return 'low';
}

/** In both periods with something to count in each. */
const inBoth = (metric: WhyMetric, cell: WhyCell) =>
  tracked(cell.a) &&
  tracked(cell.b) &&
  ratioOf(metric, cell.a).den > 0 &&
  ratioOf(metric, cell.b).den > 0;

/** A cell in both periods with enough runs in each (the stable set). */
const isStable = (metric: WhyMetric, cell: WhyCell) =>
  inBoth(metric, cell) && cell.a!.runs >= MIN_RUNS && cell.b!.runs >= MIN_RUNS;

/**
 * The stable cells whose own rate moved most, by key: those whose answers
 * are read for evidence (the rest go to "other" or the remainder).
 */
export function movedCells(metric: WhyMetric, cells: WhyCell[], count: number): string[] {
  return cells
    .filter((cell) => isStable(metric, cell))
    .map((cell) => {
      const a = ratioOf(metric, cell.a!);
      const b = ratioOf(metric, cell.b!);
      return { key: cell.key, moved: Math.abs(b.num / b.den - a.num / a.den) };
    })
    .filter((cell) => cell.moved > 0)
    .sort((x, y) => y.moved - x.moved)
    .slice(0, count)
    .map((cell) => cell.key);
}

/** A number's sign, a float's leftover (±1e−14) counting as none. */
export const signOf = (value: number) => (Math.abs(value) < 1e-9 ? 0 : Math.sign(value));

/**
 * Whole percents that add up as the parts do (100 for all of the change):
 * each rounded down, the percents left to the largest remainders. A null
 * part keeps none.
 */
export function wholeShares(raw: (number | null)[]): (number | null)[] {
  const floors = raw.map((share) => (share === null ? null : Math.floor(share)));
  const given = floors.reduce<number>((sum, share) => sum + (share ?? 0), 0);
  const target = Math.round(raw.reduce<number>((sum, share) => sum + (share ?? 0), 0));
  const order = raw
    .map((share, i) => ({ i, rest: share === null ? -1 : share - Math.floor(share) }))
    .filter((part) => part.rest >= 0)
    .sort((x, y) => y.rest - x.rest);
  const out = [...floors];
  for (let k = 0; k < target - given && k < order.length; k++) {
    out[order[k].i] = (out[order[k].i] ?? 0) + 1;
  }
  return out;
}

/** A part of a change before its share: a cause, the set's change or "not enough data". */
export type WhyPart = Omit<WhyCause, 'share' | 'offset'>;

/** The cells a change is compared on (§1 item 5.3). */
export interface CellSets {
  enginesA: Set<string>;
  enginesB: Set<string>;
  enginesChanged: boolean;
  /** The cells on the engines tracked in both periods. */
  same: WhyCell[];
  /** Of those, tracked in both periods; counted in both; with enough runs in each (stable). */
  trackedBoth: WhyCell[];
  both: WhyCell[];
  stable: WhyCell[];
}

/** The sets, by what a period of a cell counts in (`counted`). */
export function cellSets(
  input: { cells: WhyCell[]; engines?: { a: string[]; b: string[] }; sameEngineCells?: WhyCell[] },
  counted: (c: CellCounts | null) => boolean,
): CellSets {
  const { cells } = input;
  const enginesIn = (period: 'a' | 'b') =>
    new Set(
      input.engines?.[period] ?? cells.filter((c) => tracked(c[period])).map((c) => c.engine),
    );
  const [enginesA, enginesB] = [enginesIn('a'), enginesIn('b')];
  const same =
    input.sameEngineCells ?? cells.filter((c) => enginesA.has(c.engine) && enginesB.has(c.engine));
  const trackedBoth = same.filter((c) => tracked(c.a) && tracked(c.b));
  const both = trackedBoth.filter((c) => counted(c.a) && counted(c.b));
  return {
    enginesA,
    enginesB,
    enginesChanged:
      [...enginesA].some((e) => !enginesB.has(e)) || [...enginesB].some((e) => !enginesA.has(e)),
    same,
    trackedBoth,
    both,
    stable: both.filter((c) => c.a!.runs >= MIN_RUNS && c.b!.runs >= MIN_RUNS),
  };
}

/** A prompt (or engine) tracked in one period only, on the engines in both. */
const promptSetChanged = (sets: CellSets) => sets.same.some((c) => tracked(c.a) !== tracked(c.b));

/** The set changed: an engine, or a prompt, tracked in one period only. */
export const setChangedOf = (sets: CellSets) => sets.enginesChanged || promptSetChanged(sets);

/**
 * The set's parts of a change: engines added or dropped, then prompts;
 * cells tracked in both but counted in one only (the brand not named);
 * cells with too few runs. Arithmetic, not inference: the set did change.
 */
export function setParts(
  cells: WhyCell[],
  sets: CellSets,
  change: { engineMix: number; promptMix: number; unmentioned: number; notEnough: number },
): WhyPart[] {
  const parts: WhyPart[] = [];
  if (sets.enginesChanged && round(change.engineMix, 2) !== 0) {
    const sameByKey = new Map(sets.same.map((c) => [c.key, c]));
    parts.push({
      kind: 'engines_changed',
      contribution: change.engineMix,
      confidence: 'high',
      // The cells an added or dropped engine counts in.
      cells: cells.filter((c) => {
        const kept = sameByKey.get(c.key);
        return !kept || kept.a?.runs !== c.a?.runs || kept.b?.runs !== c.b?.runs;
      }).length,
      evidence_refs: [],
      fix_skill: null,
    });
  }
  if (promptSetChanged(sets) && round(change.promptMix, 2) !== 0) {
    parts.push({
      kind: 'prompt_set_changed',
      contribution: change.promptMix,
      confidence: 'high',
      cells: sets.same.filter((c) => tracked(c.a) !== tracked(c.b)).length,
      evidence_refs: [],
      fix_skill: FIX_SKILL.prompt_set_changed ?? null,
    });
  }
  if (round(change.unmentioned, 2) !== 0) {
    parts.push({
      kind: 'not_mentioned',
      contribution: change.unmentioned,
      confidence: 'low',
      cells: sets.trackedBoth.length - sets.both.length,
      evidence_refs: [],
      fix_skill: null,
    });
  }
  if (round(change.notEnough, 2) !== 0) {
    parts.push({
      kind: 'not_enough_data',
      contribution: change.notEnough,
      confidence: 'low',
      cells: sets.both.length - sets.stable.length,
      evidence_refs: [],
      fix_skill: null,
    });
  }
  return parts;
}

/** Cells' moves, gathered by the cause their evidence shows. */
export type CauseTally = Map<
  CauseKind,
  {
    contribution: number;
    cells: Set<string>;
    refs: EvidenceRef[];
    urls: Set<string>;
    components: Partial<Record<ScoreComponent, number>>;
    rows: CauseRow[];
  }
>;

/**
 * Adds a cell's move to its cause (and, for the score, to the part it
 * moved), with the cell's row for the cause's table the first time it counts there.
 */
export function tallyCause(
  tally: CauseTally,
  cell: string,
  cause: { kind: CauseKind; urls: string[]; refs: EvidenceRef[] },
  own: number,
  component?: ScoreComponent,
  row?: CauseRow | null,
) {
  const entry = tally.get(cause.kind) ?? {
    contribution: 0,
    cells: new Set<string>(),
    refs: [],
    urls: new Set<string>(),
    components: {},
    rows: [],
  };
  entry.contribution += own;
  if (row && !entry.cells.has(cell) && entry.rows.length < MAX_REFS) entry.rows.push(row);
  entry.cells.add(cell);
  for (const ref of cause.refs) if (entry.refs.length < MAX_REFS) entry.refs.push(ref);
  for (const url of cause.urls) entry.urls.add(url);
  if (component) entry.components[component] = (entry.components[component] ?? 0) + own;
  tally.set(cause.kind, entry);
}

/** The tallied causes as parts. */
export function causeParts(tally: CauseTally): WhyPart[] {
  return [...tally.entries()].map(([kind, entry]) => ({
    kind,
    contribution: entry.contribution,
    confidence: confidenceOf(entry.cells.size),
    cells: entry.cells.size,
    evidence_refs: entry.refs,
    fix_skill: FIX_SKILL[kind] ?? null,
    ...(entry.urls.size > 0 ? { urls: [...entry.urls].slice(0, 5) } : {}),
    ...(Object.keys(entry.components).length > 0 ? { components: entry.components } : {}),
    ...(entry.rows.length > 0 ? { rows: entry.rows } : {}),
  }));
}

/** Within normal swing at 2 × SE (none at all always is); not measurable without an SE. */
export function noiseOf(delta: number | null, se: number | null): WhyResult['noise_verdict'] {
  if (delta === null) return 'not_measurable';
  if (round(delta, 6) === 0) return 'within_normal_swing';
  if (se === null) return 'not_measurable';
  return Math.abs(delta) <= 2 * se ? 'within_normal_swing' : 'beyond_normal_swing';
}

const roundComponents = (components: Partial<Record<ScoreComponent, number>> | undefined) =>
  components
    ? Object.fromEntries(Object.entries(components).map(([k, v]) => [k, round(v, 2)]))
    : undefined;

/**
 * The bars (§1 items 5.6–5.7): shares among what moved the change's way,
 * whole percents adding up to 100 with the rest (none when `sharing` is
 * false: within normal swing, or nothing stable); largest first, at most 5,
 * past 4 or under 10% into "other". The mix's share is before rounding.
 */
export function rankParts(
  parts: WhyPart[],
  residual: number,
  delta: number | null,
  sharing: boolean,
  mix: number,
): { causes: WhyCause[]; residualShare: number | null; mixShare: number | null } {
  const way = signOf(delta ?? 0);
  const towards = [...parts.map((p) => p.contribution), residual].filter(
    (c) => signOf(c) === way && way !== 0,
  );
  const total = towards.reduce((s, c) => s + c, 0);
  /** Its share before rounding; null when it didn't move the change's way. */
  const shareOf = (contribution: number) =>
    sharing && total !== 0 && signOf(contribution) === way
      ? Math.min(100, Math.max(0, (contribution / total) * 100))
      : null;

  const sorted = [...parts].sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution));
  const small = (p: WhyPart) => {
    const share = shareOf(p.contribution);
    return share !== null && share < MIN_SHARE;
  };
  const big = sorted.filter((p) => !small(p));
  const needsOther = big.length < sorted.length || big.length > MAX_CAUSES;
  const shown = needsOther ? big.slice(0, MAX_CAUSES - 1) : big;
  const folded = sorted.filter((p) => !shown.includes(p));
  const causes: WhyCause[] = shown.map((p) => {
    const components = roundComponents(p.components);
    return {
      ...p,
      contribution: round(p.contribution, 2),
      share: shareOf(p.contribution),
      offset: way !== 0 && signOf(p.contribution) === -way,
      ...(components ? { components } : {}),
    };
  });
  if (folded.length > 0) {
    const contribution = folded.reduce((s, p) => s + p.contribution, 0);
    const merged: Partial<Record<ScoreComponent, number>> = {};
    for (const p of folded) {
      for (const [k, v] of Object.entries(p.components ?? {}) as [ScoreComponent, number][]) {
        merged[k] = (merged[k] ?? 0) + v;
      }
    }
    causes.push({
      kind: 'other',
      contribution: round(contribution, 2),
      share: shareOf(contribution),
      offset: way !== 0 && signOf(contribution) === -way,
      confidence: 'low',
      cells: folded.reduce((s, p) => s + p.cells, 0),
      evidence_refs: folded.flatMap((p) => p.evidence_refs).slice(0, MAX_REFS),
      fix_skill: null,
      ...(Object.keys(merged).length > 0 ? { components: roundComponents(merged) } : {}),
    });
  }
  // The bars and the rest, in whole percents that add up to 100.
  const shares = wholeShares([...causes.map((c) => c.share), shareOf(residual)]);
  causes.forEach((cause, i) => (cause.share = shares[i]));
  return { causes, residualShare: shares[causes.length], mixShare: shareOf(mix) };
}

/** What the set's prompts and engines were in each period, for mix_effect. */
export function setNames(cells: WhyCell[], sets: CellSets) {
  const promptsIn = (period: 'a' | 'b') =>
    new Set(cells.filter((c) => tracked(c[period])).map((c) => c.promptId));
  const [pa, pb] = [promptsIn('a'), promptsIn('b')];
  return {
    prompts_added: minus([...pb], [...pa]).length,
    prompts_removed: minus([...pa], [...pb]).length,
    engines_added: minus([...sets.enginesB], [...sets.enginesA]),
    engines_removed: minus([...sets.enginesA], [...sets.enginesB]),
  };
}

/** The analysis, from the cells, the daily series and the moved cells' evidence. */
export function explainChange(input: {
  metric: WhyMetric;
  periodA: { from: string; to: string };
  periodB: { from: string; to: string };
  cells: WhyCell[];
  /** The engines tracked in each period; else read from the cells (visibility's don't name theirs). */
  engines?: { a: string[]; b: string[] };
  /**
   * The cells counted on the engines tracked in both periods only: what the
   * periods are compared on (visibility's prompts recounted without an added
   * or a dropped engine). Else the cells of those engines.
   */
  sameEngineCells?: WhyCell[];
  daily: { day: string; counts: DayCounts }[];
  evidence: Map<string, CellEvidence>;
}): WhyResult {
  const { metric, cells } = input;
  const unit = metric === 'avg_position' ? 'positions' : 'pts';
  const scale = scaleOf(metric);
  const sign = betterSign(metric);
  const counted = (c: CellCounts | null): c is CellCounts =>
    tracked(c) && ratioOf(metric, c).den > 0;
  /** The value over some cells, each period counting the cells it can. */
  const valueIn = (list: WhyCell[], period: 'a' | 'b') =>
    valueOf(
      metric,
      list.flatMap((c) => {
        const counts = c[period];
        return counted(counts) ? [ratioOf(metric, counts)] : [];
      }),
    );
  const changeIn = (list: WhyCell[]) => {
    const a = valueIn(list, 'a');
    const b = valueIn(list, 'b');
    return a !== null && b !== null ? b - a : 0;
  };

  // The headline: every cell tracked in the period, as the app's own pages count it.
  const valueA = valueIn(cells, 'a');
  const valueB = valueIn(cells, 'b');
  const delta = valueA !== null && valueB !== null ? valueB - valueA : null;

  const sets = cellSets(input, counted);
  const { stable } = sets;
  // The set's change: engines added or dropped, then prompts (§1 item 5.3).
  const deltaSame = changeIn(sets.same);
  const deltaTracked = changeIn(sets.trackedBoth);
  const deltaBoth = changeIn(sets.both);
  const deltaStable = changeIn(stable);
  const engineMix = delta === null ? 0 : delta - deltaSame;
  const promptMix = delta === null ? 0 : deltaSame - deltaTracked;
  const mix = engineMix + promptMix;
  const partsA = stable.map((c) => ratioOf(metric, c.a!));
  const partsB = stable.map((c) => ratioOf(metric, c.b!));
  const se = stable.length > 0 ? changeSe(metric, partsA, partsB) : null;
  const noise = noiseOf(delta, se);

  // Each stable cell's part of the stable change, split: its own rate's
  // change at its average weight (what evidence explains), and its change
  // of weight (the remainder's). The two sum to its part, the parts to deltaStable.
  const denA = partsA.reduce((s, p) => s + p.den, 0);
  const denB = partsB.reduce((s, p) => s + p.den, 0);
  const tally: CauseTally = new Map();
  stable.forEach((cell, i) => {
    const ra = partsA[i];
    const rb = partsB[i];
    const moved = rb.num / rb.den - ra.num / ra.den;
    const own = ((ra.den / denA + rb.den / denB) / 2) * moved * scale;
    if (own === 0) return;
    const found = input.evidence.get(cell.key);
    const worse = moved * sign < 0;
    const cause = cellCause(found, worse);
    if (cause && found) tallyCause(tally, cell.key, cause, own, undefined, rowOf(found, worse));
  });

  const parts = [
    ...causeParts(tally),
    ...setParts(cells, sets, {
      engineMix,
      promptMix,
      // Tracked in both, counted in one only: the brand not named there.
      unmentioned: deltaTracked - deltaBoth,
      notEnough: deltaBoth - deltaStable,
    }),
  ];
  // The rest: cells no evidence explained, their changes of weight, and normal swing.
  const residual = (delta ?? 0) - parts.reduce((s, p) => s + p.contribution, 0);
  const { causes, residualShare, mixShare } = rankParts(
    parts,
    residual,
    delta,
    noise === 'beyond_normal_swing' && stable.length > 0,
    mix,
  );
  const setChanged = setChangedOf(sets);

  return {
    metric,
    unit,
    period_a: input.periodA,
    period_b: input.periodB,
    value_a: valueA === null ? null : round(valueA),
    value_b: valueB === null ? null : round(valueB),
    delta: delta === null ? null : round(delta),
    se: se === null ? null : round(se, 2),
    noise_verdict: noise,
    direction:
      delta === null || round(delta) === 0 ? 'flat' : delta * sign < 0 ? 'declined' : 'improved',
    change_point: changePoint(metric, input.daily),
    mix_effect: {
      contribution: round(mix, 2),
      share: setChanged && mixShare !== null ? Math.round(mixShare) : null,
      ...setNames(cells, sets),
    },
    causes,
    excluded_cells: sets.both.length - stable.length,
    stable_cells: stable.length,
    unmentioned_cells: {
      a: cells.filter((c) => tracked(c.a) && !counted(c.a)).length,
      b: cells.filter((c) => tracked(c.b) && !counted(c.b)).length,
    },
    evidence_partial: [...input.evidence.values()].some((e) => e.partial === true),
    unexplained: {
      kind: se !== null && Math.abs(residual) <= 2 * se ? 'normal_swing' : 'unexplained',
      contribution: round(residual, 2),
      share: residualShare,
    },
  };
}
