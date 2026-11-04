import { describe, expect, it } from 'vitest';
import { computeAiVisibilityScore } from './visibilityScore';
import {
  parseSamePromptComparison,
  samePromptChanges,
  withPromptComparison,
  type SamePromptComparison,
  type SamePromptTotals,
} from './insightsSamePrompts';

const totals = (over: Partial<SamePromptTotals> = {}): SamePromptTotals => ({
  answers: 400,
  mention_answers: 100,
  citation_answers: 40,
  position_factor: 0.5,
  total_mentions: 150,
  total_citations: 60,
  positive_count: 30,
  mentioning_answers: 110,
  negative_count: 10,
  sum_position: 200,
  position_count: 100,
  visible_prompts: 150,
  competitor_mentions: 450,
  by_competitor: [],
  ...over,
});

const same = (over: Partial<SamePromptComparison> = {}): SamePromptComparison => ({
  samePrompts: 200,
  newPrompts: 509,
  droppedPrompts: 3,
  cur: totals({ mention_answers: 120, total_mentions: 180 }),
  prev: totals(),
  ...over,
});

describe('parseSamePromptComparison', () => {
  it('reads the RPC payload', () => {
    const parsed = parseSamePromptComparison({
      complete: true,
      same_prompts: 200,
      new_prompts: '509',
      dropped_prompts: 0,
      cur: { answers: 10, position_factor: null, by_competitor: [{ competitor_id: 'c1' }] },
      prev: { answers: 8 },
    });

    expect(parsed).toMatchObject({ samePrompts: 200, newPrompts: 509, droppedPrompts: 0 });
    expect(parsed!.cur).toMatchObject({ answers: 10, mention_answers: 0, position_factor: null });
    expect(parsed!.cur.by_competitor[0]).toMatchObject({ competitor_id: 'c1', mention_answers: 0 });
  });

  it('refuses a comparison built on rollups not yet backfilled', () => {
    expect(parseSamePromptComparison({ complete: false, same_prompts: 200 })).toBeNull();
    expect(parseSamePromptComparison(null)).toBeNull();
  });
});

describe('samePromptChanges', () => {
  it('measures Visibility on the shared prompts with the card formula', () => {
    const s = same();
    const score = (t: SamePromptTotals) =>
      computeAiVisibilityScore({
        answers: t.answers,
        mentionAnswers: t.mention_answers,
        citationAnswers: t.citation_answers,
        positionFactor: t.position_factor,
      })!;

    const changes = samePromptChanges(s);
    expect(changes.visibility.cur).toBe(score(s.cur));
    expect(changes.visibility.change).toBe(Math.round((score(s.cur) - score(s.prev)) * 10) / 10);
    expect(changes.mentionsChange).toBe(20);
  });

  it('scores competitors tracked in both windows, and leaves newly tracked ones without a change', () => {
    const named = (id: string, mentions: number) => ({
      competitor_id: id,
      name: id,
      mention_answers: mentions,
      citation_answers: 0,
      position_factor: mentions > 0 ? 1 : null,
    });
    const changes = samePromptChanges(
      same({
        cur: totals({ by_competitor: [named('c1', 40), named('c2', 0), named('new', 30)] }),
        prev: totals({ by_competitor: [named('c1', 0), named('c2', 0)] }),
      }),
    );

    expect(changes.competitorChange('c1')).toBeGreaterThan(0);
    // Tracked in both windows but never named: no change.
    expect(changes.competitorChange('c2')).toBe(0);
    // Added during the period: like a new prompt, no gain from 0.
    expect(changes.competitorChange('new')).toBeNull();
  });

  it('measures the KPI card rates on the shared prompts', () => {
    const changes = samePromptChanges(
      same({
        samePrompts: 200,
        cur: totals({
          visible_prompts: 160,
          positive_count: 44,
          negative_count: 11,
          mentioning_answers: 110,
          sum_position: 180,
          position_count: 100,
          citation_answers: 60,
          total_mentions: 150,
          competitor_mentions: 350,
        }),
        prev: totals({ visible_prompts: 150 }),
      }),
    );

    // Coverage of the shared prompts: 160/200 = 80% vs 150/200 = 75%.
    expect(changes.coverageChange).toBe(5);
    // Net sentiment over the answers naming the brand (00191): (44% − 11%)
    // vs (30% − 10%); the 10 answers that only cite it don't dilute it.
    expect(changes.netSentimentChange).toBe(13);
    // Avg. position: 1.8 vs 2.0, an improvement.
    expect(changes.avgPositionChange).toBe(-0.2);
    // Citation rate: 15% vs 10%.
    expect(changes.citationRateChange).toBe(5);
    // Share of voice: 150/500 = 30% vs 150/600 = 25%.
    expect(changes.shareOfVoiceChange).toBe(5);
  });

  it('has no percentage changes without answers in both windows', () => {
    const changes = samePromptChanges(
      same({ samePrompts: 0, cur: totals({ answers: 0 }), prev: totals({ answers: 0 }) }),
    );

    expect(changes.visibility.change).toBeNull();
    expect(changes.mentionsChange).toBeNull();
    expect(changes.sentimentChange).toBeNull();
  });
});

describe('withPromptComparison', () => {
  const insights = () => ({
    summary: {
      totalResults: 709,
      mentionsChange: 203,
      citationsChange: 223,
      sentimentChange: 4,
      netSentimentChange: 9,
      avgPositionChange: -0.5,
      citationRateChange: 3,
    },
    sov: { overallSov: 4.6, overallSovChange: 2.2 },
    coverage: { visiblePrompts: 456, activePrompts: 709, value: 64.3, change: 8 },
    trend: { summary: { change: 7.9 } },
    competitors: {
      brands: [
        { isOwnBrand: true, scoreChange: 7.9 },
        { isOwnBrand: false, competitorId: 'c1', scoreChange: 2 },
      ],
    },
    untouched: 'kept',
  });

  it('re-measures every change on the shared prompts and keeps the rest', () => {
    const s = same();
    const out = withPromptComparison(insights(), s, true);
    const changes = samePromptChanges(s);

    expect(out.comparison).toEqual({
      basis: 'same',
      samePrompts: 200,
      newPrompts: 509,
      droppedPrompts: 3,
    });
    expect(out.summary.mentionsChange).toBe(changes.mentionsChange);
    expect(out.trend!.summary.change).toBe(changes.visibility.change);
    // The leaderboard's own row moves with the card.
    expect(out.competitors.brands[0].scoreChange).toBe(changes.visibility.change);
    expect(out.competitors.brands[1].scoreChange).toBe(changes.competitorChange('c1'));
    // Every KPI card's change moves too; the values stay.
    expect(out.summary.netSentimentChange).toBe(changes.netSentimentChange);
    expect(out.summary.avgPositionChange).toBe(changes.avgPositionChange);
    expect(out.summary.citationRateChange).toBe(changes.citationRateChange);
    expect(out.sov).toEqual({ overallSov: 4.6, overallSovChange: changes.shareOfVoiceChange });
    expect(out.coverage).toMatchObject({ value: 64.3, change: changes.coverageChange });
    expect(out.untouched).toBe('kept');
  });

  it('only reports the counts when Same prompts is off', () => {
    const out = withPromptComparison(insights(), same(), false);

    expect(out.comparison?.basis).toBe('all');
    expect(out.summary.mentionsChange).toBe(203);
    expect(out.trend!.summary.change).toBe(7.9);
  });

  it('changes nothing without a usable comparison', () => {
    const out = withPromptComparison(insights(), null, true);

    expect(out.comparison).toBeNull();
    expect(out.summary.mentionsChange).toBe(203);
  });
});
