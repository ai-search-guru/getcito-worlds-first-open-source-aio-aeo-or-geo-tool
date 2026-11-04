import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { GA_DAYS, GA_PROPERTY_ID, SNIPPET_DAYS, traffic, trafficRows } =
  await import('./traffic.js');
const { mapAiTrafficRows } = await import('../gaSync.js');
const { classifyAiSource } = await import('../aiSources.js');
const { AI_BOTS } = await import('../aiBots.js');

/**
 * The demo brand's AI Referral Traffic (demo-site): a quarter of Analytics
 * and Search Console, four weeks of snippet visits and journeys, a month of
 * AI crawler hits, and the page opportunities they make.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-28T12:00:00Z');
const DAY = 86_400_000;
const rows = trafficRows({ brandId: BRAND_ID, now: NOW });
const { analytics, search, snippet, bots, opportunities } = rows;

const days = (list, key) => new Set(list.map((r) => r[key]));
const ago = (day) => Math.floor((NOW.getTime() - Date.parse(`${day}T00:00:00Z`)) / DAY);

describe('trafficRows: Google Analytics and Search Console', () => {
  it('has a quarter of Analytics, up to yesterday, in the GA sync’s own row shape', () => {
    for (const list of [analytics.ai, analytics.pages, analytics.channels]) {
      const dates = [...days(list, 'date')].sort();
      expect(dates).toHaveLength(GA_DAYS);
      expect(ago(dates.at(-1))).toBe(1);
      for (const row of list) expect(Date.parse(row.created_at)).toBeLessThanOrEqual(NOW.getTime());
    }
    const shape = Object.keys(
      mapAiTrafficRows('b', {
        dimensionHeaders: [{ name: 'date' }],
        metricHeaders: [{ name: 'sessions' }],
        rows: [{ dimensionValues: [{ value: '20261027' }], metricValues: [{ value: '1' }] }],
      })[0],
    );
    for (const row of analytics.ai) {
      expect(Object.keys(row).sort()).toEqual([...shape, 'created_at'].sort());
      expect(classifyAiSource(row.source, { origin: 'analytics' })).toBe(row.platform);
      expect(row.landing_page.startsWith('/')).toBe(true);
    }
    // ChatGPT Shopping's product-card visits (#1283).
    expect(analytics.ai.some((r) => r.surface === 'shopping' && r.medium === 'feed')).toBe(true);
  });

  it('grows its AI sessions over the quarter, and pages carry their AI sessions', () => {
    const sum = (list) => list.reduce((s, r) => s + r.sessions, 0);
    const first = sum(analytics.ai.filter((r) => ago(r.date) > 60));
    const last = sum(analytics.ai.filter((r) => ago(r.date) <= 30));
    expect(last).toBeGreaterThan(first * 1.3);
    const day = analytics.ai[analytics.ai.length - 1].date;
    for (const ai of analytics.ai.filter((r) => r.date === day)) {
      const page = analytics.pages.find(
        (p) => p.date === day && p.landing_page === ai.landing_page,
      );
      expect(page.sessions).toBeGreaterThanOrEqual(ai.sessions);
    }
    expect(days(analytics.channels, 'channel')).toContain('AI Assistant');
    expect(analytics.items.every((i) => i.item_revenue >= 0 && i.item_name)).toBe(true);
  });

  it("has Search Console's queries for its sync window and pages for the quarter", () => {
    expect(days(search.queries, 'date').size).toBe(28);
    expect(days(search.pages, 'date').size).toBe(GA_DAYS);
    expect(Math.min(...search.queries.map((r) => ago(r.date)))).toBe(2);
    for (const row of search.pages) expect(row.page).toMatch(/^https:\/\/brewline\.example/);
    // The low-acid guide: impressions up, clicks down (AT-008).
    const guide = search.pages.filter((r) => r.page.endsWith('/low-acid-coffee-guide'));
    const half = (list, key) => list.reduce((s, r) => s + r[key], 0);
    const [early, late] = [guide.slice(0, 30), guide.slice(-30)];
    expect(half(late, 'impressions')).toBeGreaterThan(half(early, 'impressions'));
    expect(half(late, 'clicks')).toBeLessThan(half(early, 'clicks'));
  });
});

describe('trafficRows: the snippet', () => {
  it('records four weeks of visits, each from an AI source, none later than now', () => {
    const visitDays = [...new Set(snippet.visits.map((v) => v.created_at.slice(0, 10)))];
    expect(Math.max(...visitDays.map(ago))).toBe(SNIPPET_DAYS);
    for (const v of [...snippet.visits, ...snippet.pageviews]) {
      expect(classifyAiSource(v.source_platform)).toBe(v.source_platform);
      expect(v.url).toMatch(/^https:\/\/brewline\.example\//);
      expect(v.visitor_key).toMatch(/^[0-9a-f]{64}$/);
      expect(Date.parse(v.created_at)).toBeLessThan(NOW.getTime());
    }
    expect(snippet.visits.every((v) => v.visit_of === null)).toBe(true);
    const ids = new Set(snippet.visits.map((v) => v.id));
    expect(snippet.pageviews.every((p) => ids.has(p.visit_of))).toBe(true);
    expect(snippet.visits.some((v) => v.source_surface === 'shopping')).toBe(true);
    // AI answers still link a removed guide: Broken AI links.
    expect(snippet.visits.some((v) => v.http_status === 404)).toBe(true);
  });

  it('records journeys and conversions as the snippet’s events are stored', () => {
    const conversions = snippet.events.filter((e) => e.kind === 'conversion');
    expect(conversions.length).toBeGreaterThan(5);
    expect(new Set(conversions.map((e) => e.goal))).toEqual(new Set(['order', 'newsletter']));
    for (const e of snippet.events) {
      expect(e.visitor_id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(Date.parse(e.first_at)).toBeLessThanOrEqual(Date.parse(e.occurred_at));
      expect(NOW.getTime() - Date.parse(e.occurred_at)).toBeLessThan(21 * DAY);
    }
    const order = conversions.find((e) => e.goal === 'order');
    expect(order).toMatchObject({ origin: 'call', currency: 'USD' });
    expect(order.order_ref).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('trafficRows: AI crawlers', () => {
  it('counts a month of known crawlers by page, with the last days’ raw hits', () => {
    const known = new Map(AI_BOTS.map((b) => [b.key, b.type]));
    for (const row of bots.daily) expect(known.get(row.bot)).toBe(row.bot_type);
    expect(days(bots.daily, 'day').size).toBe(30);
    const recent = bots.daily.filter((r) => ago(r.day) < 2);
    expect(recent.reduce((s, r) => s + r.hits, 0)).toBe(bots.events.length);
    // A sender's secret hashes to sha256 hex: this one matches none.
    expect(bots.connection.secret_hash).not.toMatch(/^[0-9a-f]{64}$/);
    expect(bots.connection.last_event_at > bots.events.at(-1).occurred_at).toBe(true);
  });
});

describe('trafficRows: page opportunities and settings', () => {
  it('finds the best sellers AI never sends anyone to', () => {
    expect(opportunities.map((o) => o.landing_page)).toEqual([
      '/coffee/colombia-huila',
      '/subscriptions/espresso-club',
    ]);
    for (const o of opportunities) {
      expect(o).toMatchObject({ kind: 'no_ai_traffic', value_signal: 'revenue', ai_sessions: 0 });
      expect(o.value_percentile).toBeGreaterThanOrEqual(70);
      expect(o.resolved_at).toBeNull();
    }
  });

  it('maps the demo’s sample properties and turns conversions on', () => {
    expect(rows.brand).toEqual({
      ga_property_id: GA_PROPERTY_ID,
      gsc_property: 'sc-domain:brewline.example',
      conversions_enabled: true,
    });
  });

  it('is the same every time but for its dates', () => {
    const later = trafficRows({ brandId: BRAND_ID, now: new Date(NOW.getTime() + 7 * DAY) });
    const strip = ({ date: _d, created_at: _c, ...r }) => r;
    expect(later.analytics.channels.map(strip)).toEqual(analytics.channels.map(strip));
    expect(later.search.queries.map(strip)).toEqual(search.queries.map(strip));
  });
});

describe('traffic.build', () => {
  it('maps the brand, then writes only its own tables, a visit before its pageviews', async () => {
    const writes = [];
    const db = {
      from: (table) => ({
        upsert: async (list, { onConflict }) => {
          writes.push({ table, list, onConflict });
          return { error: null };
        },
        // ai_bot_events: an identity id, no key to write over.
        insert: async (list) => {
          writes.push({ table, list, inserted: true });
          return { error: null };
        },
        update: (values) => ({
          eq: async () => {
            writes.push({ table, values });
            return { error: null };
          },
        }),
      }),
    };
    await traffic.build({ brandId: BRAND_ID, now: NOW, db });
    expect(writes[0]).toEqual({ table: 'brands', values: rows.brand });
    const tables = writes.slice(1).map((w) => w.table);
    expect(tables.filter((t) => !traffic.tables.includes(t))).toEqual([]);
    const logs = writes.filter((w) => w.table === 'ai_traffic_logs').flatMap((w) => w.list);
    const firstPageview = logs.findIndex((l) => l.visit_of !== null);
    expect(logs.slice(firstPageview).every((l) => l.visit_of !== null)).toBe(true);
    // Written over by what each row counts, as the syncs write them.
    const keyOf = (table) => writes.find((w) => w.table === table).onConflict;
    expect(keyOf('ga_page_stats')).toBe('brand_id,date,landing_page');
    expect(keyOf('gsc_query_stats')).toBe('brand_id,date,query');
    expect(keyOf('ai_bot_daily')).toBe('brand_id,day,bot,page');
    expect(keyOf('ai_traffic_logs')).toBe('id');
    expect(writes.filter((w) => w.inserted).map((w) => w.table)).toEqual(['ai_bot_events']);
  });
});
