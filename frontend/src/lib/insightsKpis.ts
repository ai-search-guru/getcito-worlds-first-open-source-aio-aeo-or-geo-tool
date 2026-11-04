/**
 * The Insights KPI cards' rates (VIS-003): Net sentiment, Avg. position,
 * Citation rate, Coverage and Share of voice, from the components the
 * aggregates return (00131). One definition for the card values, their
 * changes and the sparklines, so the three always agree.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Components behind the rates, for one window or one day. */
export interface KpiComponents {
  answers: number;
  citationAnswers: number;
  /**
   * Answers naming the brand: the sentiment denominator, as on the Mentions
   * page (00191). Answers that only cite it are always neutral, so counting
   * them (#508) pulled Net sentiment toward zero.
   */
  named: number;
  positive: number;
  negative: number;
  /** Sum of the brand's position over answers naming it; null without positions. */
  sumPosition: number | null;
  positionCount: number;
}

export interface KpiRates {
  /** % of answers citing the brand's domain, one decimal. */
  citationRate: number | null;
  /** % of brand-naming answers that are positive / negative, whole numbers. */
  positivePct: number | null;
  negativePct: number | null;
  /** positivePct − negativePct, in points. */
  netSentiment: number | null;
  /** Mean position when named, one decimal; lower is better. */
  avgPosition: number | null;
}

export function kpiRates(c: KpiComponents): KpiRates {
  // As the Mentions page does it (sentimentSplit and wholeNet in
  // mentionsOverview.ts / mentionsHeadline.ts): the shares multiplied
  // first, and the net rounded once, so the two pages show the same number.
  const share = (count: number) => (count * 100) / c.named;
  const named = c.named > 0;
  return {
    citationRate: c.answers > 0 ? round1((c.citationAnswers / c.answers) * 100) : null,
    positivePct: named ? Math.round(share(c.positive)) : null,
    negativePct: named ? Math.round(share(c.negative)) : null,
    netSentiment: named ? Math.round(share(c.positive) - share(c.negative)) : null,
    avgPosition:
      c.positionCount > 0 && c.sumPosition !== null
        ? round1(c.sumPosition / c.positionCount)
        : null,
  };
}

/** Change in points (or positions) between two rates; null unless both exist. */
export function rateChange(cur: number | null, prev: number | null): number | null {
  return cur === null || prev === null ? null : round1(cur - prev);
}

/** % of all tracked brands' mentions that name this brand, one decimal (share_of_voice_aggregates). */
export function shareOfVoice(brandMentions: number, competitorMentions: number): number | null {
  const all = brandMentions + competitorMentions;
  return all > 0 ? round1((brandMentions / all) * 100) : null;
}

/** % of the answered prompts where the brand appeared at least once, one decimal. */
export function coverage(visiblePrompts: number, activePrompts: number): number | null {
  return activePrompts > 0 ? round1((visiblePrompts / activePrompts) * 100) : null;
}

/** One day of the cards' sparklines. */
export interface KpiSeriesDay {
  day: string;
  mentions: number;
  citations: number;
  netSentiment: number | null;
  coverage: number | null;
  shareOfVoice: number | null;
  avgPosition: number | null;
  citationRate: number | null;
}

const num = (v: unknown): number => Number(v ?? 0);

/**
 * The insights_kpi_series payload as sparkline points, or null when it
 * can't be used: missing, or read from rollup rows not yet rewritten since
 * 00131 — the cards then show no sparkline rather than a partial one.
 */
export function parseKpiSeries(raw: unknown): KpiSeriesDay[] | null {
  const r = raw as { complete?: boolean; days?: Record<string, unknown>[] } | null;
  if (!r || r.complete !== true) return null;
  return (r.days ?? []).map((d) => {
    const rates = kpiRates({
      answers: num(d.answers),
      citationAnswers: num(d.citation_answers),
      // Before 00191 the series has no mention_answers: the old base.
      named: num(d.mention_answers ?? d.mentioning_answers),
      positive: num(d.positive_count),
      negative: num(d.negative_count),
      sumPosition:
        d.sum_position === null || d.sum_position === undefined ? null : num(d.sum_position),
      positionCount: num(d.position_count),
    });
    return {
      day: String(d.day),
      mentions: num(d.total_mentions),
      citations: num(d.total_citations),
      netSentiment: rates.netSentiment,
      coverage: coverage(num(d.visible_prompts), num(d.active_prompts)),
      shareOfVoice: shareOfVoice(num(d.total_mentions), num(d.competitor_mentions)),
      avgPosition: rates.avgPosition,
      citationRate: rates.citationRate,
    };
  });
}
