// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "For you now"'s counts on Chat Home (CHAT-08 v2, CHAT-09 item 3): the
 * brand's open actions due by the week's end, the pages its open
 * lost-citation signals name, and its drafts ready to publish — read as the
 * person, once, together; none for a section an Admin took off their menu;
 * only with the new Chat on, and answered as a value, never thrown (#1777).
 * And "Since you left" (CHAT-22 §1): citations by engine since the person
 * last left Home, counted as the service role once the brand is theirs.
 */

const BRAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const db = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  profile: {} as Record<string, unknown>,
  roleHidden: [] as string[],
  /** Each statement: [table, method, ...args]. */
  calls: [] as unknown[][],
  /** A table's answer; signals by page. */
  answers: {} as Record<string, { data?: unknown; count?: number | null; error: unknown }>,
  signalPages: [] as unknown[][],
  /** A table's maybeSingle answer, before the profile and the role's hidden sections. */
  single: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  rpc: { data: null, error: null } as { data: unknown; error: { message: string } | null },
  rpcCalls: [] as unknown[][],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      let page = 0;
      for (const name of ['select', 'eq', 'in', 'lte', 'gte', 'is', 'order', 'range']) {
        chain[name] = (...args: unknown[]) => {
          db.calls.push([table, name, ...args]);
          if (name === 'range') page = (args[0] as number) / 1000;
          return chain;
        };
      }
      chain.maybeSingle = async () =>
        db.single[table] ??
        (table === 'profiles'
          ? { data: db.profile, error: null }
          : { data: { hidden_sections: db.roleHidden }, error: null });
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          table === 'signals'
            ? (db.answers.signals ?? { data: db.signalPages[page] ?? [], error: null })
            : (db.answers[table] ?? { count: 0, error: null }),
        ).then(resolve);
      return chain;
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    rpc: async (...args: unknown[]) => {
      db.rpcCalls.push(args);
      return db.rpc;
    },
  },
}));

const { readFocusFill, readHomeShortcuts, readSinceYouLeft } = await import('./chatHome');

const lost = (...urls: string[]) => ({ lostUrls: urls.map((url) => ({ url })) });
const tables = () => [...new Set(db.calls.map(([table]) => table))];

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  db.user = { id: 'user-1' };
  db.profile = {
    organization_id: 'org-1',
    role: 'manager',
    work_areas: [],
    work_areas_asked_at: null,
    menu_shown: [],
    menu_hidden: [],
    can_manage_menus: false,
  };
  db.roleHidden = [];
  db.calls = [];
  db.answers = { actions: { count: 3, error: null }, content_drafts: { count: 2, error: null } };
  db.signalPages = [
    [
      lost('https://www.acme.example/pricing/', 'https://acme.example/blog?utm=x#top'),
      // The same pages again, written other ways.
      lost('http://acme.example/Pricing', 'acme.example/blog'),
      // A signal from before its evidence names no page.
      { lostUrls: null },
    ],
  ];
  db.single = {};
  db.rpc = { data: null, error: null };
  db.rpcCalls = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('readHomeShortcuts', () => {
  it('counts the due tasks, the lost-citation pages and the ready drafts together', async () => {
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({
      ok: true,
      dueTasks: 3,
      lostPages: 2,
      readyDrafts: 2,
    });
    const of = (table: string) => db.calls.filter(([t]) => t === table).map(([, ...c]) => c);
    expect(of('actions')).toEqual([
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'brand_id', BRAND],
      ['in', 'status', ['new', 'in_progress', 'on_hold']],
      ['lte', 'due_date', '2026-11-01'],
    ]);
    // The pages only, a page of signals at a time.
    expect(of('signals')).toEqual([
      ['select', 'lostUrls:payload->lostUrls'],
      ['eq', 'brand_id', BRAND],
      ['eq', 'kind', 'lost_citations'],
      ['in', 'status', ['new', 'acknowledged']],
      ['order', 'id'],
      ['range', 0, 999],
    ]);
    expect(of('content_drafts')).toEqual([
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'brand_id', BRAND],
      ['eq', 'status', 'ready'],
      ['is', 'archived_at', null],
    ]);
  });

  it('reads the next page of signals while a page is full', async () => {
    db.signalPages = [
      Array.from({ length: 1000 }, (_, i) => lost(`https://acme.example/p${i % 10}`)),
      [lost('https://acme.example/last')],
    ];
    const result = await readHomeShortcuts(BRAND, '2026-11-01');
    expect(result).toMatchObject({ ok: true, lostPages: 11 });
    expect(db.calls.filter(([t, m]) => t === 'signals' && m === 'range')).toEqual([
      ['signals', 'range', 0, 999],
      ['signals', 'range', 1000, 1999],
    ]);
  });

  it('counts nothing for a section an Admin took off the person’s menu', async () => {
    db.profile.menu_hidden = ['content'];
    db.roleHidden = ['citations'];
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({
      ok: true,
      dueTasks: 3,
      lostPages: 0,
      readyDrafts: 0,
    });
    expect(tables()).not.toContain('content_drafts');
    expect(tables()).not.toContain('signals');
  });

  it('takes the demo brand’s id, made by hand and not an RFC 4122 one', async () => {
    const demo = '33333333-3333-3333-3333-333333333333';
    expect(await readHomeShortcuts(demo, '2026-11-01')).toMatchObject({ ok: true });
  });

  it('reads nothing for a bad brand or date, signed out or with the new Chat off', async () => {
    expect(await readHomeShortcuts('nope', '2026-11-01')).toEqual({ ok: false });
    expect(await readHomeShortcuts(BRAND, 'Sunday')).toEqual({ ok: false });
    db.user = null;
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({ ok: false });
    db.user = { id: 'user-1' };
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({ ok: false });
    expect(tables()).toEqual(['profiles']);
  });

  it('answers a failed read as a value', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.answers.content_drafts = { count: null, error: { message: 'nope' } };
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({ ok: false });
    db.answers.content_drafts = { count: 2, error: null };
    db.answers.signals = { data: null, error: { message: 'nope' } };
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({ ok: false });
    logged.mockRestore();
  });
});

describe('readSinceYouLeft', () => {
  const SEEN = '2026-10-19T15:20:00.000Z';
  const cell = (engine: string, period: 'a' | 'b', answers: number, cited: number) => ({
    prompt_id: 'p1',
    platform: engine,
    model_used: engine,
    region: null,
    period,
    runs: 7,
    answers,
    citation_answers: cited,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T09:00:00Z'));
    db.single = {
      chat_user_prefs: { data: { home_seen_at: SEEN }, error: null },
      brands: { data: { id: BRAND }, error: null },
    };
    db.rpc = {
      data: {
        cells: [
          cell('google-aio', 'a', 200, 60),
          cell('google-aio', 'b', 200, 40),
          cell('chatgpt-web', 'a', 200, 30),
          cell('chatgpt-web', 'b', 200, 50),
          // ChatGPT Shopping is left out, as Why leaves it.
          cell('chatgpt-shopping', 'a', 200, 0),
          cell('chatgpt-shopping', 'b', 200, 100),
        ],
      },
      error: null,
    };
  });

  it('gives the biggest drop and one win since the person last left Home', async () => {
    expect(await readSinceYouLeft(BRAND)).toEqual({
      ok: true,
      since: {
        from: '2026-10-19',
        seenAt: SEEN,
        drop: { engine: 'google-aio', before: 60, now: 40 },
        win: { engine: 'chatgpt-web', before: 30, now: 50 },
      },
    });
    expect(db.calls).toContainEqual(['brands', 'eq', 'organization_id', 'org-1']);
    expect(db.rpcCalls).toEqual([
      [
        'chat_why_cells',
        {
          p_brand_id: BRAND,
          p_a_from: '2026-10-07',
          p_a_to: '2026-10-18',
          p_b_from: '2026-10-19',
          p_b_to: '2026-10-30',
          p_series_from: '2026-10-30',
        },
      ],
    ]);
  });

  it('has nothing before the first leave, the same day, or without a move', async () => {
    db.single.chat_user_prefs = { data: { home_seen_at: null }, error: null };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: true, since: null });
    db.single.chat_user_prefs = { data: { home_seen_at: '2026-10-31T07:00:00Z' }, error: null };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: true, since: null });
    expect(db.rpcCalls).toEqual([]);
    db.single.chat_user_prefs = { data: { home_seen_at: SEEN }, error: null };
    db.rpc = { data: { cells: [] }, error: null };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: true, since: null });
  });

  it('counts nothing for a brand outside the workspace, a bad id, or with the new Chat off', async () => {
    db.single.brands = { data: null, error: null };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: false });
    expect(await readSinceYouLeft('nope')).toEqual({ ok: false });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: false });
    expect(db.rpcCalls).toEqual([]);
  });

  it('answers a failed read as a value', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.rpc = { data: null, error: { message: 'nope' } };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: false });
    db.single.chat_user_prefs = { data: null, error: { message: 'nope' } };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: false });
    logged.mockRestore();
  });
});

describe('readFocusFill (CHAT-24 §4)', () => {
  const day = (
    competitor_id: string,
    d: string,
    answer_count: number,
    mention_answers: number,
  ) => ({
    competitor_id,
    day: d,
    answer_count,
    mention_answers,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    db.answers = {
      insights_competitor_daily: {
        data: [
          // Kestrel: 20% the week before, 30% this week (from Oct 25).
          day('c1', '2026-10-20', 50, 10),
          day('c1', '2026-10-29', 50, 15),
          // Lumora: mentioned most, but its rate fell.
          day('c2', '2026-10-20', 50, 30),
          day('c2', '2026-10-29', 50, 28),
          // Too few answers this week to count a move.
          day('c3', '2026-10-20', 50, 1),
          day('c3', '2026-10-29', 4, 4),
          // Not one of the brand's competitors.
          day('gone', '2026-10-29', 50, 50),
        ],
        error: null,
      },
      competitors: {
        data: [
          { id: 'c1', name: 'Kestrel CRM' },
          { id: 'c2', name: 'Lumora' },
          { id: 'c3', name: 'Corvio' },
        ],
        error: null,
      },
      prompts: {
        data: [
          { topic_id: 't1', regions: ['US'] },
          { topic_id: 't1', regions: ['US', 'DE'] },
          { topic_id: 't2', regions: ['US-CA'] },
          { topic_id: 't3', regions: [] },
          { topic_id: 't3', regions: [] },
          { topic_id: 't3', regions: [] },
        ],
        error: null,
      },
      topics: {
        data: [
          { id: 't1', name: 'Integrations', is_active: true },
          { id: 't2', name: 'Pricing', is_active: null },
          { id: 't3', name: 'Old', is_active: false },
        ],
        error: null,
      },
    };
  });

  it('fills the questions with the most mentioned competitor, the busiest topic and a second country', async () => {
    expect(await readFocusFill(BRAND, ['comp', 'pd', 'bd'])).toEqual({
      ok: true,
      fill: { rival: 'Lumora', topic: 'Integrations', market: 'Germany' },
      rivalMove: { name: 'Kestrel CRM', points: 10 },
    });
    const gte = db.calls.find(
      ([table, name]) => table === 'insights_competitor_daily' && name === 'gte',
    );
    expect(gte).toEqual(['insights_competitor_daily', 'gte', 'day', '2026-10-18']);
  });

  it('reads only what the picked areas use', async () => {
    expect(await readFocusFill(BRAND, ['lead', 'growth'])).toEqual({
      ok: true,
      fill: { rival: null, topic: null, market: null },
      rivalMove: null,
    });
    expect(tables()).toEqual(['profiles']);
    // Prompts and citations names a competitor, but has no line to say a move with.
    expect(await readFocusFill(BRAND, ['seo'])).toMatchObject({
      fill: { rival: 'Lumora', topic: null, market: null },
      rivalMove: null,
    });
  });

  it('leaves the market unknown with one country tracked', async () => {
    db.answers.prompts = { data: [{ topic_id: 't2', regions: ['US', 'US-NY'] }], error: null };
    expect(await readFocusFill(BRAND, ['bd', 'content'])).toMatchObject({
      fill: { topic: 'Pricing', market: null },
    });
  });

  it('answers a bad request, the new Chat off or a failed read as a value', async () => {
    expect(await readFocusFill('nope', ['comp'])).toEqual({ ok: false });
    expect(await readFocusFill(BRAND, ['devtools'])).toEqual({ ok: false });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await readFocusFill(BRAND, ['comp'])).toEqual({ ok: false });
    vi.stubEnv('CHAT_AGENTIC', 'true');
    db.answers.competitors = { data: null, error: { message: 'down' } };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await readFocusFill(BRAND, ['comp'])).toEqual({ ok: false });
    errorLog.mockRestore();
  });
});
