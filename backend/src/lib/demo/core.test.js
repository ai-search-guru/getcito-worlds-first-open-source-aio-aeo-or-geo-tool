import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
const rollups = vi.hoisted(() => ({
  refreshInsightsDaily: vi.fn(async () => true),
  refreshCitationsDaily: vi.fn(async () => true),
  refreshMentionsDaily: vi.fn(async () => true),
  refreshPerceptionSnapshots: vi.fn(async () => {}),
}));
vi.mock('../insightsRollups.js', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshInsightsDaily: rollups.refreshInsightsDaily,
}));
vi.mock('../citationsRollups.js', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshCitationsDaily: rollups.refreshCitationsDaily,
}));
vi.mock('../mentionsRollups.js', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshMentionsDaily: rollups.refreshMentionsDaily,
  refreshPerceptionSnapshots: rollups.refreshPerceptionSnapshots,
}));

const { RUNS, core, coreRows, firstAnswerAt, latestRunStart } = await import('./core.js');
const { resultRow } = await import('../cloroResultHandler.js');

/**
 * The demo brand's core data (demo-core): a month of Brewline Coffee's
 * tracked answers, in tracking's own shapes, deterministic but for its dates.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-28T12:00:00Z');
const DAY = 86_400_000;
const rows = coreRows({ brandId: BRAND_ID, now: NOW });

describe('coreRows', () => {
  it('is lean: 12 prompts in 3 topics, 6 engines, 4 competitors, a run every 3 days', () => {
    expect(rows.prompts).toHaveLength(12);
    expect(new Set(rows.prompts.map((p) => p.topic_id)).size).toBe(3);
    expect(rows.topics).toHaveLength(3);
    expect(rows.competitors.map((c) => c.name)).toEqual([
      'Northbound Roasters',
      'Kettle & Crate',
      'Morning Ritual Co.',
      'Daybreak Beans',
    ]);
    expect(rows.platforms.map((p) => p.platform).sort()).toEqual([
      'chatgpt-web',
      'copilot-web',
      'gemini-web',
      'google-aimode',
      'google-aio',
      'perplexity-web',
    ]);
    expect(rows.runs).toHaveLength(RUNS);
    expect(rows.results).toHaveLength(12 * 6 * RUNS);
    expect(rows.volumes).toHaveLength(12);
  });

  it('is the same every time but for its dates, and its ids are its brand’s own', () => {
    const later = coreRows({ brandId: BRAND_ID, now: new Date(NOW.getTime() + 5 * DAY) });
    const strip = (r) => ({ ...r, created_at: undefined });
    expect(later.results.map(strip)).toEqual(rows.results.map(strip));

    const other = coreRows({ brandId: '99999999-2222-4333-8444-555555555555', now: NOW });
    expect(other.results.map((r) => r.response)).toEqual(rows.results.map((r) => r.response));
    expect(other.results[0].id).not.toBe(rows.results[0].id);
    expect(rows.results[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('dates its runs back from now, the latest finished within the day', () => {
    const latest = latestRunStart(NOW);
    expect(latest.toISOString()).toBe('2026-10-28T06:00:00.000Z');
    // Before 07:00 UTC, today's run isn't done yet: the latest was yesterday's.
    expect(latestRunStart(new Date('2026-10-28T06:30:00Z')).toISOString()).toBe(
      '2026-10-27T06:00:00.000Z',
    );
    const times = rows.results.map((r) => Date.parse(r.created_at));
    expect(Math.max(...times)).toBeLessThan(NOW.getTime());
    expect(NOW.getTime() - Math.min(...times)).toBeLessThan(31 * DAY);
    for (const run of rows.runs) {
      expect(run).toMatchObject({ brand_id: BRAND_ID, source: 'cron', result_count: 72 });
      expect(Date.parse(run.completed_at)).toBeLessThan(NOW.getTime());
    }
    expect(rows.runs.at(-1).started_at).toBe(latest.toISOString());
  });

  it('stores each answer in the shape tracking stores it', () => {
    const shape = Object.keys(
      resultRow({
        aiResponse: { text: '', citations: [], model: 'm' },
        scraperId: 's',
        promptId: 'p',
        brandId: 'b',
        region: 'US',
        metrics: {},
      }),
    );
    for (const result of rows.results) {
      expect(Object.keys(result).sort()).toEqual([...shape, 'id', 'created_at'].sort());
      expect(result.brand_id).toBe(BRAND_ID);
      expect(result.region).toBe('US');
    }
    const answer = rows.results.find((r) => r.mention_count > 0);
    expect(answer.response).toContain('Brewline Coffee');
    expect(answer.mention_position).toBeGreaterThanOrEqual(1);
    expect(answer.competitor_mentions).toHaveLength(4);
  });

  it('names Brewline in about half the answers, more as the month goes on', () => {
    const named = (list) => list.filter((r) => r.mention_count > 0).length / list.length;
    const share = named(rows.results);
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.65);
    expect(named(rows.results.slice(-72))).toBeGreaterThan(named(rows.results.slice(0, 72)));
    // Not named: no sentiment of its own, as tracking stores it.
    for (const r of rows.results.filter((x) => x.mention_count === 0)) {
      expect(r.sentiment).toBe('neutral');
    }
    const sentiments = new Set(rows.results.map((r) => r.sentiment));
    expect(sentiments).toEqual(new Set(['positive', 'neutral', 'negative']));
  });

  it('shares searches only on the engines that do, and cards only where they show', () => {
    const engines = (list) => [...new Set(list.map((r) => r.platform))].sort();
    expect(engines(rows.results.filter((r) => r.search_queries.length > 0))).toEqual([
      'copilot-web',
      'perplexity-web',
    ]);
    const withCards = rows.results.filter((r) => r.shopping_cards.length > 0);
    expect(engines(withCards)).toEqual(['copilot-web', 'google-aimode', 'perplexity-web']);
    expect(rows.shoppingCards.length).toBeGreaterThan(20);
    expect(new Set(rows.shoppingCards.map((c) => c.matched_brand_role))).toEqual(
      new Set(['own', 'competitor']),
    );
  });

  it('cites Brewline, its competitors and fictional publishers, never a real site', () => {
    const domains = new Set(rows.citations.map((c) => c.domain));
    expect(domains.has('brewline.example')).toBe(true);
    expect(domains.has('northboundroasters.example')).toBe(true);
    expect(domains.size).toBeGreaterThan(6);

    const hosts = JSON.stringify(rows).match(/https?:\/\/[^/"\s)]+/g);
    expect(hosts.length).toBeGreaterThan(100);
    for (const host of new Set(hosts)) expect(host).toMatch(/\.example$/);
    for (const card of rows.shoppingCards) {
      expect(card.merchant_domain).toMatch(/\.example$/);
      expect(card.image_url).toBeNull();
    }
  });

  it('gives every prompt its volumes, as the volume analysis computes them', () => {
    const [first] = rows.volumes;
    expect(first).toMatchObject({
      intent: 'best-top',
      total_google_volume: 5500,
      est_ai_volume: Math.round(5500 * first.ai_volume_multiplier),
      location_code: 2840,
      language_code: 'en',
    });
    expect(Object.keys(first.google_volumes)).toEqual(first.keywords);
  });
});

/** A recording stand-in for the admin client; `reads` answers its selects, by table. */
function recordingDb({ reads = {} } = {}) {
  const calls = [];
  const db = {
    calls,
    from: (table) => {
      const call = { table };
      calls.push(call);
      const chain = {
        insert: (payload) => ((call.op = 'insert'), (call.rows = payload), chain),
        upsert: (payload, { onConflict }) => (
          (call.op = 'upsert'),
          (call.rows = payload),
          (call.onConflict = onConflict),
          chain
        ),
        update: (payload) => ((call.op = 'update'), (call.payload = payload), chain),
        delete: () => ((call.op = 'delete'), chain),
        select: () => ((call.op ??= 'select'), chain),
        eq: (column, value) => ((call.eq = [column, value]), chain),
        order: () => chain,
        limit: () => chain,
        then: (resolve) => resolve({ data: reads[table] ?? [], error: null }),
      };
      return chain;
    },
    rpc: async (fn, args) => {
      calls.push({ rpc: fn, args });
      return { data: args.p_urls.map((u, i) => ({ url: u.url, id: i + 1 })), error: null };
    },
  };
  return db;
}

describe('core.build', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the brand, its setup and its answers', async () => {
    const db = recordingDb();
    const built = await core.build({ brandId: BRAND_ID, now: NOW, db });

    expect(built).toMatchObject({ prompts: 12, results: 720 });
    const [brand] = db.calls;
    expect(brand).toMatchObject({ table: 'brands', op: 'update', eq: ['id', BRAND_ID] });
    expect(brand.payload).toMatchObject({ name: 'Brewline Coffee', site_type: 'ecommerce' });
    expect(brand.payload).not.toHaveProperty('demo_hidden_at');

    const inserted = [...new Set(db.calls.filter((c) => c.op === 'upsert').map((c) => c.table))];
    // Each step's tables side by side, after the ones they point at.
    expect(inserted).toEqual([
      'brand_domains',
      'brand_platforms',
      'competitors',
      'topics',
      'prompt_sets',
      'tracking_runs',
      'prompts',
      'prompt_volumes',
      'prompt_results',
      'prompt_result_citations',
      'prompt_result_shopping_cards',
    ]);
    const count = (table) =>
      db.calls.filter((c) => c.table === table).reduce((n, c) => n + (c.rows?.length ?? 0), 0);
    expect(count('prompt_results')).toBe(720);
    expect(count('prompt_result_citations')).toBe(rows.citations.length);
    // Statements stay small: the answers 250 at a time, the small citation rows 1,000.
    const largest = (table) =>
      Math.max(...db.calls.filter((c) => c.table === table).map((c) => c.rows.length));
    expect(largest('prompt_results')).toBe(250);
    expect(largest('prompt_result_citations')).toBeLessThanOrEqual(1000);

    // One call resolves every cited URL, and each citation row carries its id.
    const resolves = db.calls.filter((c) => c.rpc === 'citation_url_ids');
    expect(resolves).toHaveLength(1);
    const citationRows = db.calls
      .filter((c) => c.table === 'prompt_result_citations')
      .flatMap((c) => c.rows);
    expect(citationRows.every((r) => Number.isInteger(r.url_id))).toBe(true);

    // Writing rows rebuilds no rollup: refresh does, once they are all in.
    expect(rollups.refreshInsightsDaily).not.toHaveBeenCalled();
    expect(db.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('writes over the old rows, by each table’s key', async () => {
    const db = recordingDb();
    await core.build({ brandId: BRAND_ID, now: NOW, db, rebuild: true });
    const writes = db.calls.filter((c) => c.rows);
    expect(writes.every((c) => c.op === 'upsert')).toBe(true);
    const keyOf = (table) => writes.find((c) => c.table === table).onConflict;
    expect(keyOf('prompt_results')).toBe('id');
    expect(keyOf('prompts')).toBe('id');
    expect(keyOf('prompt_volumes')).toBe('prompt_id');
    expect(keyOf('prompt_result_citations')).toBe('prompt_result_id,position');
    expect(keyOf('prompt_result_shopping_cards')).toBe('prompt_result_id,position');
    expect(db.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('fails with the table when a write does', async () => {
    const db = recordingDb();
    const from = db.from;
    db.from = (table) => {
      const chain = from(table);
      if (table !== 'prompt_results') return chain;
      return {
        ...chain,
        upsert: () => ({ then: (resolve) => resolve({ error: { message: 'full' } }) }),
      };
    };
    await expect(core.build({ brandId: BRAND_ID, now: NOW, db })).rejects.toThrow(
      'demo prompt_results insert: full',
    );
    // Nothing that points at the answers was written after them.
    expect(db.calls.some((c) => c.table === 'prompt_result_citations')).toBe(false);
  });
});

describe('core.refresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it("rebuilds the month's rollups side by side, by the nightly run's own functions", async () => {
    const db = recordingDb();
    await core.refresh({ brandId: BRAND_ID, now: NOW, db });

    const first = firstAnswerAt(NOW).toISOString().slice(0, 10);
    expect(first).toBe(rows.results[0].created_at.slice(0, 10));
    expect(rollups.refreshInsightsDaily).toHaveBeenCalledWith(BRAND_ID, first, '2026-10-28');
    expect(rollups.refreshCitationsDaily.mock.calls.length).toBeGreaterThanOrEqual(2);
    // The demo's month of answer terms in one call.
    expect(rollups.refreshMentionsDaily).toHaveBeenCalledWith(BRAND_ID, first, '2026-10-28', {
      termDays: 31,
      together: true,
    });
    expect(rollups.refreshPerceptionSnapshots).toHaveBeenCalledWith(BRAND_ID);
    // A first build reads nothing back.
    expect(db.calls.some((c) => c.op === 'select')).toBe(false);

    // What the triggers queued while it was rewritten is done.
    const cleared = db.calls.filter((c) => c.op === 'delete').map((c) => c.table);
    expect(cleared).toEqual(['insights_rollup_rebuilds', 'citation_rollup_rebuilds']);
  });

  it('starts the rollups together, the Perception views after the Mentions ones', async () => {
    const order = [];
    const slow = (name, ms) => async () => {
      order.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      order.push(`${name}:end`);
      return true;
    };
    rollups.refreshInsightsDaily.mockImplementationOnce(slow('insights', 10));
    rollups.refreshCitationsDaily.mockImplementation(slow('citations', 5));
    rollups.refreshMentionsDaily.mockImplementationOnce(slow('mentions', 5));
    rollups.refreshPerceptionSnapshots.mockImplementationOnce(slow('perception', 1));
    await core.refresh({ brandId: BRAND_ID, now: NOW, db: recordingDb() });
    rollups.refreshCitationsDaily.mockImplementation(async () => true);

    expect(order.slice(0, 3).sort()).toEqual([
      'citations:start',
      'insights:start',
      'mentions:start',
    ]);
    expect(order.indexOf('mentions:end')).toBeLessThan(order.indexOf('perception:start'));
  });

  it('on a rebuild also empties the days the old month covered and the new one doesn’t', async () => {
    const db = recordingDb({ reads: { insights_brand_daily: [{ day: '2026-09-20' }] } });
    await core.refresh({ brandId: BRAND_ID, now: NOW, db, rebuild: true });
    expect(rollups.refreshInsightsDaily).toHaveBeenCalledWith(BRAND_ID, '2026-09-20', '2026-10-28');
    expect(rollups.refreshMentionsDaily.mock.calls[0][1]).toBe('2026-09-20');
  });

  it('fails, for the next visit to rebuild, when a rollup does', async () => {
    rollups.refreshInsightsDaily.mockResolvedValueOnce(false);
    await expect(core.refresh({ brandId: BRAND_ID, now: NOW, db: recordingDb() })).rejects.toThrow(
      'demo insights rollups failed',
    );
    rollups.refreshMentionsDaily.mockResolvedValueOnce(false);
    await expect(core.refresh({ brandId: BRAND_ID, now: NOW, db: recordingDb() })).rejects.toThrow(
      'demo mention rollups failed',
    );
  });
});
