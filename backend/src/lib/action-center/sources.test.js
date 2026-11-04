import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();
vi.mock('../../config/supabase.js', () => ({ default: { from: (...a) => from(...a) } }));
const brandConnection = vi.hoisted(() => vi.fn());
vi.mock('../brandIntegrations.js', () => ({ brandConnection }));

import { SOURCES, resolveBrandSources } from './sources.js';

const BRAND = 'brand-1';

/**
 * Answers one row per table the brand has something in, nothing for the rest
 * — which is what a brand without Search Console or audits looks like.
 */
function mockDb(tables) {
  from.mockImplementation((table) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      gte: () => builder,
      limit: () => builder,
      then: (resolve, reject) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject),
    };
    return builder;
  });
}

beforeEach(() => {
  from.mockReset();
  brandConnection.mockReset().mockResolvedValue(null);
});

describe('resolveBrandSources', () => {
  it('always includes tracking — a brand without it is not a brand yet', async () => {
    mockDb({});
    expect([...(await resolveBrandSources(BRAND))]).toEqual(['tracking']);
  });

  it('reports the competitors, audits and topics the brand has', async () => {
    mockDb({ competitors: [{ id: 'c' }], site_audits: [{ id: 'a' }], topics: [{ id: 't' }] });

    const sources = await resolveBrandSources(BRAND);

    expect(sources.has('competitors')).toBe(true);
    expect(sources.has('site_audits')).toBe(true);
    expect(sources.has('topics')).toBe(true);
    expect(sources.has('analytics')).toBe(false);
  });

  it('reports Search Console once its queries have synced', async () => {
    mockDb({ gsc_query_stats: [{ id: 'q' }] });
    expect((await resolveBrandSources(BRAND)).has('search_console')).toBe(true);
  });

  /** AI traffic is one source whether it comes from analytics or the
   *  snippet: the definitions that need it need the traffic, not the pipe. */
  it('counts AI traffic from either analytics or the tracking snippet', async () => {
    mockDb({ ai_traffic_logs: [{ id: 'l' }] });
    expect((await resolveBrandSources(BRAND)).has('ai_traffic')).toBe(true);

    mockDb({ ga_ai_traffic_stats: [{ id: 'g' }] });
    expect((await resolveBrandSources(BRAND)).has('ai_traffic')).toBe(true);
  });

  it('reports demand estimates on the brand’s prompts', async () => {
    mockDb({ prompt_sets: [{ id: 's' }], prompts: [{ id: 'p' }], prompt_volumes: [{ id: 'v' }] });
    expect((await resolveBrandSources(BRAND)).has('volumes')).toBe(true);
  });

  /** Integrations are per brand (00470): the Google sign-in the brand uses,
   *  which every brand of a workspace shares until one picks its own. */
  it('finds the analytics connection the brand uses', async () => {
    mockDb({});
    brandConnection.mockResolvedValue({ connected: true });
    expect((await resolveBrandSources(BRAND)).has('analytics')).toBe(true);
    expect(brandConnection).toHaveBeenCalledWith(BRAND, 'google-analytics');
  });

  it('claims no analytics for a brand whose connection is gone or that uses none', async () => {
    mockDb({});
    brandConnection.mockResolvedValue({ connected: false, status: 'disconnected' });
    expect((await resolveBrandSources(BRAND)).has('analytics')).toBe(false);
    brandConnection.mockResolvedValue(null);
    expect((await resolveBrandSources(BRAND)).has('analytics')).toBe(false);
  });

  it('only ever reports sources the registry knows', async () => {
    mockDb({
      competitors: [{}],
      site_audits: [{}],
      gsc_query_stats: [{}],
      ai_traffic_logs: [{}],
      topics: [{}],
      prompt_sets: [{ id: 's' }],
      prompts: [{ id: 'p' }],
      prompt_volumes: [{}],
    });
    brandConnection.mockResolvedValue({ connected: true });
    for (const source of await resolveBrandSources(BRAND)) expect(SOURCES).toContain(source);
  });
});
