import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "A new AI platform starts sending visits" (AT-013, spec §3.8): a platform
 * with AI visits this week and none before, for a brand that had AI visits
 * before.
 */

const rpc = vi.fn();
vi.mock('../../config/supabase.js', () => ({ default: { rpc: (...args) => rpc(...args) } }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ logger }));

const { newAiPlatformCandidates, newPlatforms, weekCandidates } =
  await import('./trafficPlatforms.js');

const NOW = new Date('2026-10-19T06:30:00Z');

beforeEach(() => {
  rpc.mockReset();
  logger.error.mockClear();
});

describe('newPlatforms', () => {
  // As ai_traffic_platforms_seen answers it (00193): of the candidates asked
  // about, ChatGPT sent visits before the week.
  const before = { anyBefore: true, seen: new Set(['chatgpt.com']) };

  it('names the platforms sending visits for the first time, with their first day', () => {
    const week = {
      visits: 16,
      platforms: [
        { platform: 'chatgpt.com', visits: 9 },
        { platform: 'perplexity.ai', visits: 3 },
        { platform: 'claude.ai', visits: 5 },
        // A referrer the source list couldn't name is not a platform.
        { platform: 'unknown', visits: 4 },
        // Nor is a key the public beacon was sent that isn't on the list.
        { platform: 'made-up.example', visits: 50 },
        // One or two visits aren't a platform starting to send them.
        { platform: 'grok.com', visits: 2 },
      ],
      days: [
        { day: '2026-10-15', platform: 'claude.ai', visits: 3 },
        { day: '2026-10-14', platform: 'claude.ai', visits: 2 },
        { day: '2026-10-17', platform: 'perplexity.ai', visits: 3 },
        { day: '2026-10-12', platform: 'perplexity.ai', visits: 0 },
      ],
    };
    expect(newPlatforms(week, before)).toEqual([
      { platform: 'claude.ai', visits: 5, firstDay: '2026-10-14' },
      { platform: 'perplexity.ai', visits: 3, firstDay: '2026-10-17' },
    ]);
    // Only these are asked about before the week.
    expect(weekCandidates(week).map((p) => p.platform)).toEqual([
      'chatgpt.com',
      'claude.ai',
      'perplexity.ai',
    ]);
  });

  it('has nothing new for a brand with no AI visits before the week', () => {
    const week = { visits: 3, platforms: [{ platform: 'chatgpt.com', visits: 3 }] };
    expect(newPlatforms(week, { anyBefore: false, seen: new Set() })).toEqual([]);
    expect(newPlatforms(week, null)).toEqual([]);
  });
});

describe('newAiPlatformCandidates', () => {
  const weekRead = (analyticsDays = []) => ({
    visits: 16,
    // A list of days, as ai_traffic_merged returns it (00176).
    analytics_days: analyticsDays,
    platforms: [
      { platform: 'chatgpt.com', visits: 12 },
      { platform: 'perplexity.ai', visits: 4 },
    ],
    days: [{ day: '2026-10-16', platform: 'perplexity.ai', visits: 4 }],
  });
  const reads = (week, seen = { any_before: true, seen: ['chatgpt.com'] }) =>
    rpc.mockImplementation(async (name) => ({
      data: name === 'ai_traffic_merged' ? week : seen,
      error: null,
    }));

  it("reads the week, then asks only about its candidates' visits before it", async () => {
    reads(weekRead());

    const found = await newAiPlatformCandidates('b1', { now: NOW });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('ai_traffic_merged', {
      p_brand_id: 'b1',
      p_from: '2026-10-12T00:00:00.000Z',
      // To the second before midnight, inclusive: that day's Analytics in one read only.
      p_to: '2026-10-18T23:59:59.000Z',
      p_to_inclusive: true,
      p_analytics: true,
    });
    // Not the whole history before the week (00193).
    expect(rpc).toHaveBeenCalledWith('ai_traffic_platforms_seen', {
      p_brand_id: 'b1',
      p_before: '2026-10-12T00:00:00.000Z',
      p_platforms: ['chatgpt.com', 'perplexity.ai'],
    });
    expect(found).toEqual([
      {
        kind: 'ai_platform_new',
        dedupKey: 'ai_platform_new:perplexity.ai',
        source: ['ai_results'],
        payload: { aiSource: 'perplexity.ai', firstDay: '2026-10-16' },
        previousValue: 0,
        currentValue: 4,
        changeValue: 4,
      },
    ]);
  });

  it('reads nothing more on a week with no candidate', async () => {
    reads({ visits: 2, analytics_days: [], platforms: [{ platform: 'claude.ai', visits: 2 }] });
    expect(await newAiPlatformCandidates('b1', { now: NOW })).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('says Analytics when the week read it', async () => {
    reads(weekRead(['2026-10-16']));
    const [found] = await newAiPlatformCandidates('b1', { now: NOW });
    expect(found.source).toEqual(['ga4']);
  });

  it('costs only itself when a read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'statement timeout' } });
    expect(await newAiPlatformCandidates('b1', { now: NOW })).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
