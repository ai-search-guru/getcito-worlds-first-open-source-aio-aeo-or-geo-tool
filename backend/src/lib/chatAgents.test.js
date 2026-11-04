import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chat's agents' background work on the server (W2-16): the minute tick
 * calls the web's internal endpoint with CHAT_INTERNAL_SECRET, one at a
 * time, only with the new Chat on and the secret set; the signal hook tells
 * the web which new signals feed which definitions, only for a workspace
 * with the new Chat, and never fails the signal pass.
 */

const BRAND = '22222222-2222-4222-8222-222222222222';
const ORG = '11111111-1111-4111-8111-111111111111';

let tables;
let fetchCalls;
let fetchAnswer;

function query(table) {
  const filters = [];
  const builder = {
    select: () => builder,
    eq: (col, val) => (filters.push([col, val]), builder),
    limit: () => builder,
    maybeSingle: async () => {
      if (tables.fail) return { data: null, error: { message: 'db down' } };
      const rows = (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      return { data: rows[0] ?? null, error: null };
    },
    then: (resolve, reject) =>
      Promise.resolve({
        data: (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v)),
        error: null,
      }).then(resolve, reject),
  };
  return builder;
}

const DEFINITIONS = [
  {
    id: 'recover_lost_citations',
    category: 'recover',
    enabled: true,
    signalKinds: ['lost_citation'],
  },
  {
    id: 'protect_valuable_citations',
    category: 'protect',
    enabled: true,
    signalKinds: ['lost_citation'],
  },
  { id: 'fix_content_gaps', category: 'fix', enabled: false, signalKinds: ['content_gap'] },
];

let agents;

/** What fetch answers, as the code reads it (no Response class: CI's Node and lint). */
const answer = (status, body = {}) => ({ status, json: async () => body });

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.stubEnv('CHAT_INTERNAL_SECRET', 'shh');
  vi.stubEnv('PUBLIC_APP_URL', 'https://app.example.com/some/path');
  tables = {
    brands: [{ id: BRAND, organization_id: ORG }],
    signals: [],
  };
  fetchCalls = [];
  fetchAnswer = () => answer(200, { ok: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      fetchCalls.push({ url, init, body: JSON.parse(init.body) });
      return fetchAnswer();
    }),
  );
  vi.doMock('../config/supabase.js', () => ({ default: { from: (t) => query(t) } }));
  vi.doMock('./logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
  vi.doMock('./action-center/definitions/index.js', () => ({
    loadDefinitions: async () => DEFINITIONS,
  }));
  agents = await import('./chatAgents.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock('../config/supabase.js');
  vi.doUnmock('./logger.js');
  vi.doUnmock('./action-center/definitions/index.js');
});

describe('the minute tick', () => {
  it('calls the web’s tick endpoint at the app’s origin, with the secret', async () => {
    expect(await agents.tickChatAgents()).toEqual({ status: 200, body: { ok: true } });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://app.example.com/api/internal/chat/agents/tick');
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(fetchCalls[0].init.headers.Authorization).toBe('Bearer shh');
    // A time limit: an abort signal, read by its shape.
    expect(typeof fetchCalls[0].init.signal?.aborted).toBe('boolean');
  });

  it('calls the scheduled jobs’ tick endpoint with the secret (CHAT-12)', async () => {
    expect(await agents.tickChatSchedules()).toEqual({ status: 200, body: { ok: true } });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://app.example.com/api/internal/chat/schedules/tick');
    expect(fetchCalls[0].init.headers.Authorization).toBe('Bearer shh');
    expect(fetchCalls[0].body).toEqual({});
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await agents.tickChatSchedules()).toBeNull();
    expect(fetchCalls).toHaveLength(1);
  });

  it('sends nothing with the new Chat off or without the secret', async () => {
    vi.stubEnv('CHAT_INTERNAL_SECRET', '');
    expect(await agents.tickChatAgents()).toBeNull();
    vi.stubEnv('CHAT_INTERNAL_SECRET', 'shh');
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await agents.tickChatAgents()).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  it('never throws when the web doesn’t answer', async () => {
    fetchAnswer = () => {
      throw new TypeError('fetch failed');
    };
    expect(await agents.tickChatAgents()).toBeNull();
  });

  it('starts every minute with the new Chat on and the secret set, one tick at a time', async () => {
    const schedule = vi.fn(() => ({ stop: vi.fn() }));
    expect(agents.startChatAgentTicks(schedule)).not.toBeNull();
    expect(schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));

    // A slow tick: the next minute's call is skipped over, not stacked.
    let finish;
    fetchAnswer = () =>
      new Promise((resolve) => {
        finish = () => resolve(answer(200));
      });
    const job = schedule.mock.calls[0][1];
    const first = job();
    await job();
    await vi.waitFor(() => expect(fetchCalls).toHaveLength(1));
    fetchAnswer = () => answer(200);
    finish();
    await first;
    // The agents' tick, then the scheduled jobs' in the same minute.
    expect(fetchCalls.map((c) => c.url)).toEqual([
      'https://app.example.com/api/internal/chat/agents/tick',
      'https://app.example.com/api/internal/chat/schedules/tick',
    ]);
    await job();
    expect(fetchCalls).toHaveLength(4);
  });

  it('runs the scheduled jobs’ tick even when the agents’ tick fails or gets no answer', async () => {
    const schedule = vi.fn(() => ({ stop: vi.fn() }));
    agents.startChatAgentTicks(schedule);
    const job = schedule.mock.calls[0][1];
    let calls = 0;
    fetchAnswer = () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return answer(200, { ok: true });
    };
    await job();
    expect(fetchCalls.map((c) => c.url)).toEqual([
      'https://app.example.com/api/internal/chat/agents/tick',
      'https://app.example.com/api/internal/chat/schedules/tick',
    ]);
    fetchAnswer = () => answer(500, { ok: false });
    await job();
    expect(fetchCalls).toHaveLength(4);
  });

  it('doesn’t start with the new Chat off or without the secret', () => {
    const schedule = vi.fn();
    vi.stubEnv('CHAT_INTERNAL_SECRET', '');
    expect(agents.startChatAgentTicks(schedule)).toBeNull();
    vi.stubEnv('CHAT_INTERNAL_SECRET', 'shh');
    vi.stubEnv('CHAT_AGENTIC', '');
    expect(agents.startChatAgentTicks(schedule)).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe('new signals for Signal triggers', () => {
  it('describes a signal by the enabled definitions it feeds and the pages and engines it names', () => {
    expect(
      agents.describeSignal(
        {
          id: 's1',
          kind: 'lost_citation',
          payload: {
            url: 'https://example.com/pricing',
            urls: [{ url: 'https://example.com/a' }, 'https://example.com/b'],
            platform: 'chatgpt',
            platforms: ['perplexity', { id: 'gemini' }],
          },
        },
        DEFINITIONS,
      ),
    ).toEqual({
      id: 's1',
      kind: 'lost_citation',
      definitions: [
        { id: 'recover_lost_citations', category: 'recover' },
        { id: 'protect_valuable_citations', category: 'protect' },
      ],
      urls: ['https://example.com/pricing', 'https://example.com/a', 'https://example.com/b'],
      engines: ['chatgpt', 'perplexity', 'gemini'],
    });
    // A library signal names its targets by its entity.
    expect(
      agents.describeSignal(
        {
          id: 's2',
          kind: 'content_gap',
          payload: { targetEntity: 'pages', targets: [{ id: '/blog', label: '/blog' }] },
        },
        DEFINITIONS,
      ),
    ).toMatchObject({ definitions: [], urls: ['/blog'], engines: [] });
  });

  it('sends the brand’s signals of this pass that feed a definition', async () => {
    const AT = '2026-11-02T03:00:00.000Z';
    tables.signals = [
      { id: 's1', brand_id: BRAND, detected_at: AT, kind: 'lost_citation', payload: {} },
      { id: 's2', brand_id: BRAND, detected_at: AT, kind: 'content_gap', payload: {} },
      { id: 's3', brand_id: BRAND, detected_at: '2026-11-01T03:00:00.000Z', kind: 'lost_citation' },
    ];
    await agents.notifyChatAgentsOfSignals(BRAND, AT);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://app.example.com/api/internal/chat/agents/signals');
    expect(fetchCalls[0].body).toEqual({
      brandId: BRAND,
      signals: [expect.objectContaining({ id: 's1', kind: 'lost_citation' })],
    });
  });

  it('sends nothing for a workspace without the new Chat, or with nothing to send', async () => {
    tables.signals = [
      { id: 's1', brand_id: BRAND, detected_at: 'x', kind: 'lost_citation', payload: {} },
    ];
    vi.stubEnv('CHAT_AGENTIC_ORGS', '99999999-9999-4999-8999-999999999999');
    expect(await agents.notifyChatAgentsOfSignals(BRAND, 'x')).toBeNull();
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    expect(await agents.notifyChatAgentsOfSignals(BRAND, 'y')).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  it('never throws: a failed read or a web that is down only logs', async () => {
    tables.fail = true;
    await expect(agents.notifyChatAgentsOfSignals(BRAND, 'x')).resolves.toBeNull();
    tables.fail = false;
    tables.signals = [
      { id: 's1', brand_id: BRAND, detected_at: 'x', kind: 'lost_citation', payload: {} },
    ];
    fetchAnswer = () => answer(500);
    expect(await agents.notifyChatAgentsOfSignals(BRAND, 'x')).toMatchObject({ status: 500 });
  });
});
