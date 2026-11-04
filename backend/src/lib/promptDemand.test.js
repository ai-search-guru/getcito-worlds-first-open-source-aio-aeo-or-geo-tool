import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A prompt's real demand (PROMPT-014): Search Console every night, Google
 * Trends, People Also Ask and YouTube from DataForSEO's queued tasks once a
 * week (DEMAND_SIGNALS), and the level they come to.
 */

// ─── A database in memory ───────────────────────────────────────────────────

let tables;
let writes;
let rpcCalls;
/** The database's now(), for the claims. */
let dbNow;
/** Runs on each Search Console read (a brand being matched). */
let onGscRead;

function valueAt(row, path) {
  return path.split('.').reduce((v, key) => (v == null ? v : v[key]), row);
}

function query(table) {
  const filters = [];
  let range = null;
  let op = 'select';
  let payload = null;
  const rows = () => {
    let out = (tables[table] ?? []).filter((row) =>
      filters.every(([kind, col, value]) => {
        const v = valueAt(row, col);
        if (kind === 'eq') return v === value;
        if (kind === 'in') return value.includes(v);
        if (kind === 'notNull') return v !== null && v !== undefined;
        return true;
      }),
    );
    if (range) out = out.slice(range[0], range[1] + 1);
    return out;
  };
  const chain = {
    select: () => chain,
    eq: (col, value) => (filters.push(['eq', col, value]), chain),
    in: (col, value) => (filters.push(['in', col, value]), chain),
    not: (col, operator, value) => {
      if (operator === 'is' && value === null) filters.push(['notNull', col]);
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    range: (from, to) => ((range = [from, to]), chain),
    upsert: (data) => ((op = 'upsert'), (payload = data), chain),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve, reject) => {
      if (op === 'upsert') {
        // The foreign key: a row for a prompt that is gone fails the whole write.
        const promptIds = new Set((tables.prompts ?? []).map((p) => p.id));
        if (table === 'prompt_demand' && payload.some((row) => !promptIds.has(row.prompt_id))) {
          return Promise.resolve({
            error: { code: '23503', message: 'violates foreign key constraint' },
          }).then(resolve, reject);
        }
        writes.push({ table, rows: payload });
        const kept = tables[table] ?? (tables[table] = []);
        for (const row of payload) {
          const at = kept.findIndex((r) => r.prompt_id === row.prompt_id);
          if (at === -1) kept.push({ ...row });
          else kept[at] = { ...kept[at], ...row };
        }
        return Promise.resolve({ error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    },
  };
  return chain;
}

/** prompt_demand_claim: no task waiting and no claim younger than p_stale_minutes. */
function claim({ p_rows, p_stale_minutes }) {
  const at = new Date(dbNow).toISOString();
  const claimed = [];
  for (const { prompt_id, brand_id } of p_rows) {
    if (!tables.prompts.some((p) => p.id === prompt_id)) continue;
    const row = tables.prompt_demand.find((r) => r.prompt_id === prompt_id);
    if (!row) {
      tables.prompt_demand.push({
        prompt_id,
        brand_id,
        claimed_at: at,
        tasks: null,
        gsc: null,
        level: null,
        signals: 0,
        updated_at: at,
      });
    } else {
      if (row.tasks) continue;
      if (row.claimed_at && Date.parse(row.claimed_at) >= dbNow - p_stale_minutes * 60_000)
        continue;
      row.claimed_at = at;
    }
    claimed.push(prompt_id);
  }
  return claimed;
}

/** prompt_demand_brand_updates: each brand's last write. */
function brandUpdates() {
  const out = {};
  for (const row of tables.prompt_demand) {
    if (row.updated_at && !(out[row.brand_id] >= row.updated_at))
      out[row.brand_id] = row.updated_at;
  }
  return out;
}

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => query(table),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === 'prompt_demand_claim') return { data: claim(args), error: null };
      if (name === 'prompt_demand_brand_updates') return { data: brandUpdates(), error: null };
      onGscRead?.(args.p_brand_id);
      return { data: tables.gsc?.[args.p_brand_id] ?? [], error: null };
    },
  },
}));

const gscReads = () =>
  rpcCalls.filter((c) => c.name === 'prompt_demand_gsc_queries').map((c) => c.args.p_brand_id);

// The plan check (#1608): the organizations and brands whose plan ended.
let endedOrgs;
let endedBrands;
vi.mock('./activeSubscriptions.js', () => ({
  activeOrgFilter: async () => (orgId) => !endedOrgs.has(orgId),
  activeBrandFilter: async () => (brandId) => !endedBrands.has(brandId),
}));

const postTasks = vi.fn();
const readyTasks = vi.fn();
const getTask = vi.fn();
vi.mock('./dataforseo.js', () => ({
  isDataForSeoConfigured: () => true,
  postTasks,
  readyTasks,
  getTask,
}));

// The Action Center's priority reads the levels: a brand whose levels changed is scored again.
const rescoreBrandActions = vi.fn();
vi.mock('./action-center/priorityData.js', () => ({ rescoreBrandActions }));

/** postTasks setting every task, each id `${path}#${tag}`, in one request. */
async function setAll(path, tasks, { onChunk } = {}) {
  const ids = new Map(tasks.map((t) => [t.tag, `${path}#${t.tag}`]));
  if (onChunk) await onChunk(ids);
  return { ids, failed: 0, errors: [] };
}

const { logger } = await import('./logger.js');

const {
  CLAIM_STALE_MINUTES,
  LEVEL_RULE,
  NIGHTLY_LIMIT,
  REFRESH_DAYS,
  SOURCES,
  TASK_EXPIRE_DAYS,
  collectDemandTasks,
  demandLevel,
  demandResponse,
  gscDemand,
  isDue,
  paaSignal,
  pickDue,
  postDemandTasks,
  questionKey,
  sweepOrder,
  sweepPromptDemand,
  topKeyword,
  trendsKeyword,
  trendsSignal,
  youtubeSignal,
} = await import('./promptDemand.js');

const NOW = Date.parse('2026-10-28T06:00:00Z');
const AT = new Date(NOW).toISOString();
const DAY = 86_400_000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

// ─── Realistic DataForSEO results ───────────────────────────────────────────

/** Google Trends Explore, one keyword: 52 weeks, the last ones higher. */
function trendsResult(values) {
  return {
    keywords: ['ai search monitoring'],
    type: 'web',
    location_code: 2840,
    language_code: 'en',
    check_url: 'https://trends.google.com/trends/explore?q=ai%20search%20monitoring',
    datetime: '2026-10-27 22:10:01 +00:00',
    items_count: 1,
    items: [
      {
        position: 1,
        type: 'google_trends_graph',
        title: 'Interest over time',
        keywords: ['ai search monitoring'],
        data: values.map((value, i) => ({
          date_from: new Date(Date.UTC(2025, 9, 26) + i * 7 * DAY).toISOString().slice(0, 10),
          date_to: new Date(Date.UTC(2025, 9, 26) + (i * 7 + 6) * DAY).toISOString().slice(0, 10),
          timestamp: (Date.UTC(2025, 9, 26) + i * 7 * DAY) / 1000,
          missing_data: false,
          values: [value],
        })),
        averages: [40],
      },
    ],
  };
}

/** Google organic (advanced) with a People Also Ask block among the results. */
const SERP_RESULT = {
  keyword: 'ai search monitoring',
  type: 'organic',
  se_domain: 'google.com',
  location_code: 2840,
  language_code: 'en',
  check_url: 'https://www.google.com/search?q=ai+search+monitoring',
  datetime: '2026-10-27 22:12:40 +00:00',
  item_types: ['organic', 'people_also_ask', 'related_searches'],
  se_results_count: 245000000,
  items_count: 12,
  items: [
    {
      type: 'organic',
      rank_group: 1,
      rank_absolute: 1,
      domain: 'example.com',
      title: 'AI Search Monitoring',
      url: 'https://example.com/',
    },
    {
      type: 'people_also_ask',
      rank_group: 1,
      rank_absolute: 3,
      position: 'left',
      xpath: '/html[1]/body[1]/div[3]',
      items: [
        {
          type: 'people_also_ask_element',
          title: 'How do I track my brand in ChatGPT?',
          seed_question: null,
          xpath: '/html[1]/body[1]/div[3]/div[1]',
          expanded_element: [
            {
              type: 'people_also_ask_expanded_element',
              featured_title: null,
              url: 'https://www.example.org/track-brand-chatgpt',
              domain: 'www.example.org',
              title: 'Track your brand in ChatGPT',
              description: 'To track your brand…',
              images: null,
              timestamp: null,
              table: null,
            },
          ],
        },
        {
          type: 'people_also_ask_element',
          title: 'What is AI search monitoring?',
          seed_question: null,
          xpath: '/html[1]/body[1]/div[3]/div[2]',
          expanded_element: [
            {
              type: 'people_also_ask_ai_overview_expanded_element',
              items: [{ type: 'ai_overview_element', text: '…' }],
            },
          ],
        },
        {
          type: 'people_also_ask_element',
          title: 'how do i track my brand in chatgpt?',
          seed_question: null,
          xpath: '/html[1]/body[1]/div[3]/div[3]',
          expanded_element: null,
        },
        {
          type: 'people_also_ask_element',
          title: 'Is there a tool to monitor AI answers?',
          seed_question: null,
          xpath: '/html[1]/body[1]/div[3]/div[4]',
          expanded_element: [],
        },
      ],
    },
    { type: 'related_searches', rank_group: 1, rank_absolute: 11, items: ['ai monitoring tools'] },
  ],
};

/** YouTube organic (advanced): videos and a channel. */
const YOUTUBE_RESULT = {
  keyword: 'ai search monitoring',
  type: 'organic',
  se_domain: 'youtube.com',
  location_code: 2840,
  language_code: 'en',
  check_url: 'https://www.youtube.com/results?search_query=ai+search+monitoring',
  datetime: '2026-10-27 22:15:02 +00:00',
  se_results_count: 214,
  items_count: 3,
  items: [
    {
      type: 'youtube_video',
      rank_group: 1,
      rank_absolute: 1,
      block_rank: 1,
      block_name: null,
      title: 'How to track your brand in ChatGPT',
      url: 'https://www.youtube.com/watch?v=abc123',
      thumbnail_url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      channel_id: 'UC1',
      channel_name: 'Search Lab',
      channel_url: 'https://www.youtube.com/@searchlab',
      channel_logo: null,
      description: 'A walkthrough',
      highlighted: ['track'],
      badges: ['New'],
      is_live: false,
      is_movie: null,
      views_count: 310000,
      publication_date: '2 months ago',
      timestamp: '2026-08-20 10:00:00 +00:00',
      video_id: 'abc123',
      duration_time: '12:04',
      duration_time_seconds: 724,
      is_shorts: false,
    },
    {
      type: 'youtube_channel',
      rank_group: 1,
      rank_absolute: 2,
      block_rank: 1,
      block_name: null,
      channel_id: 'UC2',
      name: 'AI Monitor',
      video_count: 0,
      is_verified: true,
    },
    {
      type: 'youtube_video',
      rank_group: 2,
      rank_absolute: 3,
      block_rank: 2,
      block_name: null,
      title: 'AI visibility tools compared',
      url: 'https://www.youtube.com/watch?v=def456',
      channel_name: 'Growth Notes',
      views_count: 1490000,
      publication_date: '5 months ago',
      timestamp: '2026-05-11 08:00:00 +00:00',
      video_id: 'def456',
      is_shorts: false,
    },
  ],
};

// ─── Fixtures ───────────────────────────────────────────────────────────────

const prompt = (id, brandId, text, isActive = true) => ({
  id,
  text,
  is_active: isActive,
  prompt_sets: { brand_id: brandId },
});

const volume = (promptId, googleVolumes, extra = {}) => ({
  prompt_id: promptId,
  google_volumes: googleVolumes,
  location_code: 2840,
  language_code: 'en',
  fetched_at: daysAgo(20),
  ...extra,
});

beforeEach(() => {
  tables = {
    brands: [
      {
        id: 'b1',
        organization_id: 'o1',
        gsc_property: 'sc-domain:getcito.com',
        is_active: true,
        is_demo: false,
      },
    ],
    prompts: [
      prompt('p1', 'b1', 'What is the best AI search monitoring tool?'),
      prompt('p2', 'b1', 'How do I track my brand in ChatGPT answers?'),
      prompt('p3', 'b1', 'Paused prompt about pricing', false),
    ],
    prompt_demand: [],
    prompt_volumes: [],
    gsc: {
      b1: [
        { query: 'ai search monitoring tool', clicks: 60, impressions: 2400 },
        { query: 'best ai search monitoring', clicks: 36, impressions: 1720 },
        { query: 'track brand chatgpt', clicks: 4, impressions: 90 },
        { query: 'getcito login', clicks: 300, impressions: 900 },
      ],
    },
  };
  writes = [];
  rpcCalls = [];
  dbNow = NOW;
  onGscRead = null;
  endedOrgs = new Set();
  endedBrands = new Set();
  postTasks.mockReset();
  readyTasks.mockReset().mockResolvedValue(new Map());
  getTask.mockReset();
  rescoreBrandActions.mockReset().mockResolvedValue(3);
  vi.stubEnv('DEMAND_SIGNALS', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const demandRow = (promptId) => tables.prompt_demand.find((r) => r.prompt_id === promptId);

// ─── Search Console ─────────────────────────────────────────────────────────

describe('gscDemand', () => {
  const prompts = [
    { id: 'p1', text: 'What is the best AI search monitoring tool?' },
    { id: 'p2', text: 'How do I track my brand in ChatGPT answers?' },
  ];

  it("sums each prompt's matching queries over the window, the most seen as its example", () => {
    const demand = gscDemand(tables.gsc.b1, prompts, AT);
    expect(demand.get('p1')).toEqual({
      impressions: 4120,
      clicks: 96,
      queries: 2,
      top: { query: 'ai search monitoring tool', impressions: 2400, clicks: 60 },
      at: AT,
    });
    expect(demand.get('p2')).toEqual({
      impressions: 90,
      clicks: 4,
      queries: 1,
      top: { query: 'track brand chatgpt', impressions: 90, clicks: 4 },
      at: AT,
    });
  });

  it('gives a query to the closest prompt only, and a prompt nothing matches zeros', () => {
    const demand = gscDemand(
      [{ query: 'monitoring tool', clicks: 1, impressions: 10 }],
      [
        { id: 'a', text: 'best monitoring tool' },
        { id: 'b', text: 'monitoring dashboards for teams' },
      ],
      AT,
    );
    expect(demand.get('a').queries).toBe(1);
    expect(demand.get('b')).toEqual({ impressions: 0, clicks: 0, queries: 0, top: null, at: AT });
  });

  it('reads nothing (null) when the brand has no query in the window', () => {
    expect(gscDemand([], prompts, AT)).toBeNull();
  });
});

// ─── The level ──────────────────────────────────────────────────────────────

describe('demandLevel', () => {
  const strong = {
    gsc: { impressions: 4120 },
    trends: { trend: 'rising' },
    paa: { questions: [1, 2, 3, 4].map((n) => ({ question: `q${n}` })) },
    youtube: { views: 1_800_000 },
  };

  it('is high with every signal strong, and counts the signals read', () => {
    expect(demandLevel(strong)).toEqual({ level: 'high', signals: 4 });
  });

  it('has no level with nothing read', () => {
    expect(demandLevel({ gsc: null, trends: null, paa: null, youtube: null })).toEqual({
      level: null,
      signals: 0,
    });
  });

  it('is at most medium on one signal, however strong', () => {
    expect(demandLevel({ gsc: { impressions: 50_000 } })).toEqual({ level: 'medium', signals: 1 });
  });

  it('counts a read that found nothing as read, and as low', () => {
    expect(
      demandLevel({
        gsc: { impressions: 20 },
        trends: { trend: null },
        paa: { questions: [] },
        youtube: { views: 300 },
      }),
    ).toEqual({ level: 'low', signals: 4 });
  });

  it('follows the rule at its edges', () => {
    // 3 of 6 points (0.5): medium.
    expect(
      demandLevel({
        gsc: { impressions: LEVEL_RULE.gscImpressions.strong },
        trends: { trend: 'steady' },
        paa: { questions: [] },
      }).level,
    ).toBe('medium');
    // 6 of 8 points (0.75): high.
    expect(
      demandLevel({
        gsc: { impressions: LEVEL_RULE.gscImpressions.strong },
        trends: { trend: 'steady' },
        paa: { questions: [{}, {}, {}, {}] },
        youtube: { views: LEVEL_RULE.youtubeViews.some },
      }).level,
    ).toBe('high');
    // 1 of 4 points (0.25): low.
    expect(
      demandLevel({
        gsc: { impressions: LEVEL_RULE.gscImpressions.some },
        trends: { trend: 'falling' },
      }).level,
    ).toBe('low');
  });
});

// ─── The keyword ────────────────────────────────────────────────────────────

describe('topKeyword', () => {
  it("takes the analysis's keyword with the most searches, with its location and language", () => {
    expect(
      topKeyword(volume('p1', { 'ai monitoring': 320, 'ai search monitoring': 1900, geo: 0 })),
    ).toEqual({ keyword: 'ai search monitoring', locationCode: 2840, languageCode: 'en' });
  });

  it('has none without an analysis or a keyword Google has searches for', () => {
    expect(topKeyword(null)).toBeNull();
    expect(topKeyword(volume('p1', { 'ai monitoring': 0 }))).toBeNull();
  });

  it("reads Trends' refused characters as spaces", () => {
    expect(trendsKeyword('ai-search "monitoring": tools')).toBe('ai search monitoring tools');
    expect(trendsKeyword('x'.repeat(101))).toBeNull();
  });
});

// ─── Reading the results ────────────────────────────────────────────────────

describe('trendsSignal', () => {
  it('reads a rising year and its change on a year ago', () => {
    const values = Array.from({ length: 52 }, (_, i) => (i < 4 ? 25 : i >= 48 ? 41 : 30));
    const signal = trendsSignal(trendsResult(values), AT);
    expect(signal).toMatchObject({ trend: 'rising', change: 64, from: '2025-10-26', at: AT });
    expect(signal.points).toHaveLength(52);
  });

  it('reads falling and steady years', () => {
    const falling = Array.from({ length: 52 }, (_, i) => (i < 4 ? 80 : 40));
    expect(trendsSignal(trendsResult(falling), AT)).toMatchObject({
      trend: 'falling',
      change: -50,
    });
    const steady = Array.from({ length: 52 }, () => 50);
    expect(trendsSignal(trendsResult(steady), AT)).toMatchObject({ trend: 'steady', change: 0 });
  });

  it('says too little data when Google has no interest, and skips missing weeks', () => {
    const result = trendsResult([0, 0, 0]);
    result.items[0].data[1].missing_data = true;
    expect(trendsSignal(result, AT)).toMatchObject({ points: [0, 0], trend: null, change: null });
    expect(trendsSignal(null, AT)).toMatchObject({ points: [], trend: null });
  });
});

describe('paaSignal', () => {
  it('reads each question once, with the page Google answers it with', () => {
    expect(paaSignal(SERP_RESULT, AT)).toEqual({
      questions: [
        {
          question: 'How do I track my brand in ChatGPT?',
          url: 'https://www.example.org/track-brand-chatgpt',
          domain: 'www.example.org',
        },
        { question: 'What is AI search monitoring?', url: null, domain: null },
        { question: 'Is there a tool to monitor AI answers?', url: null, domain: null },
      ],
      at: AT,
    });
  });

  it('reads no question from a page without the block, or no result', () => {
    expect(paaSignal({ items: [SERP_RESULT.items[0]] }, AT)).toEqual({ questions: [], at: AT });
    expect(paaSignal(null, AT)).toEqual({ questions: [], at: AT });
  });

  it('keeps no link that is not an http(s) URL', () => {
    const element = (url) => ({
      type: 'people_also_ask_element',
      title: `Question ${url}`,
      expanded_element: [{ url, domain: 'example.org' }],
    });
    const result = {
      items: [
        {
          type: 'people_also_ask',
          items: [element('javascript:alert(1)'), element('https://example.org/a')],
        },
      ],
    };
    expect(paaSignal(result, AT).questions.map((q) => q.url)).toEqual([
      null,
      'https://example.org/a',
    ]);
  });
});

describe('youtubeSignal', () => {
  it("sums the videos' views, keeps the most viewed and YouTube's result count", () => {
    expect(youtubeSignal(YOUTUBE_RESULT, AT)).toEqual({
      videos: 2,
      views: 1_800_000,
      results: 214,
      top: {
        title: 'AI visibility tools compared',
        url: 'https://www.youtube.com/watch?v=def456',
        channel: 'Growth Notes',
        views: 1_490_000,
        published: '2026-05-11 08:00:00 +00:00',
      },
      at: AT,
    });
  });

  it('keeps no link that is not an http(s) URL', () => {
    const video = { type: 'youtube_video', title: 'A video', views_count: 10 };
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', '/watch?v=x', 42]) {
      expect(youtubeSignal({ items: [{ ...video, url }] }, AT).top.url).toBeNull();
    }
    expect(youtubeSignal({ items: [{ ...video, url: 'http://youtu.be/x' }] }, AT).top.url).toBe(
      'http://youtu.be/x',
    );
  });
});

describe('the tasks asked', () => {
  const asked = {
    keyword: 'ai search monitoring',
    locationCode: null,
    languageCode: null,
    tag: 'p1',
  };

  it('asks Trends for 12 months worldwide without a location, and SERP for the US', () => {
    expect(SOURCES.trends.task(asked)).toEqual({
      keywords: ['ai search monitoring'],
      language_code: 'en',
      type: 'web',
      time_range: 'past_12_months',
      item_types: ['google_trends_graph'],
      tag: 'p1',
    });
    expect(SOURCES.paa.task(asked)).toMatchObject({ location_code: 2840, language_code: 'en' });
    expect(SOURCES.youtube.task({ ...asked, locationCode: 2792, languageCode: 'tr' })).toEqual({
      keyword: 'ai search monitoring',
      location_code: 2792,
      language_code: 'tr',
      block_depth: 20,
      tag: 'p1',
    });
  });
});

// ─── The weekly cache and the nightly cap ───────────────────────────────────

describe('isDue and pickDue', () => {
  const keyword = { keyword: 'ai search monitoring' };

  it('sets a prompt again a week after it was set, at once for a new keyword, never while waiting', () => {
    expect(isDue(undefined, keyword, NOW)).toBe(true);
    const row = { keyword: 'ai search monitoring', tasks: null, posted_at: daysAgo(3) };
    expect(isDue(row, keyword, NOW)).toBe(false);
    expect(isDue({ ...row, posted_at: daysAgo(REFRESH_DAYS) }, keyword, NOW)).toBe(true);
    expect(isDue({ ...row, keyword: 'ai monitoring' }, keyword, NOW)).toBe(true);
    expect(isDue({ ...row, posted_at: daysAgo(9), tasks: { trends: 't1' } }, keyword, NOW)).toBe(
      false,
    );
  });

  it(`takes at most ${NIGHTLY_LIMIT} a night, the never read first, then the longest waiting`, () => {
    const candidates = Array.from({ length: 600 }, (_, i) => ({
      promptId: `p${i}`,
      postedAt: i % 2 ? daysAgo(8 + (i % 30)) : null,
    }));
    const picked = pickDue(candidates);
    expect(picked).toHaveLength(NIGHTLY_LIMIT);
    expect(picked.slice(0, 300).every((c) => c.postedAt === null)).toBe(true);
    const dated = picked.slice(300).map((c) => Date.parse(c.postedAt));
    expect(dated).toEqual([...dated].sort((a, b) => a - b));
  });
});

// ─── The sweep ──────────────────────────────────────────────────────────────

describe('sweepPromptDemand', () => {
  it('with DEMAND_SIGNALS off, writes Search Console and the level, and sets no paid task', async () => {
    tables.prompt_volumes = [volume('p1', { 'ai search monitoring': 1900 })];
    const outcome = await sweepPromptDemand({ now: NOW });

    expect(outcome).toMatchObject({ brands: 1, written: 2, posted: 0, paid: false });
    expect(postTasks).not.toHaveBeenCalled();
    expect(readyTasks).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
    expect(rpcCalls.filter((c) => c.name === 'prompt_demand_gsc_queries')).toEqual([
      {
        name: 'prompt_demand_gsc_queries',
        args: { p_brand_id: 'b1', p_from: '2026-10-01', p_to: '2026-10-28', p_limit: 5000 },
      },
    ]);
    expect(rpcCalls.some((c) => c.name === 'prompt_demand_claim')).toBe(false);
    expect(demandRow('p1')).toMatchObject({
      brand_id: 'b1',
      gsc: { impressions: 4120, clicks: 96, queries: 2 },
      level: 'medium',
      signals: 1,
    });
    // The paused prompt isn't read.
    expect(demandRow('p3')).toBeUndefined();
  });

  it('makes no row for a brand without Search Console and nothing else read', async () => {
    tables.brands[0].gsc_property = null;
    const outcome = await sweepPromptDemand({ now: NOW });
    expect(outcome.written).toBe(0);
    expect(gscReads()).toEqual([]);
    expect(tables.prompt_demand).toEqual([]);
  });

  it("clears a brand's Search Console once its property is gone", async () => {
    tables.brands[0].gsc_property = null;
    tables.prompt_demand = [
      {
        prompt_id: 'p1',
        brand_id: 'b1',
        gsc: { impressions: 900, clicks: 9, queries: 1, top: null, at: daysAgo(1) },
        trends: { trend: 'rising', points: [1], change: 30, at: daysAgo(2) },
        level: 'high',
        signals: 2,
        tasks: null,
        posted_at: daysAgo(2),
        keyword: 'ai search monitoring',
      },
    ];
    await sweepPromptDemand({ now: NOW });
    expect(demandRow('p1')).toMatchObject({ gsc: null, level: 'medium', signals: 1 });
  });

  it('with DEMAND_SIGNALS on, sets the three tasks for each prompt with a measured keyword', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    tables.prompt_volumes = [volume('p1', { 'ai search monitoring': 1900, 'ai monitoring': 300 })];
    // p2 was analysed, and Google has no searches for its keywords.
    tables.prompt_volumes.push(volume('p2', { 'track brand chatgpt answers': 0 }));
    postTasks.mockImplementation(setAll);

    const outcome = await sweepPromptDemand({ now: NOW });

    expect(outcome).toMatchObject({ paid: true, due: 1, posted: 1 });
    // Claimed before it was set.
    expect(rpcCalls.find((c) => c.name === 'prompt_demand_claim').args).toEqual({
      p_rows: [{ prompt_id: 'p1', brand_id: 'b1' }],
      p_stale_minutes: CLAIM_STALE_MINUTES,
    });
    expect(postTasks).toHaveBeenCalledTimes(3);
    expect(postTasks.mock.calls.map(([path]) => path)).toEqual([
      '/v3/keywords_data/google_trends/explore',
      '/v3/serp/google/organic',
      '/v3/serp/youtube/organic',
    ]);
    expect(postTasks.mock.calls[1][1]).toEqual([
      {
        keyword: 'ai search monitoring',
        location_code: 2840,
        language_code: 'en',
        device: 'desktop',
        depth: 10,
        tag: 'p1',
      },
    ]);
    expect(demandRow('p1')).toMatchObject({
      keyword: 'ai search monitoring',
      location_code: 2840,
      language_code: 'en',
      posted_at: AT,
      tasks: {
        posted_at: AT,
        trends: '/v3/keywords_data/google_trends/explore#p1',
        paa: '/v3/serp/google/organic#p1',
        youtube: '/v3/serp/youtube/organic#p1',
      },
    });
    expect(demandRow('p2')?.tasks ?? null).toBeNull();
  });

  it('does not set a prompt read this week again, nor one whose tasks are waiting', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    tables.prompt_volumes = [
      volume('p1', { 'ai search monitoring': 1900 }),
      volume('p2', { 'track brand chatgpt': 500 }),
    ];
    tables.prompt_demand = [
      {
        prompt_id: 'p1',
        brand_id: 'b1',
        keyword: 'ai search monitoring',
        posted_at: daysAgo(3),
        tasks: null,
        signals: 0,
        level: null,
        gsc: null,
      },
      {
        prompt_id: 'p2',
        brand_id: 'b1',
        keyword: 'track brand chatgpt',
        posted_at: daysAgo(1),
        tasks: { posted_at: daysAgo(1), trends: 't-p2', paa: null, youtube: null },
        signals: 0,
        level: null,
        gsc: null,
      },
    ];
    await sweepPromptDemand({ now: NOW });
    expect(postTasks).not.toHaveBeenCalled();
  });

  it('sets at most the limit a night, the longest waiting first', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    tables.prompts = Array.from({ length: 5 }, (_, i) => prompt(`p${i}`, 'b1', `prompt ${i}`));
    tables.prompt_volumes = tables.prompts.map((p) => volume(p.id, { [`keyword ${p.id}`]: 100 }));
    tables.prompt_demand = tables.prompts.map((p, i) => ({
      prompt_id: p.id,
      brand_id: 'b1',
      keyword: `keyword ${p.id}`,
      posted_at: daysAgo(8 + i),
      tasks: null,
      signals: 0,
      level: null,
      gsc: null,
    }));
    postTasks.mockImplementation(setAll);

    const outcome = await sweepPromptDemand({ now: NOW, limit: 2 });

    // Five were due; the two waiting longest were set.
    expect(outcome).toMatchObject({ due: 5, posted: 2 });
    expect(postTasks.mock.calls[0][1].map((t) => t.tag)).toEqual(['p4', 'p3']);
  });

  it('skips a workspace whose plan has ended: nothing matched, set or read for it', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    endedOrgs.add('o1');
    endedBrands.add('b1');
    tables.prompt_volumes = [volume('p1', { 'ai search monitoring': 1900 })];
    tables.prompt_demand = [
      {
        prompt_id: 'p2',
        brand_id: 'b1',
        tasks: { posted_at: daysAgo(1), trends: 't-p2', paa: null, youtube: null },
      },
    ];
    readyTasks.mockResolvedValue(new Map([['t-p2', 'p2']]));

    const outcome = await sweepPromptDemand({ now: NOW });

    expect(outcome).toMatchObject({ brands: 0, skipped: 1, posted: 0, read: 0 });
    expect(gscReads()).toEqual([]);
    expect(postTasks).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

describe('sweepPromptDemand and the demo brand', () => {
  // 00380: its prompts are sample data, and DataForSEO is paid for.
  it("never reads, sets or pays for a demo brand's prompts", async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    tables.brands[0].is_demo = true;
    tables.prompt_volumes = [volume('p1', { 'ai search monitoring': 1900 })];

    const outcome = await sweepPromptDemand({ now: NOW });

    expect(outcome).toMatchObject({ brands: 0, written: 0, posted: 0 });
    expect(gscReads()).toEqual([]);
    expect(postTasks).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

// ─── Setting the tasks: nothing paid for twice, nothing paid for lost ───────

describe('setting the paid tasks', () => {
  beforeEach(() => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    tables.prompt_volumes = [
      volume('p1', { 'ai search monitoring': 1900 }),
      volume('p2', { 'track brand chatgpt': 500 }),
    ];
  });

  const tasksOf = (promptId) => demandRow(promptId)?.tasks ?? null;

  it("writes each request's ids as soon as it's back, and keeps them when a later one fails", async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    postTasks.mockImplementation(async (path, tasks, { onChunk }) => {
      // People Also Ask: p1's request goes through, p2's fails.
      if (path === SOURCES.paa.path) {
        await onChunk(new Map([['p1', `${path}#p1`]]));
        return {
          ids: new Map([['p1', `${path}#p1`]]),
          failed: 1,
          errors: ['DataForSEO API error (502): Bad Gateway'],
        };
      }
      // The others, one request per prompt.
      for (const t of tasks) await onChunk(new Map([[t.tag, `${path}#${t.tag}`]]));
      return { ids: new Map(tasks.map((t) => [t.tag, `${path}#${t.tag}`])), failed: 0, errors: [] };
    });

    const outcome = await sweepPromptDemand({ now: NOW });

    expect(outcome).toMatchObject({ due: 2, posted: 2 });
    // The first request's id was written before the next request went.
    const taskWrites = writes.filter((w) => w.rows.some((r) => r.tasks));
    expect(taskWrites[0].rows).toEqual([
      expect.objectContaining({
        prompt_id: 'p1',
        tasks: {
          posted_at: AT,
          trends: '/v3/keywords_data/google_trends/explore#p1',
          paa: null,
          youtube: null,
        },
      }),
    ]);
    expect(tasksOf('p1')).toEqual({
      posted_at: AT,
      trends: '/v3/keywords_data/google_trends/explore#p1',
      paa: '/v3/serp/google/organic#p1',
      youtube: '/v3/serp/youtube/organic#p1',
    });
    expect(tasksOf('p2')).toEqual({
      posted_at: AT,
      trends: '/v3/keywords_data/google_trends/explore#p2',
      paa: null,
      youtube: '/v3/serp/youtube/organic#p2',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ signal: 'paa', failed: 1 }),
      '[prompt-demand] tasks not set',
    );
  });

  it("keeps the other prompts' ids when one prompt was deleted meanwhile", async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    postTasks.mockImplementation(async (path, tasks, options) => {
      // p2 is deleted while its tasks are being set (its row goes with it).
      tables.prompts = tables.prompts.filter((p) => p.id !== 'p2');
      tables.prompt_demand = tables.prompt_demand.filter((r) => r.prompt_id !== 'p2');
      return setAll(path, tasks, options);
    });

    const outcome = await sweepPromptDemand({ now: NOW });

    expect(outcome.posted).toBe(2);
    expect(tasksOf('p1')).toMatchObject({
      trends: '/v3/keywords_data/google_trends/explore#p1',
      paa: '/v3/serp/google/organic#p1',
      youtube: '/v3/serp/youtube/organic#p1',
    });
    expect(demandRow('p2')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      { promptIds: ['p2'] },
      '[prompt-demand] rows of deleted prompts not written',
    );
  });

  it('sets each prompt once when two sweeps run at once: the second finds them claimed', async () => {
    postTasks.mockImplementation(setAll);

    const outcomes = await Promise.all([
      sweepPromptDemand({ now: NOW }),
      sweepPromptDemand({ now: NOW }),
    ]);

    expect(outcomes.map((o) => o.posted).sort()).toEqual([0, 2]);
    // Three requests (one per signal), each with both prompts once.
    expect(postTasks).toHaveBeenCalledTimes(3);
    for (const [, tasks] of postTasks.mock.calls) {
      expect(tasks.map((t) => t.tag)).toEqual(['p1', 'p2']);
    }
    expect(rpcCalls.filter((c) => c.name === 'prompt_demand_claim')).toHaveLength(2);
  });

  it("doesn't set a prompt another sweep claimed, until the claim is older than its window", async () => {
    postTasks.mockImplementation(setAll);
    const claimedBy = (minutesAgo) => ({
      prompt_id: 'p1',
      brand_id: 'b1',
      keyword: 'ai search monitoring',
      posted_at: daysAgo(8),
      claimed_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
      tasks: null,
      gsc: null,
      level: null,
      signals: 0,
    });
    const due = [
      {
        promptId: 'p1',
        brandId: 'b1',
        keyword: 'ai search monitoring',
        locationCode: 2840,
        languageCode: 'en',
      },
    ];

    // A sweep claimed it half an hour ago and died before setting it.
    tables.prompt_demand = [claimedBy(30)];
    expect(isDue(tables.prompt_demand[0], { keyword: 'ai search monitoring' }, NOW)).toBe(false);
    expect(await postDemandTasks(due, { now: NOW })).toBe(0);
    expect(postTasks).not.toHaveBeenCalled();

    // Past the window, it's taken again.
    tables.prompt_demand = [claimedBy(CLAIM_STALE_MINUTES + 1)];
    expect(isDue(tables.prompt_demand[0], { keyword: 'ai search monitoring' }, NOW)).toBe(true);
    expect(await postDemandTasks(due, { now: NOW })).toBe(1);
    expect(postTasks).toHaveBeenCalledTimes(3);
    expect(demandRow('p1').claimed_at).toBe(AT);
  });
});

// ─── The brands' order and the night's time ─────────────────────────────────

describe("the night's brands", () => {
  beforeEach(() => {
    tables.brands = ['b1', 'b2', 'b3'].map((id) => ({
      id,
      organization_id: 'o1',
      gsc_property: `sc-domain:${id}.example`,
      is_active: true,
      is_demo: false,
    }));
    tables.prompts = [
      prompt('p1', 'b1', 'ai search monitoring tool'),
      prompt('p2', 'b2', 'ai search monitoring tool'),
      prompt('p3', 'b3', 'ai search monitoring tool'),
    ];
    tables.gsc = Object.fromEntries(
      ['b1', 'b2', 'b3'].map((id) => [
        id,
        [{ query: 'ai search monitoring tool', clicks: 1, impressions: 200 }],
      ]),
    );
    // b1 written last night, b3 two nights ago, b2 never.
    tables.prompt_demand = [
      {
        prompt_id: 'p1',
        brand_id: 'b1',
        gsc: null,
        level: null,
        signals: 0,
        updated_at: daysAgo(1),
      },
      {
        prompt_id: 'p3',
        brand_id: 'b3',
        gsc: null,
        level: null,
        signals: 0,
        updated_at: daysAgo(2),
      },
    ];
  });

  it('takes the brands never written first, then the ones written longest ago', async () => {
    expect(
      sweepOrder(
        tables.brands,
        new Map([
          ['b1', NOW - DAY],
          ['b3', NOW - 2 * DAY],
        ]),
      ).map((b) => b.id),
    ).toEqual(['b2', 'b3', 'b1']);

    const outcome = await sweepPromptDemand({ now: NOW });

    expect(gscReads()).toEqual(['b2', 'b3', 'b1']);
    expect(outcome).toMatchObject({ brands: 3, unfinished: 0 });
  });

  it('counts the brands it ran out of time for and says so; they go first the next night', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    // Matching the first brand takes the whole 20 minutes.
    onGscRead = () => {
      clock += 21 * 60_000;
    };

    const outcome = await sweepPromptDemand({ now: NOW });

    expect(gscReads()).toEqual(['b2']);
    expect(outcome).toMatchObject({ brands: 1, unfinished: 2 });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ unfinished: 2, brands: 1 }),
      '[prompt-demand] sweep ran out of time: brands left for the next night',
    );

    // The next night starts with the two left.
    clock = 0;
    rpcCalls = [];
    onGscRead = null;
    await sweepPromptDemand({ now: NOW + DAY });
    expect(gscReads()).toEqual(['b3', 'b1', 'b2']);
  });
});

// ─── Reading the tasks ──────────────────────────────────────────────────────

describe('collectDemandTasks', () => {
  const waiting = (tasks, extra = {}) => ({
    prompt_id: 'p1',
    brand_id: 'b1',
    gsc: { impressions: 4120, clicks: 96, queries: 7, top: null, at: daysAgo(1) },
    trends: null,
    paa: null,
    youtube: null,
    tasks,
    level: 'medium',
    signals: 1,
    ...extra,
  });

  it('does nothing with DEMAND_SIGNALS off', async () => {
    tables.prompt_demand = [waiting({ posted_at: daysAgo(1), trends: 't1' })];
    expect(await collectDemandTasks({ now: NOW })).toEqual({
      read: 0,
      waiting: 0,
      brands: [],
      skipped: 'off',
    });
    expect(readyTasks).not.toHaveBeenCalled();
  });

  it('reads the tasks that are done, keeps the level, and clears what was read', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    tables.prompt_demand = [
      waiting({ posted_at: daysAgo(1), trends: 't1', paa: 's1', youtube: 'y1' }),
    ];
    readyTasks.mockImplementation(async (path) =>
      path.includes('youtube')
        ? new Map()
        : new Map([
            ['t1', 'p1'],
            ['s1', 'p1'],
          ]),
    );
    const rising = Array.from({ length: 52 }, (_, i) => (i < 4 ? 25 : i >= 48 ? 41 : 30));
    getTask.mockImplementation(async (path) => {
      if (path === '/v3/keywords_data/google_trends/explore/task_get/t1') {
        return { status: 'done', result: trendsResult(rising) };
      }
      if (path === '/v3/serp/google/organic/task_get/advanced/s1') {
        return { status: 'done', result: SERP_RESULT };
      }
      throw new Error(`unexpected ${path}`);
    });

    // The level went from medium to high: the brand's actions are scored again.
    expect(await collectDemandTasks({ now: NOW })).toEqual({ read: 1, waiting: 1, brands: ['b1'] });

    const row = demandRow('p1');
    expect(row.trends).toMatchObject({ trend: 'rising', change: 64, at: AT });
    expect(row.paa.questions).toHaveLength(3);
    expect(row.youtube).toBeNull();
    // YouTube isn't done: its task waits for the next read.
    expect(row.tasks).toEqual({ posted_at: daysAgo(1), trends: null, paa: null, youtube: 'y1' });
    // Search Console 2 + Trends 2 + PAA 1 of 6: high, three signals read.
    expect(row).toMatchObject({ level: 'high', signals: 3 });
  });

  it('gives up a task not done after three days, keeping what was read before', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    const before = { videos: 3, views: 900, results: 3, top: null, at: daysAgo(9) };
    tables.prompt_demand = [
      waiting(
        { posted_at: daysAgo(TASK_EXPIRE_DAYS), trends: null, paa: null, youtube: 'y1' },
        { youtube: before },
      ),
    ];
    getTask.mockResolvedValue({ status: 'pending' });

    await collectDemandTasks({ now: NOW });

    expect(getTask).toHaveBeenCalledWith('/v3/serp/youtube/organic/task_get/advanced/y1');
    expect(demandRow('p1')).toMatchObject({ tasks: null, youtube: before });
  });

  it('reads a done search that found nothing as read, with nothing in it', async () => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    tables.prompt_demand = [
      waiting({ posted_at: daysAgo(1), trends: null, paa: 's1', youtube: null }),
    ];
    readyTasks.mockResolvedValue(new Map([['s1', 'p1']]));
    getTask.mockResolvedValue({ status: 'done', result: null });

    await collectDemandTasks({ now: NOW });

    expect(demandRow('p1')).toMatchObject({
      paa: { questions: [], at: AT },
      tasks: null,
      signals: 2,
    });
  });
});

describe("the Action Center's priority", () => {
  it("scores a brand's actions again when a level changed, once a night", async () => {
    const outcome = await sweepPromptDemand({ now: NOW });
    expect(outcome.rescored).toBe(3);
    expect(rescoreBrandActions).toHaveBeenCalledTimes(1);
    expect(rescoreBrandActions).toHaveBeenCalledWith('b1', { now: new Date(NOW) });
  });

  it('leaves them when no level changed', async () => {
    await sweepPromptDemand({ now: NOW });
    rescoreBrandActions.mockClear();
    // The same queries the next night: new numbers' dates, the same levels.
    const outcome = await sweepPromptDemand({ now: NOW + DAY });
    expect(outcome.written).toBe(2);
    expect(rescoreBrandActions).not.toHaveBeenCalled();
  });

  it('carries on when the scores cannot be saved', async () => {
    rescoreBrandActions.mockRejectedValue(new Error('timeout'));
    await expect(sweepPromptDemand({ now: NOW })).resolves.toMatchObject({ rescored: 0 });
  });
});

describe('collecting the tasks whose ids were lost', () => {
  // A prompt's id is the tag its tasks are set with.
  const P1 = '6f1c2a3b-0d4e-4f5a-9b6c-7d8e9f0a1b2c';
  const OTHER = '0a0b0c0d-1e1f-4a2b-8c3d-4e5f6a7b8c9d';

  beforeEach(() => {
    vi.stubEnv('DEMAND_SIGNALS', 'true');
    tables.prompts = [prompt(P1, 'b1', 'What is the best AI search monitoring tool?')];
  });

  it('reads a done task no row knows when its tag is one of our prompts, and nothing else', async () => {
    // Claimed and set; the request timed out, so its ids were never written.
    tables.prompt_demand = [
      {
        prompt_id: P1,
        brand_id: 'b1',
        gsc: null,
        trends: null,
        paa: null,
        youtube: null,
        tasks: null,
        posted_at: daysAgo(8),
        level: null,
        signals: 0,
      },
    ];
    readyTasks.mockImplementation(async (path) =>
      path === SOURCES.paa.path
        ? new Map([
            ['lost-paa', P1],
            // Someone else's: a prompt that isn't ours, and a tag that isn't a prompt.
            ['theirs-1', OTHER],
            ['theirs-2', 'weekly-report'],
          ])
        : new Map(),
    );
    getTask.mockResolvedValue({ status: 'done', result: SERP_RESULT });

    expect(await collectDemandTasks({ now: NOW })).toEqual({
      read: 1,
      waiting: 0,
      brands: ['b1'],
    });

    expect(getTask.mock.calls).toEqual([['/v3/serp/google/organic/task_get/advanced/lost-paa']]);
    expect(demandRow(P1)).toMatchObject({ tasks: null, signals: 1 });
    expect(demandRow(P1).paa.questions).toHaveLength(3);
  });

  it("gives a waiting row the lost task of a signal it isn't waiting for", async () => {
    tables.prompt_demand = [
      {
        prompt_id: P1,
        brand_id: 'b1',
        gsc: null,
        trends: null,
        paa: null,
        youtube: null,
        tasks: { posted_at: daysAgo(1), trends: 't1', paa: null, youtube: null },
        posted_at: daysAgo(1),
        level: null,
        signals: 0,
      },
    ];
    readyTasks.mockImplementation(async (path) =>
      path === SOURCES.paa.path ? new Map([['lost-paa', P1]]) : new Map(),
    );
    getTask.mockResolvedValue({ status: 'done', result: SERP_RESULT });

    expect(await collectDemandTasks({ now: NOW })).toEqual({
      read: 1,
      waiting: 1,
      brands: ['b1'],
    });

    expect(demandRow(P1).tasks).toEqual({
      posted_at: daysAgo(1),
      trends: 't1',
      paa: null,
      youtube: null,
    });
    expect(demandRow(P1).paa.questions).toHaveLength(3);
  });
});

describe('questionKey', () => {
  it('reads the same question written differently as one', () => {
    expect(questionKey('How do I track my brand in ChatGPT?')).toBe(
      questionKey('  how do I track  my brand in chatgpt'),
    );
    expect(questionKey('Café-crème: what is it?')).toBe('cafe creme what is it');
    expect(questionKey('What is AI search monitoring?')).not.toBe(
      questionKey('What is AI search?'),
    );
  });
});

describe('demandResponse', () => {
  it("says what the card needs about the signals that aren't there", () => {
    expect(demandResponse(null, null, { paid: false })).toEqual({
      level: null,
      signals: 0,
      updatedAt: null,
      keyword: null,
      locationCode: null,
      languageCode: null,
      gsc: null,
      trends: null,
      paa: null,
      youtube: null,
      pending: { trends: false, paa: false, youtube: false },
      hasVolume: false,
      hasKeyword: false,
      paidSignals: false,
    });
    expect(
      demandResponse(
        { level: 'high', signals: 2, tasks: { youtube: 'y1' }, updated_at: AT },
        volume('p1', { 'ai search monitoring': 1900 }),
        { paid: true },
      ),
    ).toMatchObject({
      level: 'high',
      keyword: 'ai search monitoring',
      locationCode: 2840,
      pending: { trends: false, paa: false, youtube: true },
      hasVolume: true,
      hasKeyword: true,
      paidSignals: true,
    });
  });

  it('marks the People Also Ask questions the brand already tracks', () => {
    const row = {
      level: 'medium',
      signals: 1,
      paa: { questions: paaSignal(SERP_RESULT, AT).questions, at: AT },
    };
    const keys = new Set([questionKey('how do i track my brand in chatgpt')]);
    const { paa } = demandResponse(row, null, { paid: true, trackedKeys: keys });
    expect(paa.questions.map((q) => [q.question, q.tracked])).toEqual([
      ['How do I track my brand in ChatGPT?', true],
      ['What is AI search monitoring?', false],
      ['Is there a tool to monitor AI answers?', false],
    ]);
  });
});
