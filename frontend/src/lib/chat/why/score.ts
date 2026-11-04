import { POSITION_SUPPORT_ANSWERS, VISIBILITY_SCORE_WEIGHTS } from '@/lib/visibilityScore';
import {
  MIN_RUNS,
  causeParts,
  cellCause,
  cellSets,
  changePointOf,
  changeSe,
  noiseOf,
  rankParts,
  rowOf,
  setChangedOf,
  setNames,
  setParts,
  tallyCause,
  tracked,
  type CauseKind,
  type CauseTally,
  type CellCounts,
  type CellEvidence,
  type DayCounts,
  type ScoreComponent,
  type WhyCell,
  type WhyResult,
} from './explain';

/**
 * Why did the Visibility score move (CHAT-22 §1, explain_change with metric
 * visibility_score): the AI Visibility score on the Insights card, blended
 * as lib/visibilityScore.ts does —
 *   100 × (0.6 × mention rate + 0.25 × citation rate
 *          + 0.15 × position factor × support),
 * support = answers naming the brand ÷ (those + 20). The score is the sum of
 * its three parts, so its change is theirs, in points of the score.
 *
 * The steps of explain.ts, on the score of a set of cells (their counts
 * added up): the set's change first (engines, prompts, cells counted in one
 * period, too few runs), then the stable cells' change part by part. A
 * part's points split per cell as a rate's do — the cell's own rate change
 * at its average weight, to the cause its evidence shows for that part
 * (PART_CAUSES) — and the rest is the remainder. The position part moves
 * with the position factor at the average support and with the support
 * itself (more or fewer answers naming the brand); the support's share goes
 * to the remainder: PF_b·S_b − PF_a·S_a = S̄·ΔPF + PF̄·ΔS.
 *
 * Noise: the parts' standard errors added up, a bound, since the parts move
 * together. Pure.
 */

const W = VISIBILITY_SCORE_WEIGHTS;
const PARTS: ScoreComponent[] = ['mention', 'citation', 'position'];

/** The causes each part of the score can show: explain.ts's rules, mapped to the part. */
export const PART_CAUSES: Record<ScoreComponent, readonly CauseKind[]> = {
  // Named in the answer at all.
  mention: ['site_change', 'competitor_entered', 'competitor_left'],
  // Its pages cited.
  citation: [
    'site_change',
    'lost_citation_to_competitor',
    'lost_citation',
    'won_citation_from_competitor',
    'gained_citation',
  ],
  // Named first or later: a competitor named in the same answers.
  position: ['competitor_entered', 'competitor_left'],
};

type Totals = Pick<
  CellCounts,
  'answers' | 'mentionAnswers' | 'citationAnswers' | 'sumInvPosition' | 'positionCount'
>;

const totalOf = (list: Totals[]): Totals => ({
  answers: list.reduce((s, c) => s + c.answers, 0),
  mentionAnswers: list.reduce((s, c) => s + c.mentionAnswers, 0),
  citationAnswers: list.reduce((s, c) => s + c.citationAnswers, 0),
  sumInvPosition: list.reduce((s, c) => s + c.sumInvPosition, 0),
  positionCount: list.reduce((s, c) => s + c.positionCount, 0),
});

/** The mean of 1/position over the positions; 0 when never named, as Insights counts it. */
const positionFactor = (t: Totals) =>
  t.positionCount > 0 ? t.sumInvPosition / t.positionCount : 0;

/** How much the position factor counts: little over few answers naming the brand. */
const supportOf = (t: Totals) => t.mentionAnswers / (t.mentionAnswers + POSITION_SUPPORT_ANSWERS);

/** The score's three parts, in points; null without answers. */
export function scoreParts(t: Totals): Record<ScoreComponent, number> | null {
  if (t.answers <= 0) return null;
  return {
    mention: 100 * W.mention * (t.mentionAnswers / t.answers),
    citation: 100 * W.citation * (t.citationAnswers / t.answers),
    position: 100 * W.position * positionFactor(t) * supportOf(t),
  };
}

/**
 * The score before rounding, in computeAiVisibilityScore's own order of
 * operations, so rounded it is the Insights card's; null without answers.
 */
export function scoreOf(t: Totals): number | null {
  if (t.answers <= 0) return null;
  return (
    100 *
    (W.mention * (t.mentionAnswers / t.answers) +
      W.citation * (t.citationAnswers / t.answers) +
      W.position * positionFactor(t) * supportOf(t))
  );
}

const round = (value: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** A period of a cell the score counts in: tracked, with answers. */
const counted = (c: CellCounts | null): c is CellCounts => tracked(c) && c.answers > 0;

/** The stable cells whose own score moved most, by key: those whose answers are read. */
export function movedScoreCells(cells: WhyCell[], count: number): string[] {
  return cells
    .filter((c) => counted(c.a) && counted(c.b) && c.a.runs >= MIN_RUNS && c.b.runs >= MIN_RUNS)
    .map((c) => ({ key: c.key, moved: Math.abs(scoreOf(c.b!)! - scoreOf(c.a!)!) }))
    .filter((c) => c.moved > 0)
    .sort((x, y) => y.moved - x.moved)
    .slice(0, count)
    .map((c) => c.key);
}

/** explain_change for visibility_score; the same input as explainChange. */
export function explainScoreChange(input: {
  periodA: { from: string; to: string };
  periodB: { from: string; to: string };
  cells: WhyCell[];
  engines?: { a: string[]; b: string[] };
  sameEngineCells?: WhyCell[];
  daily: { day: string; counts: DayCounts }[];
  evidence: Map<string, CellEvidence>;
}): WhyResult {
  const { cells } = input;
  const totalIn = (list: WhyCell[], period: 'a' | 'b') =>
    totalOf(
      list.flatMap((c) => {
        const counts = c[period];
        return counted(counts) ? [counts] : [];
      }),
    );
  const changeIn = (list: WhyCell[]) => {
    const a = scoreOf(totalIn(list, 'a'));
    const b = scoreOf(totalIn(list, 'b'));
    return a !== null && b !== null ? b - a : 0;
  };

  // The headline, as the Insights card counts it, and each part's.
  const allA = totalIn(cells, 'a');
  const allB = totalIn(cells, 'b');
  const valueA = scoreOf(allA);
  const valueB = scoreOf(allB);
  const delta = valueA !== null && valueB !== null ? valueB - valueA : null;
  const partsA = scoreParts(allA);
  const partsB = scoreParts(allB);

  const sets = cellSets(input, counted);
  const { stable } = sets;
  const deltaSame = changeIn(sets.same);
  const deltaTracked = changeIn(sets.trackedBoth);
  const deltaBoth = changeIn(sets.both);
  const deltaStable = changeIn(stable);
  const engineMix = delta === null ? 0 : delta - deltaSame;
  const promptMix = delta === null ? 0 : deltaSame - deltaTracked;
  const mix = engineMix + promptMix;

  // The stable cells, part by part.
  const stableA = totalOf(stable.map((c) => c.a!));
  const stableB = totalOf(stable.map((c) => c.b!));
  const support = (supportOf(stableA) + supportOf(stableB)) / 2;
  const tally: CauseTally = new Map();
  const attribute = (
    part: ScoreComponent,
    rateOf: (c: CellCounts) => { num: number; den: number },
    points: number,
  ) => {
    const denA = stable.reduce((s, c) => s + rateOf(c.a!).den, 0);
    const denB = stable.reduce((s, c) => s + rateOf(c.b!).den, 0);
    if (denA <= 0 || denB <= 0) return;
    for (const cell of stable) {
      const ra = rateOf(cell.a!);
      const rb = rateOf(cell.b!);
      // A rate the cell has in both periods; else its move is one of weight.
      if (ra.den <= 0 || rb.den <= 0) continue;
      const moved = rb.num / rb.den - ra.num / ra.den;
      const own = ((ra.den / denA + rb.den / denB) / 2) * moved * points;
      if (own === 0) continue;
      const found = input.evidence.get(cell.key);
      const cause = cellCause(found, own < 0, PART_CAUSES[part]);
      if (cause && found) tallyCause(tally, cell.key, cause, own, part, rowOf(found, own < 0));
    }
  };
  attribute('mention', (c) => ({ num: c.mentionAnswers, den: c.answers }), 100 * W.mention);
  attribute('citation', (c) => ({ num: c.citationAnswers, den: c.answers }), 100 * W.citation);
  attribute(
    'position',
    (c) => ({ num: c.sumInvPosition, den: c.positionCount }),
    100 * W.position * support,
  );

  // Noise: each part's swing over the stable cells, added up.
  const rateSe = (
    rateOf: (c: CellCounts) => { num: number; den: number },
    metric: 'mention_rate' | 'citations',
  ) =>
    stable.length > 0
      ? changeSe(
          metric,
          stable.map((c) => rateOf(c.a!)),
          stable.map((c) => rateOf(c.b!)),
        )
      : null;
  const seMention = rateSe((c) => ({ num: c.mentionAnswers, den: c.answers }), 'mention_rate');
  const seCitation = rateSe((c) => ({ num: c.citationAnswers, den: c.answers }), 'citations');
  const named = stable.filter((c) => c.a!.positionCount > 0 && c.b!.positionCount > 0);
  const sePosition = changeSe(
    'avg_position',
    named.map((c) => ({ num: c.a!.sumInvPosition, den: c.a!.positionCount })),
    named.map((c) => ({ num: c.b!.sumInvPosition, den: c.b!.positionCount })),
  );
  const se =
    seMention === null || seCitation === null
      ? null
      : W.mention * seMention +
        W.citation * seCitation +
        100 * W.position * support * (sePosition ?? 0);
  const noise = noiseOf(delta, se);

  const parts = [
    ...causeParts(tally),
    ...setParts(cells, sets, {
      engineMix,
      promptMix,
      unmentioned: deltaTracked - deltaBoth,
      notEnough: deltaBoth - deltaStable,
    }),
  ];
  const residual = (delta ?? 0) - parts.reduce((s, p) => s + p.contribution, 0);
  const { causes, residualShare, mixShare } = rankParts(
    parts,
    residual,
    delta,
    noise === 'beyond_normal_swing' && stable.length > 0,
    mix,
  );

  // A part's value as people read it: a rate in points, the position factor 0–1.
  const partValue = (part: ScoreComponent, t: Totals) =>
    t.answers <= 0
      ? null
      : part === 'position'
        ? round(positionFactor(t), 2)
        : round((100 * (part === 'mention' ? t.mentionAnswers : t.citationAnswers)) / t.answers);
  // The change as the Insights card shows it: between the two rounded scores.
  const shown = valueA === null || valueB === null ? null : round(round(valueB) - round(valueA));

  return {
    metric: 'visibility_score',
    unit: 'pts',
    period_a: input.periodA,
    period_b: input.periodB,
    value_a: valueA === null ? null : round(valueA),
    value_b: valueB === null ? null : round(valueB),
    delta: shown,
    se: se === null ? null : round(se, 2),
    noise_verdict: noise,
    direction: shown === null || shown === 0 ? 'flat' : shown < 0 ? 'declined' : 'improved',
    change_point: changePointOf(
      input.daily.flatMap((d) => {
        const value = scoreOf(d.counts);
        return value === null ? [] : [{ day: d.day, value }];
      }),
    ),
    mix_effect: {
      contribution: round(mix, 2),
      share: setChangedOf(sets) && mixShare !== null ? Math.round(mixShare) : null,
      ...setNames(cells, sets),
    },
    components: PARTS.map((part) => ({
      kind: part,
      weight: W[part],
      value_a: partValue(part, allA),
      value_b: partValue(part, allB),
      contribution: partsA && partsB ? round(partsB[part] - partsA[part], 2) : 0,
    })),
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
