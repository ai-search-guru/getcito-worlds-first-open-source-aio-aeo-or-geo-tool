import { describe, expect, it } from 'vitest';
import { coverage, kpiRates, parseKpiSeries, rateChange, shareOfVoice } from './insightsKpis';
import { wholeNet } from './mentionsHeadline';

describe('kpiRates', () => {
  it('works out every card rate from the components', () => {
    expect(
      kpiRates({
        answers: 200,
        citationAnswers: 76,
        named: 100,
        positive: 48,
        negative: 14,
        sumPosition: 240,
        positionCount: 100,
      }),
    ).toEqual({
      citationRate: 38,
      positivePct: 48,
      negativePct: 14,
      netSentiment: 34,
      avgPosition: 2.4,
    });
  });

  it('gives the same Net sentiment as the Mentions page, rounded once', () => {
    for (let named = 1; named <= 40; named++) {
      for (let positive = 0; positive <= named; positive++) {
        for (let negative = 0; positive + negative <= named; negative += 3) {
          const rates = kpiRates({
            answers: named,
            citationAnswers: 0,
            named,
            positive,
            negative,
            sumPosition: null,
            positionCount: 0,
          });
          expect(rates.netSentiment).toBe(wholeNet({ mentions: named, positive, negative }));
        }
      }
    }
    // Rounded separately, 7/15 − 2/15 read 47 − 13 = 34; once, 33.
    expect(
      kpiRates({
        answers: 15,
        citationAnswers: 0,
        named: 15,
        positive: 7,
        negative: 2,
        sumPosition: null,
        positionCount: 0,
      }).netSentiment,
    ).toBe(33);
  });

  it('has no rate without the answers it needs', () => {
    expect(
      kpiRates({
        answers: 0,
        citationAnswers: 0,
        named: 0,
        positive: 0,
        negative: 0,
        sumPosition: null,
        positionCount: 0,
      }),
    ).toEqual({
      citationRate: null,
      positivePct: null,
      negativePct: null,
      netSentiment: null,
      avgPosition: null,
    });
  });
});

describe('rates', () => {
  it('rounds changes to one decimal and needs both values', () => {
    expect(rateChange(64.3, 62.2)).toBe(2.1);
    expect(rateChange(64.3, null)).toBeNull();
  });

  it('matches share_of_voice_aggregates and the coverage line', () => {
    expect(shareOfVoice(46, 954)).toBe(4.6);
    expect(shareOfVoice(0, 0)).toBeNull();
    expect(coverage(456, 709)).toBe(64.3);
    expect(coverage(0, 0)).toBeNull();
  });
});

describe('parseKpiSeries', () => {
  it('turns each day into the cards’ values', () => {
    const series = parseKpiSeries({
      complete: true,
      days: [
        {
          day: '2026-10-13',
          answers: 10,
          citation_answers: 4,
          total_mentions: 12,
          total_citations: 5,
          positive_count: 3,
          negative_count: 1,
          mentioning_answers: 6,
          sum_position: 9,
          position_count: 6,
          visible_prompts: 3,
          active_prompts: 4,
          competitor_mentions: 36,
        },
      ],
    });

    expect(series).toEqual([
      {
        day: '2026-10-13',
        mentions: 12,
        citations: 5,
        netSentiment: 33,
        coverage: 75,
        shareOfVoice: 25,
        avgPosition: 1.5,
        citationRate: 40,
      },
    ]);
  });

  it("takes each day's net sentiment over the answers naming the brand (00191)", () => {
    const day = {
      day: '2026-10-13',
      answers: 10,
      citation_answers: 4,
      positive_count: 3,
      negative_count: 1,
      // Two answers only cite the brand: they don't dilute the net.
      mentioning_answers: 6,
      mention_answers: 4,
    };
    expect(parseKpiSeries({ complete: true, days: [day] })?.[0].netSentiment).toBe(50);
  });

  it('draws nothing before the rollups are backfilled', () => {
    expect(parseKpiSeries({ complete: false, days: [] })).toBeNull();
    expect(parseKpiSeries(null)).toBeNull();
  });
});
