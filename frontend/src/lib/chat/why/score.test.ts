import { describe, expect, it } from 'vitest';
import { computeAiVisibilityScore } from '@/lib/visibilityScore';
import { cellCause, type CellCounts, type CellEvidence, type WhyCell } from './explain';
import { PART_CAUSES, explainScoreChange, movedScoreCells, scoreOf } from './score';

/**
 * Why the Visibility score moved (CHAT-22 §1, metric visibility_score): the
 * Insights card's own score, its change split into its three parts in points
 * of the score; each part's cell moves go to the causes that part can show
 * (a lost citation to the citation part, a competitor entering to the
 * mention and position parts); support 0 and one part alone hold up.
 */

const A = { from: '2026-10-05', to: '2026-10-11' };
const B = { from: '2026-10-12', to: '2026-10-18' };

/** A period of a cell: its answers, those naming and citing, and its positions. */
const counts = (
  answers: number,
  named: number,
  cited: number,
  positions: number,
  sumInvPosition: number,
): CellCounts => ({
  runs: 7,
  visibleRuns: named > 0 || cited > 0 ? 7 : 0,
  answers,
  mentionAnswers: named,
  citationAnswers: cited,
  brandMentions: named,
  competitorMentions: 0,
  sumPosition: positions,
  sumInvPosition,
  positionCount: positions,
});

const cell = (key: string, a: CellCounts | null, b: CellCounts | null): WhyCell => ({
  key,
  promptId: key,
  engine: 'gpt-5',
  a,
  b,
});

const evidence = (more: Partial<CellEvidence> = {}): CellEvidence => ({
  ownCitedA: [],
  ownCitedB: [],
  competitorCitedA: [],
  competitorCitedB: [],
  competitorRateA: 0,
  competitorRateB: 0,
  siteChanges: [],
  answersA: [{ type: 'answer', id: 'ans-a', date: '2026-10-10', period: 'a' }],
  answersB: [{ type: 'answer', id: 'ans-b', date: '2026-10-15', period: 'b' }],
  ...more,
});

const rivalIn = evidence({ competitorRateA: 0, competitorRateB: 0.6 });
const lost = evidence({ ownCitedA: ['acme.example/pricing'] });

function explain(cells: WhyCell[], found: (key: string) => CellEvidence | undefined) {
  const map = new Map<string, CellEvidence>();
  for (const c of cells) {
    const e = found(c.key);
    if (e) map.set(c.key, e);
  }
  return explainScoreChange({ periodA: A, periodB: B, cells, daily: [], evidence: map });
}

const ten = (a: CellCounts, b: CellCounts) =>
  Array.from({ length: 10 }, (_, i) => cell(`p${i}`, a, b));

describe('explainScoreChange', () => {
  it('gives the Insights card’s score and splits its change into its parts', () => {
    const cells = ten(counts(20, 10, 6, 10, 6), counts(20, 7, 6, 7, 4.2));
    const result = explain(cells, () => rivalIn);
    // The card's own numbers: 200 answers, 100 → 70 naming, 60 citing, position factor 0.6.
    expect(result.value_a).toBe(
      computeAiVisibilityScore({
        answers: 200,
        mentionAnswers: 100,
        citationAnswers: 60,
        positionFactor: 0.6,
      }),
    );
    expect(result).toMatchObject({
      metric: 'visibility_score',
      unit: 'pts',
      value_a: 45,
      value_b: 35.5,
      delta: -9.5,
      direction: 'declined',
      noise_verdict: 'beyond_normal_swing',
    });
    expect(result.components).toEqual([
      { kind: 'mention', weight: 0.6, value_a: 50, value_b: 35, contribution: -9 },
      { kind: 'citation', weight: 0.25, value_a: 30, value_b: 30, contribution: 0 },
      // Fewer answers naming the brand lower the position factor's support.
      { kind: 'position', weight: 0.15, value_a: 0.6, value_b: 0.6, contribution: -0.5 },
    ]);
    // A competitor entering explains the mention part; the support's half point stays in the rest.
    expect(result.causes[0]).toMatchObject({
      kind: 'competitor_entered',
      contribution: -9,
      components: { mention: -9 },
      share: 95,
    });
    expect(result.unexplained).toMatchObject({ contribution: -0.5, share: 5 });
  });

  it('gives the change as the card shows it: between the two rounded scores', () => {
    // 200 answers: 1 citing, then 2. The card shows 0.1 → 0.3, a change of 0.2
    // (the unrounded change, 0.125, would read 0.1).
    const cells = Array.from({ length: 10 }, (_, i) =>
      cell(`p${i}`, counts(20, 0, i === 0 ? 1 : 0, 0, 0), counts(20, 0, i === 0 ? 2 : 0, 0, 0)),
    );
    const card = (cited: number) =>
      computeAiVisibilityScore({
        answers: 200,
        mentionAnswers: 0,
        citationAnswers: cited,
        positionFactor: null,
      })!;
    const result = explain(cells, () => undefined);
    expect(result).toMatchObject({ value_a: card(1), value_b: card(2), direction: 'improved' });
    expect(result.delta).toBe(Math.round((card(2) - card(1)) * 10) / 10);
    expect(result.delta).toBe(0.2);
  });

  it('gives a lost citation the citation part only, never the mention part', () => {
    const cells = ten(counts(20, 10, 10, 10, 6), counts(20, 8, 2, 8, 4.8));
    const result = explain(cells, () => lost);
    const cause = result.causes.find((c) => c.kind === 'lost_citation')!;
    expect(cause).toMatchObject({ contribution: -10, components: { citation: -10 } });
    expect(cause.components).not.toHaveProperty('mention');
    // The mention rate's fall (−6) and the support's (−0.3) aren't explained by it.
    expect(result.unexplained.contribution).toBeCloseTo(-6.3, 1);
  });

  it('holds up with support 0: a brand cited but never named', () => {
    const cells = ten(counts(20, 0, 4, 0, 0), counts(20, 0, 2, 0, 0));
    const result = explain(cells, () => lost);
    expect(result).toMatchObject({ value_a: 5, value_b: 2.5, delta: -2.5 });
    expect(result.components!.find((c) => c.kind === 'position')).toEqual({
      kind: 'position',
      weight: 0.15,
      value_a: 0,
      value_b: 0,
      contribution: 0,
    });
    expect(result.causes.find((c) => c.kind === 'lost_citation')).toMatchObject({
      components: { citation: -2.5 },
    });
    expect(JSON.stringify(result)).not.toContain('NaN');
  });

  it('gives one part alone its whole change: named later, not less', () => {
    // Named and cited as often; named first (1/1) before, second (1/2) after.
    const cells = ten(counts(200, 100, 60, 100, 100), counts(200, 100, 60, 100, 50));
    const result = explain(cells, () => rivalIn);
    expect(result.components!.map((c) => c.contribution)).toEqual([0, 0, -7.35]);
    expect(result.causes).toHaveLength(1);
    expect(result.causes[0]).toMatchObject({ kind: 'competitor_entered', share: 100 });
    expect(result.causes[0].components).toEqual({ position: -7.35 });
  });

  it('says nothing moved when no answers were tracked', () => {
    const result = explain(
      [cell('p0', counts(0, 0, 0, 0, 0), counts(0, 0, 0, 0, 0))],
      () => undefined,
    );
    expect(result).toMatchObject({
      value_a: null,
      value_b: null,
      delta: null,
      noise_verdict: 'not_measurable',
    });
  });
});

describe('the parts’ causes', () => {
  it('keeps each part to the rules it can show', () => {
    const both = evidence({
      ownCitedA: ['acme.example/pricing'],
      competitorRateA: 0,
      competitorRateB: 0.6,
    });
    expect(cellCause(both, true)?.kind).toBe('lost_citation');
    expect(cellCause(both, true, PART_CAUSES.citation)?.kind).toBe('lost_citation');
    expect(cellCause(both, true, PART_CAUSES.mention)?.kind).toBe('competitor_entered');
    expect(cellCause(both, true, PART_CAUSES.position)?.kind).toBe('competitor_entered');
    expect(cellCause(lost, true, PART_CAUSES.mention)).toBeNull();
  });

  it('reads the answers of the cells whose own score moved most', () => {
    const cells = [
      cell('flat', counts(20, 10, 6, 10, 6), counts(20, 10, 6, 10, 6)),
      cell('small', counts(20, 10, 6, 10, 6), counts(20, 9, 6, 9, 5.4)),
      cell('big', counts(20, 10, 6, 10, 6), counts(20, 2, 0, 2, 1)),
    ];
    expect(movedScoreCells(cells, 5)).toEqual(['big', 'small']);
    expect(scoreOf(counts(0, 0, 0, 0, 0))).toBeNull();
  });
});
