import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KPI_SET, KPI_KEYS, KPI_REGISTRY, KPI_TEMPLATES } from '@/lib/kpis/registry';

/**
 * The Positive Sentiment KPI (AC): Insights' Positive sentiment card as an
 * Action Center KPI — the positive share of the answers naming the brand, its
 * change in points, and a daily sparkline that leaves out days without a
 * mention rather than drawing them as 0%.
 */

let definitions: unknown[] = [];
let brandRow: Record<string, unknown> | null = null;
let brandError: { message: string } | null = null;
// One insights_aggregates_daily row per day, by p_day_from.
let dailyRows: Record<string, Record<string, number>> = {};
const rpcCalls: Record<string, unknown>[] = [];
let seedResult: { data: unknown; error: { code?: string; message: string } | null } = {
  data: true,
  error: null,
};
const seedCalls: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: brandRow, error: brandError }),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          resolve({ data: definitions, error: null }),
      };
      return q;
    },
    rpc: async (...call: [string, Record<string, unknown>]) => {
      const [fn, args] = call;
      if (fn === 'seed_kpi_presets') {
        seedCalls.push(args);
        return seedResult;
      }
      rpcCalls.push(args);
      return { data: dailyRows[String(args.p_day_from)] ?? {}, error: null };
    },
  })),
}));

const getInsightsSummary = vi.fn();
const getShareOfVoiceData = vi.fn();
const getVisibilityRateTrend = vi.fn();
vi.mock('./tracking', () => ({
  getInsightsSummary: (...args: unknown[]) => getInsightsSummary(...args),
  getShareOfVoiceData: (...args: unknown[]) => getShareOfVoiceData(...args),
  getVisibilityRateTrend: (...args: unknown[]) => getVisibilityRateTrend(...args),
}));
const getTrafficSummary = vi.fn();
const getTrafficTrend = vi.fn();
vi.mock('./traffic', () => ({
  getTrafficSummary: (...args: unknown[]) => getTrafficSummary(...args),
  getTrafficTrend: (...args: unknown[]) => getTrafficTrend(...args),
}));

const { getKpiPresetPreview, getKpiSnapshots, seedKpiPresets } = await import('./kpis');

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

beforeEach(() => {
  definitions = [];
  brandRow = null;
  brandError = null;
  dailyRows = {};
  rpcCalls.length = 0;
  seedCalls.length = 0;
  seedResult = { data: true, error: null };
  for (const fn of [
    getInsightsSummary,
    getShareOfVoiceData,
    getVisibilityRateTrend,
    getTrafficSummary,
    getTrafficTrend,
  ]) {
    fn.mockReset();
  }
});

describe('the Positive Sentiment KPI', () => {
  it('is listed last, under Mentions, and makes Brand Monitoring a usable template', () => {
    expect(KPI_KEYS.at(-1)).toBe('positive_sentiment');
    expect(DEFAULT_KPI_SET.at(-1)).toBe('positive_sentiment');
    expect(KPI_REGISTRY.positive_sentiment).toMatchObject({
      category: 'mentions',
      unit: 'percent',
      direction: 'higher_is_better',
    });
    expect(KPI_TEMPLATES.brand_monitoring).toEqual(['mentions', 'positive_sentiment']);
  });

  it("reads Insights' positive share and its change in points, with a sparkline of the days named", async () => {
    definitions = [
      { kpi_key: 'positive_sentiment', target: 50, timeframe: 'monthly', is_active: true },
    ];
    getInsightsSummary.mockResolvedValue({
      positiveSentimentPct: 40,
      sentimentChange: 6,
      totalMentions: 107,
      totalCitations: 0,
    });
    dailyRows = {
      // Over the answers naming the brand (00191), not those only citing it.
      [daysAgo(6)]: { positive_count: 3, mentioning_results: 6, mention_results: 4 },
      // daysAgo(5): no answer named the brand.
      [daysAgo(4)]: { positive_count: 1, mentioning_results: 3, mention_results: 3 },
      // Before 00191 the day has only the old base.
      [daysAgo(0)]: { positive_count: 0, mentioning_results: 2 },
    };

    const { configured, kpis } = await getKpiSnapshots('b1');

    expect(configured).toBe(true);
    expect(kpis).toHaveLength(1);
    expect(kpis[0]).toMatchObject({
      key: 'positive_sentiment',
      category: 'mentions',
      unit: 'percent',
      value: 40,
      change: 6,
      changeKind: 'points',
      target: 50,
      progress: 80,
    });
    expect(kpis[0].trend).toEqual([
      { date: daysAgo(6), value: 75 },
      { date: daysAgo(4), value: 33 },
      { date: daysAgo(0), value: 0 },
    ]);
    // One rollup read per day of the sparkline, shared with Mentions and Citations.
    expect(rpcCalls).toHaveLength(7);
  });

  it('comes after the other KPIs in the table', async () => {
    definitions = [
      { kpi_key: 'positive_sentiment', target: 50, timeframe: 'monthly', is_active: true },
      { kpi_key: 'mentions', target: 100, timeframe: 'monthly', is_active: true },
    ];
    getInsightsSummary.mockResolvedValue({
      positiveSentimentPct: 40,
      sentimentChange: null,
      totalMentions: 107,
      mentionsChange: 25,
      totalCitations: 0,
    });
    const { kpis } = await getKpiSnapshots('b1');
    expect(kpis.map((k) => k.key)).toEqual(['mentions', 'positive_sentiment']);
    expect(kpis[1].change).toBeNull();
  });
});

describe('the ready-made KPIs', () => {
  // The last 30 days of a brand: 33.3% visible, 107 mentions, no citations,
  // 90% share of voice, 40% positive, 10 AI visits.
  function lastThirtyDays() {
    getVisibilityRateTrend.mockResolvedValue({ summary: { rate: 33.3, change: 1 }, points: [] });
    getInsightsSummary.mockResolvedValue({
      totalMentions: 107,
      mentionsChange: null,
      totalCitations: 0,
      citationsChange: null,
      positiveSentimentPct: 40,
      sentimentChange: null,
    });
    getShareOfVoiceData.mockResolvedValue({ overallSov: 90, overallSovChange: 0, trend: [] });
    getTrafficSummary.mockResolvedValue({ totalVisits: 10, totalVisitsPrev: 5 });
    getTrafficTrend.mockResolvedValue([]);
  }

  it('says whether a brand without KPIs was ever set up', async () => {
    brandRow = { kpi_setup_at: null };
    await expect(getKpiSnapshots('b1')).resolves.toEqual({
      configured: false,
      kpis: [],
      everSetUp: false,
    });
    brandRow = { kpi_setup_at: '2026-10-01T00:00:00Z' };
    await expect(getKpiSnapshots('b1')).resolves.toMatchObject({ everSetUp: true });
    // A database before 00163: nothing is offered.
    brandRow = null;
    brandError = { message: 'column brands.kpi_setup_at does not exist' };
    await expect(getKpiSnapshots('b1')).resolves.toMatchObject({ everSetUp: true });
  });

  it('sets up each KPI 20% above its last 30 days, with traffic when GA is mapped', async () => {
    lastThirtyDays();
    brandRow = { ga_property_id: 'properties/123' };
    await expect(seedKpiPresets('b1')).resolves.toBe(true);
    expect(seedCalls).toEqual([
      {
        p_brand_id: 'b1',
        p_kpis: [
          { key: 'ai_visibility', target: 40 },
          { key: 'mentions', target: 129 },
          // No citations yet: the registry's default.
          { key: 'citations', target: 100 },
          { key: 'share_of_voice', target: 100 },
          { key: 'positive_sentiment', target: 48 },
          { key: 'ai_referral_traffic', target: 12 },
        ],
      },
    ]);
    // The last 30 days, for every KPI at once.
    expect(getInsightsSummary).toHaveBeenCalledTimes(1);
  });

  it('leaves traffic out without GA, and reports a brand set up meanwhile', async () => {
    lastThirtyDays();
    brandRow = { ga_property_id: null };
    seedResult = { data: false, error: null };
    await expect(seedKpiPresets('b1')).resolves.toBe(false);
    const kpis = seedCalls[0].p_kpis as { key: string }[];
    expect(kpis.map((k) => k.key)).not.toContain('ai_referral_traffic');
    expect(getTrafficSummary).not.toHaveBeenCalled();
  });

  it('is a no-op before the migration, and throws on a refusal', async () => {
    lastThirtyDays();
    seedResult = { data: null, error: { code: 'PGRST202', message: 'not found' } };
    await expect(seedKpiPresets('b1')).resolves.toBe(false);
    seedResult = {
      data: null,
      error: { code: '42501', message: 'Only admins and managers can set up KPIs' },
    };
    await expect(seedKpiPresets('b1')).rejects.toThrow('Only admins and managers');
  });

  it('previews them unsaved, in table order, reading the 30 days once', async () => {
    lastThirtyDays();
    const today = new Date().toISOString().slice(0, 10);
    const preview = await getKpiPresetPreview('b1', { dayFrom: daysAgo(29), dayTo: today });
    expect(preview.map((k) => [k.key, k.target])).toEqual([
      ['ai_visibility', 40],
      ['citations', 100],
      ['mentions', 129],
      ['share_of_voice', 100],
      ['positive_sentiment', 48],
    ]);
    expect(seedCalls).toHaveLength(0);
    expect(getInsightsSummary).toHaveBeenCalledTimes(1);

    // Another window reads its own figures; the targets stay the 30 days'.
    await getKpiPresetPreview('b1', { dayFrom: daysAgo(6), dayTo: today });
    expect(getInsightsSummary).toHaveBeenCalledTimes(3);
  });
});
