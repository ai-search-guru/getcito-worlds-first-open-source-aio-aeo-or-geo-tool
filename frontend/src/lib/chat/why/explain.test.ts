import { describe, expect, it } from 'vitest';
import {
  cellCause,
  changePoint,
  confidenceOf,
  explainChange,
  movedCells,
  wholeShares,
  type CellCounts,
  type CellEvidence,
  type DayCounts,
  type WhyCell,
  type WhyMetric,
} from './explain';

/**
 * Why did it move (CHAT-22 §1), as its acceptance criteria have it: a lost
 * citation to a competitor in 14 of 20 cells is the top cause, within 5
 * points of its true share and with High confidence; a change inside 2 × SE
 * is within normal swing (no change at all always is); 12 prompts added is a
 * "prompt set changed" cause equal to Δ_total − Δ_in-both. And what review
 * found: a cell where the brand wasn't named isn't a removed prompt (nor
 * its move a set change), an engine added is its own part, shares are whole
 * percents adding up to 100 with offsets in points, "other" is one of 5 bars,
 * and a cell whose answers weren't all read gets no cause.
 */

const A = { from: '2026-10-05', to: '2026-10-11' };
const B = { from: '2026-10-12', to: '2026-10-18' };

/** A period's counts: `hits` of `runs` answers named the brand. */
const counts = (hits: number, runs: number, more: Partial<CellCounts> = {}): CellCounts => ({
  runs,
  visibleRuns: hits,
  answers: runs,
  mentionAnswers: hits,
  citationAnswers: 0,
  brandMentions: hits,
  competitorMentions: 0,
  sumPosition: 0,
  sumInvPosition: 0,
  positionCount: 0,
  ...more,
});

const cell = (
  key: string,
  a: CellCounts | null,
  b: CellCounts | null,
  engine = 'gpt-5',
): WhyCell => ({ key, promptId: key.split('|')[0], engine, a, b });

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

const lostToCompetitor = evidence({
  ownCitedA: ['acme.example/pricing'],
  competitorCitedB: ['rival.example/pricing'],
});

function explain(
  cells: WhyCell[],
  found = new Map<string, CellEvidence>(),
  metric: WhyMetric = 'mention_rate',
  more: Pick<Parameters<typeof explainChange>[0], 'engines' | 'sameEngineCells'> = {},
) {
  return explainChange({
    metric,
    periodA: A,
    periodB: B,
    cells,
    daily: [],
    evidence: found,
    ...more,
  });
}

describe('explainChange', () => {
  it('ranks a citation lost to a competitor in 14 of 20 cells first, near its true share, High', () => {
    const cells: WhyCell[] = [];
    const found = new Map<string, CellEvidence>();
    for (let i = 0; i < 20; i++) {
      const key = `p${i}|chatgpt`;
      // 14 lose the brand to a competitor's page; 6 dip once, with nothing to show why.
      const lost = i < 14;
      cells.push(cell(key, counts(7, 7), counts(lost ? 2 : 6, 7)));
      if (lost) found.set(key, lostToCompetitor);
    }
    const result = explain(cells, found);

    expect(result).toMatchObject({
      value_a: 100,
      value_b: 45.7,
      delta: -54.3,
      direction: 'declined',
      noise_verdict: 'beyond_normal_swing',
      stable_cells: 20,
      excluded_cells: 0,
      evidence_partial: false,
    });
    const [top] = result.causes;
    // True share: 14 cells × 5 of 140 answers = 50 points of the 54.29.
    const trueShare = (50 / 54.2857) * 100;
    expect(top).toMatchObject({
      kind: 'lost_citation_to_competitor',
      confidence: 'high',
      cells: 14,
      offset: false,
      fix_skill: 'winback',
      urls: ['acme.example/pricing'],
    });
    expect(Math.abs(top.share! - trueShare)).toBeLessThanOrEqual(5);
    expect(top.evidence_refs.length).toBeGreaterThan(0);
    expect(top.evidence_refs.every((ref) => ref.date)).toBe(true);
    // The rest: the six one-answer dips, no evidence for them.
    expect(result.unexplained.contribution).toBeCloseTo(-4.29, 1);
    expect(result.unexplained.share).toBeCloseTo(100 - top.share!, 0);
  });

  it('says within normal swing inside 2 × SE, and gives no shares then', () => {
    const found = new Map([['p1|chatgpt', lostToCompetitor]]);
    const result = explain(
      [
        cell('p1|chatgpt', counts(3, 5), counts(2, 5)),
        cell('p2|chatgpt', counts(3, 5), counts(3, 5)),
        cell('p3|chatgpt', counts(3, 5), counts(3, 5)),
        cell('p4|chatgpt', counts(3, 5), counts(3, 5)),
      ],
      found,
    );
    expect(result).toMatchObject({ delta: -5, noise_verdict: 'within_normal_swing' });
    expect(result.se).toBeGreaterThan(2.5);
    expect(result.causes.every((c) => c.share === null)).toBe(true);
  });

  it('says no change at all is within normal swing: 0% → 0%', () => {
    const result = explain([cell('p1|chatgpt', counts(0, 7), counts(0, 7))]);
    expect(result).toMatchObject({
      value_a: 0,
      value_b: 0,
      delta: 0,
      se: 0,
      noise_verdict: 'within_normal_swing',
      direction: 'flat',
    });
  });

  it('can’t measure the swing of an average position on a single cell: 2.0 → 2.1', () => {
    const at = (position: number) =>
      counts(10, 10, { sumPosition: position * 10, positionCount: 10 });
    const result = explain([cell('p1|chatgpt', at(2), at(2.1))], new Map(), 'avg_position');
    expect(result).toMatchObject({
      unit: 'positions',
      value_a: 2,
      value_b: 2.1,
      delta: 0.1,
      direction: 'declined',
      se: null,
      noise_verdict: 'not_measurable',
    });
  });

  it('gives 12 prompts added mid-period as a "prompt set changed" cause of Δ_total − Δ_in-both', () => {
    const stable = Array.from({ length: 10 }, (_, i) =>
      cell(`p${i}|chatgpt`, counts(5, 10), counts(5, 10)),
    );
    const added = Array.from({ length: 12 }, (_, i) =>
      cell(`new${i}|chatgpt`, null, counts(10, 10)),
    );
    const result = explain([...stable, ...added]);
    // a: 50 of 100; b: 170 of 220. The cells in both didn't move.
    expect(result.delta).toBeCloseTo(27.3, 1);
    expect(result.mix_effect).toMatchObject({ prompts_added: 12, prompts_removed: 0 });
    expect(result.mix_effect.contribution).toBeCloseTo((170 / 220) * 100 - 50, 2);
    expect(result.causes[0]).toMatchObject({
      kind: 'prompt_set_changed',
      contribution: result.mix_effect.contribution,
      share: 100,
      fix_skill: 'restore_prompt',
    });
  });

  it('counts a prompt the brand wasn’t named in as unmentioned, never removed (share of voice)', () => {
    const named = (brand: number, rivals: number) =>
      counts(brand, 7, { brandMentions: brand, competitorMentions: rivals });
    const cells = Array.from({ length: 10 }, (_, i) =>
      // In 4 prompts nobody was named in b: tracked, nothing to count.
      cell(`p${i}|chatgpt`, named(6, 4), i < 4 ? named(0, 0) : named(5, 5)),
    );
    const result = explain(cells, new Map(), 'share_of_voice');
    expect(result.mix_effect).toMatchObject({ prompts_added: 0, prompts_removed: 0 });
    expect(result.unmentioned_cells).toEqual({ a: 0, b: 4 });
    expect(result.causes.find((c) => c.kind === 'prompt_set_changed')).toBeUndefined();
  });

  it('gives prompts the brand stopped being named in their own line, not a set change (average position)', () => {
    const at = (position: number, named = 10) =>
      counts(named, 10, { sumPosition: position * named, positionCount: named });
    const cells = [
      // 6 prompts at position 3 in both periods.
      ...Array.from({ length: 6 }, (_, i) => cell(`p${i}|chatgpt`, at(3), at(3))),
      // 4 at position 1, then not named at all.
      ...Array.from({ length: 4 }, (_, i) => cell(`top${i}|chatgpt`, at(1), at(1, 0))),
      // One neutral prompt added, at position 3.
      cell('new|chatgpt', null, at(3)),
    ];
    const result = explain(cells, new Map(), 'avg_position');
    expect(result).toMatchObject({ value_a: 2.2, value_b: 3, direction: 'declined' });
    expect(result.mix_effect).toMatchObject({ contribution: 0, prompts_added: 1 });
    expect(result.causes.find((c) => c.kind === 'prompt_set_changed')).toBeUndefined();
    expect(result.causes.find((c) => c.kind === 'not_mentioned')).toMatchObject({
      contribution: 0.8,
      confidence: 'low',
      cells: 4,
    });
  });

  it('gives the cells nobody was named in their own line, not a set change (share of voice)', () => {
    const named = (brand: number, rivals: number) =>
      counts(brand > 0 ? 7 : 0, 7, { brandMentions: brand, competitorMentions: rivals });
    const cells = [
      ...Array.from({ length: 6 }, (_, i) => cell(`p${i}|chatgpt`, named(60, 40), named(50, 50))),
      ...Array.from({ length: 4 }, (_, i) => cell(`q${i}|chatgpt`, named(80, 20), named(0, 0))),
      cell('new|chatgpt', null, named(50, 50)),
    ];
    const result = explain(cells, new Map(), 'share_of_voice');
    // 68 → 50: −8 from the prompts nobody was named in, −10 from the rest.
    expect(result).toMatchObject({ value_a: 68, value_b: 50, delta: -18 });
    expect(result.causes.find((c) => c.kind === 'prompt_set_changed')).toBeUndefined();
    const unnamed = result.causes.find((c) => c.kind === 'not_mentioned')!;
    expect(unnamed).toMatchObject({ contribution: -8, share: 44, confidence: 'low' });
    expect(result.unexplained).toMatchObject({ contribution: -10, share: 56 });
  });

  it('gives an engine added in the later period its own part, not the prompts’ (visibility)', () => {
    // 20 prompts: 5 visible on ChatGPT in both periods; with Gemini added, 13 in b.
    const prompt = (i: number, runs: number, visible: boolean) => counts(visible ? 1 : 0, runs);
    const cells = Array.from({ length: 20 }, (_, i) =>
      cell(`p${i}`, prompt(i, 7, i < 5), prompt(i, 14, i < 13), 'all'),
    );
    const sameEngineCells = Array.from({ length: 20 }, (_, i) =>
      cell(`p${i}`, prompt(i, 7, i < 5), prompt(i, 7, i < 5), 'all'),
    );
    const found = new Map(
      cells.map((c) => [c.key, evidence({ ownCitedB: ['acme.example/faq'] })] as const),
    );
    const result = explain(cells, found, 'visibility', {
      engines: { a: ['gpt-5'], b: ['gpt-5', 'gemini-web'] },
      sameEngineCells,
    });
    expect(result).toMatchObject({ value_a: 25, value_b: 65, delta: 40 });
    expect(result.mix_effect).toMatchObject({
      contribution: 40,
      engines_added: ['gemini-web'],
      engines_removed: [],
      prompts_added: 0,
    });
    expect(result.causes[0]).toMatchObject({
      kind: 'engines_changed',
      contribution: 40,
      share: 100,
      fix_skill: null,
    });
    expect(result.causes.find((c) => c.kind === 'gained_citation')).toBeUndefined();
  });

  it('keeps shares 0–100 among what moved the change’s way, and gives an offset in points', () => {
    const cells: WhyCell[] = [];
    const found = new Map<string, CellEvidence>();
    for (let i = 0; i < 12; i++) {
      cells.push(cell(`lost${i}|chatgpt`, counts(10, 10), counts(2, 10)));
      found.set(`lost${i}|chatgpt`, lostToCompetitor);
    }
    for (let i = 0; i < 4; i++) {
      cells.push(cell(`won${i}|chatgpt`, counts(2, 10), counts(9, 10)));
      found.set(`won${i}|chatgpt`, evidence({ ownCitedB: ['acme.example/faq'] }));
    }
    const result = explain(cells, found);
    expect(result.direction).toBe('declined');
    const lost = result.causes.find((c) => c.kind === 'lost_citation_to_competitor')!;
    const won = result.causes.find((c) => c.kind === 'gained_citation')!;
    expect(lost).toMatchObject({ share: 100, offset: false });
    expect(won).toMatchObject({ share: null, offset: true });
    expect(won.contribution).toBeGreaterThan(0);
    for (const cause of result.causes) {
      if (cause.share !== null) expect(cause.share).toBeGreaterThanOrEqual(0);
      if (cause.share !== null) expect(cause.share).toBeLessThanOrEqual(100);
    }
  });

  it('gives whole percents that add up to 100, and no share to a float’s leftover', () => {
    expect(wholeShares([100 / 3, 100 / 3, 100 / 3])).toEqual([34, 33, 33]);
    expect(wholeShares([62.4, null, 37.6])).toEqual([62, null, 38]);
    expect(wholeShares([null, null])).toEqual([null, null]);
    // Every cell's move explained: the rest is a float's leftover, with no share.
    const cells: WhyCell[] = [];
    const found = new Map<string, CellEvidence>();
    for (let i = 0; i < 12; i++) {
      cells.push(cell(`lost${i}|chatgpt`, counts(10, 10), counts(3, 10)));
      found.set(`lost${i}|chatgpt`, lostToCompetitor);
    }
    const result = explain(cells, found);
    const shared = result.causes.reduce((sum, c) => sum + (c.share ?? 0), 0);
    expect(shared + (result.unexplained.share ?? 0)).toBe(100);
    expect(result.causes[0]).toMatchObject({ kind: 'lost_citation_to_competitor', share: 100 });
    expect(result.unexplained.share).toBeNull();
  });

  it('fills a cause’s table by the way the cell moved: own page then rival, or rival then own', () => {
    const found = new Map<string, CellEvidence>([
      [
        'lost|chatgpt',
        evidence({
          prompt: 'best aeo tool',
          ownCitedA: ['acme.example/pricing'],
          competitorCitedB: ['rival.example/pricing'],
        }),
      ],
      // Better: the rival left; the brand's page stayed cited.
      [
        'left|chatgpt',
        evidence({
          prompt: 'aeo for shops',
          ownCitedA: ['acme.example/guide'],
          ownCitedB: ['acme.example/guide'],
          competitorCitedA: ['rival.example/guide'],
          competitorRateA: 0.6,
          competitorRateB: 0,
        }),
      ],
    ]);
    const result = explain(
      [
        cell('lost|chatgpt', counts(10, 10), counts(2, 10)),
        cell('left|chatgpt', counts(2, 10), counts(9, 10)),
      ],
      found,
    );
    const rowsOf = (kind: string) => result.causes.find((c) => c.kind === kind)?.rows;
    expect(rowsOf('lost_citation_to_competitor')).toEqual([
      expect.objectContaining({
        prompt: 'best aeo tool',
        before: 'acme.example/pricing',
        now: 'rival.example/pricing',
      }),
    ]);
    expect(rowsOf('competitor_left')).toEqual([
      expect.objectContaining({
        prompt: 'aeo for shops',
        before: 'rival.example/guide',
        now: 'acme.example/guide',
      }),
    ]);
  });

  it('shows 5 bars at most, "other" one of them', () => {
    const kinds: [string, Partial<CellEvidence>][] = [
      [
        'site',
        {
          siteChanges: [
            {
              url: 'u',
              direction: 'worse',
              signals: ['https'],
              ref: { type: 'audit', id: 'x', date: '2026-10-13', period: 'b' },
            },
          ],
        },
      ],
      ['swap', { ownCitedA: ['a/x'], competitorCitedB: ['r/y'] }],
      ['lost', { ownCitedA: ['a/z'] }],
      ['rival', { competitorRateA: 0, competitorRateB: 0.5 }],
    ];
    const cells: WhyCell[] = [];
    const found = new Map<string, CellEvidence>();
    kinds.forEach(([name, more], k) => {
      for (let i = 0; i < 3; i++) {
        cells.push(cell(`${name}${i}|chatgpt`, counts(10, 10), counts(3 + k, 10)));
        found.set(`${name}${i}|chatgpt`, evidence(more));
      }
    });
    // Two more moves with no evidence: the remainder.
    cells.push(cell('dip|chatgpt', counts(10, 10), counts(4, 10)));
    // Add the prompt-set change as a fifth part.
    cells.push(cell('new|chatgpt', null, counts(0, 10)));
    const result = explain(cells, found);
    expect(result.causes.length).toBeLessThanOrEqual(5);
    expect(result.causes.at(-1)!.kind).toBe('other');
  });

  it('draws no cause from a cell whose answers weren’t all read, and says so', () => {
    const found = new Map([['p1|chatgpt', { ...lostToCompetitor, partial: true }]]);
    const result = explain(
      [
        cell('p1|chatgpt', counts(7, 7), counts(1, 7)),
        cell('p2|chatgpt', counts(7, 7), counts(7, 7)),
      ],
      found,
    );
    expect(result.evidence_partial).toBe(true);
    expect(result.causes).toEqual([]);
  });

  it('gives cells with fewer than 3 runs a "not enough data" line of their own', () => {
    const result = explain([
      cell('few|chatgpt', counts(2, 2), counts(0, 2)),
      cell('p1|chatgpt', counts(5, 10), counts(5, 10)),
    ]);
    expect(result).toMatchObject({ excluded_cells: 1, stable_cells: 1 });
    expect(result.causes.find((c) => c.kind === 'not_enough_data')).toMatchObject({
      confidence: 'low',
      cells: 1,
    });
  });

  it('counts visibility as Insights does: the prompts named or cited, of those tracked', () => {
    const cells = Array.from({ length: 10 }, (_, i) =>
      cell(`p${i}`, counts(i < 6 ? 2 : 0, 7), counts(i < 3 ? 2 : 0, 7), 'all'),
    );
    const result = explain(cells, new Map(), 'visibility');
    expect(result).toMatchObject({ value_a: 60, value_b: 30, delta: -30, direction: 'declined' });
  });

  it('says it can’t measure a period with no tracking', () => {
    const result = explain([cell('p1|chatgpt', null, counts(5, 5))]);
    expect(result).toMatchObject({
      value_a: null,
      delta: null,
      noise_verdict: 'not_measurable',
      direction: 'flat',
    });
  });

  it('reads a higher average position as a decline', () => {
    const at = (position: number) => counts(5, 5, { sumPosition: position * 5, positionCount: 5 });
    const cells = Array.from({ length: 6 }, (_, i) => cell(`p${i}|chatgpt`, at(2), at(4)));
    expect(explain(cells, new Map(), 'avg_position')).toMatchObject({
      unit: 'positions',
      value_a: 2,
      value_b: 4,
      delta: 2,
      direction: 'declined',
    });
  });
});

describe('the method’s parts', () => {
  const day = (i: number, value: number): { day: string; counts: DayCounts } => ({
    day: `2026-10-${String(i + 1).padStart(2, '0')}`,
    counts: { ...counts(value, 10), visiblePrompts: value, activePrompts: 10 },
  });

  it('finds the day a daily series changed, visibility by its prompts', () => {
    const daily = Array.from({ length: 30 }, (_, i) => day(i, i < 20 ? 6 : 4));
    expect(changePoint('visibility', daily)).toEqual({ date: '2026-10-21', before: 60, after: 40 });
    expect(changePoint('mention_rate', daily)).toEqual({
      date: '2026-10-21',
      before: 60,
      after: 40,
    });
    expect(changePoint('visibility', daily.slice(0, 5))).toBeNull();
  });

  it('picks the cells that moved most for their evidence', () => {
    const cells = [
      cell('small|x', counts(5, 10), counts(4, 10)),
      cell('big|x', counts(9, 10), counts(1, 10)),
      cell('flat|x', counts(5, 10), counts(5, 10)),
      cell('new|x', null, counts(5, 10)),
    ];
    expect(movedCells('mention_rate', cells, 5)).toEqual(['big|x', 'small|x']);
  });

  it('matches a cell’s cause by its evidence, first rule first', () => {
    expect(cellCause(undefined, true)).toBeNull();
    expect(cellCause({ ...lostToCompetitor, partial: true }, true)).toBeNull();
    expect(cellCause(evidence({ ownCitedA: ['a/x'] }), true)?.kind).toBe('lost_citation');
    expect(cellCause(lostToCompetitor, true)?.kind).toBe('lost_citation_to_competitor');
    expect(cellCause(evidence({ competitorRateA: 0.1, competitorRateB: 0.6 }), true)?.kind).toBe(
      'competitor_entered',
    );
    expect(
      cellCause(evidence({ ownCitedB: ['a/x'], competitorCitedA: ['r/y'] }), false)?.kind,
    ).toBe('won_citation_from_competitor');
    expect(cellCause(evidence({ competitorRateA: 0.6, competitorRateB: 0.1 }), false)?.kind).toBe(
      'competitor_left',
    );
  });

  it('rates confidence by the cells that show a cause', () => {
    expect([confidenceOf(12), confidenceOf(3), confidenceOf(2)]).toEqual(['high', 'medium', 'low']);
  });
});
