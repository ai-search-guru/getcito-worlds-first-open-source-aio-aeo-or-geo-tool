import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  buildRequestBody,
  parseScraperResponse,
  pollScraperResult,
  submitPromptTask,
} from './cloroScraper.js';

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('./logger.js', () => ({ default: log, logger: log }));

describe('cloro-scraper – parseScraperResponse', () => {
  describe('chatgpt-shopping', () => {
    it('should parse text, citations, model, shopping_cards and inline_products', () => {
      const result = {
        markdown: 'Hello shopping world',
        model: 'gpt-5-3-mini',
        sources: [
          { url: 'https://a.com', label: 'A' },
          { url: 'https://b.com', label: 'B' },
        ],
        shoppingCards: [{ id: 'card1' }],
        inlineProducts: [{ id: 'prod1' }],
      };

      const parsed = parseScraperResponse(result, 'chatgpt-shopping');

      expect(parsed.text).toBe('Hello shopping world');
      expect(parsed.citations).toEqual([
        { url: 'https://a.com', title: 'A', startIndex: 0, endIndex: 50 },
        { url: 'https://b.com', title: 'B', startIndex: 100, endIndex: 150 },
      ]);
      expect(parsed.model).toBe('gpt-5-3-mini');
      expect(parsed.shopping_cards).toEqual([{ id: 'card1' }]);
      expect(parsed.inline_products).toEqual([{ id: 'prod1' }]);
    });

    it('should fall back to text when markdown is missing', () => {
      const result = { text: 'fallback text', sources: [] };
      const parsed = parseScraperResponse(result, 'chatgpt-shopping');
      expect(parsed.text).toBe('fallback text');
    });

    it('should default model to gpt-5-3-mini when missing', () => {
      const result = { markdown: 'hi', sources: [] };
      const parsed = parseScraperResponse(result, 'chatgpt-shopping');
      expect(parsed.model).toBe('gpt-5-3-mini');
    });

    it('should default shopping_cards and inline_products to empty arrays', () => {
      const result = { markdown: 'hi', sources: [] };
      const parsed = parseScraperResponse(result, 'chatgpt-shopping');
      expect(parsed.shopping_cards).toEqual([]);
      expect(parsed.inline_products).toEqual([]);
    });

    it('adds the listings ChatGPT attaches to entities to inline_products (#1183)', () => {
      const listing = {
        id: '23920641',
        title: 'Trail Runner 2',
        url: 'https://merchant.example/p/2?utm_source=chatgpt.com',
        price: '$75.00',
        merchants: 'Merchant',
      };
      const result = {
        markdown: 'hi',
        sources: [],
        shoppingCards: [],
        inlineProducts: [{ product: { id: 'prod1' }, render_as: 'inline' }],
        entities: [
          { type: 'product', name: 'Trail Runner 1' },
          { type: 'product', name: 'Trail Runner 2', product: listing },
          { type: 'software', name: 'Tracker', product: null },
        ],
      };

      const parsed = parseScraperResponse(result, 'chatgpt-shopping');

      expect(parsed.inline_products).toEqual([
        { product: { id: 'prod1' }, render_as: 'inline' },
        { product: listing, entity: 'Trail Runner 2' },
      ]);
    });
  });

  describe('google-aio', () => {
    it('should parse aioverview text and citations', () => {
      const result = {
        aioverview: {
          markdown: 'AI overview text',
          sources: [{ url: 'https://x.com', label: 'X' }],
        },
      };

      const parsed = parseScraperResponse(result, 'google-aio');

      expect(parsed.text).toBe('AI overview text');
      expect(parsed.citations).toEqual([
        { url: 'https://x.com', title: 'X', startIndex: 0, endIndex: 50 },
      ]);
      expect(parsed.model).toBe('google-aio');
      expect(parsed.shopping_cards).toEqual([]);
    });

    it('should fall back to text inside aioverview when markdown is missing', () => {
      const result = {
        aioverview: {
          text: 'fallback aio text',
          sources: [],
        },
      };

      const parsed = parseScraperResponse(result, 'google-aio');
      expect(parsed.text).toBe('fallback aio text');
    });

    it('should throw when aioverview is missing', () => {
      const result = { markdown: 'no aioverview here', sources: [] };
      expect(() => parseScraperResponse(result, 'google-aio')).toThrow(
        'Google did not return an AI Overview for this query',
      );
    });
  });

  describe('google-aimode', () => {
    it('should use result.result when present', () => {
      const inner = {
        markdown: 'ai mode text',
        sources: [{ url: 'https://y.com', label: 'Y' }],
        shoppingCards: [{ sku: 'abc' }],
      };

      const parsed = parseScraperResponse({ result: inner }, 'google-aimode');

      expect(parsed.text).toBe('ai mode text');
      expect(parsed.citations).toEqual([
        { url: 'https://y.com', title: 'Y', startIndex: 0, endIndex: 50 },
      ]);
      expect(parsed.model).toBe('google-aimode');
      expect(parsed.shopping_cards).toEqual([{ sku: 'abc' }]);
    });

    it('should fall back to root result when result.result is absent', () => {
      const result = {
        markdown: 'root aimode text',
        sources: [{ url: 'https://z.com', label: 'Z' }],
        shoppingCards: [],
      };

      const parsed = parseScraperResponse(result, 'google-aimode');
      expect(parsed.text).toBe('root aimode text');
      expect(parsed.citations).toEqual([
        { url: 'https://z.com', title: 'Z', startIndex: 0, endIndex: 50 },
      ]);
      expect(parsed.shopping_cards).toEqual([]);
    });

    it('should normalize missing sources to empty array', () => {
      const result = { result: { markdown: 'no sources', shoppingCards: [] } };
      const parsed = parseScraperResponse(result, 'google-aimode');
      expect(parsed.citations).toEqual([]);
    });
  });

  describe('default / other providers', () => {
    it('should parse text, citations and model', () => {
      const result = {
        markdown: 'generic text',
        model: 'gpt-4',
        sources: [
          { url: 'https://foo.com', label: 'Foo' },
          { url: 'https://bar.com', label: 'Bar' },
        ],
        shopping_cards: [{ id: 's1' }],
      };

      const parsed = parseScraperResponse(result, 'perplexity-web');

      expect(parsed.text).toBe('generic text');
      expect(parsed.citations).toEqual([
        { url: 'https://foo.com', title: 'Foo', startIndex: 0, endIndex: 50 },
        { url: 'https://bar.com', title: 'Bar', startIndex: 100, endIndex: 150 },
      ]);
      expect(parsed.model).toBe('gpt-4');
      expect(parsed.shopping_cards).toEqual([{ id: 's1' }]);
    });

    it('should fall back to text when markdown is missing', () => {
      const parsed = parseScraperResponse({ text: 'text only', sources: [] }, 'copilot-web');
      expect(parsed.text).toBe('text only');
    });

    it('should fall back to scraperId as model when model is missing', () => {
      const parsed = parseScraperResponse({ markdown: 'no model', sources: [] }, 'grok-web');
      expect(parsed.model).toBe('grok-web');
    });

    it('should normalize missing sources to empty citations', () => {
      const parsed = parseScraperResponse({ markdown: 'no sources', model: 'x' }, 'gemini-web');
      expect(parsed.citations).toEqual([]);
    });

    it('should default shopping_cards to empty array when neither key is present', () => {
      const parsed = parseScraperResponse({ markdown: 'no cards', sources: [] }, 'gemini-web');
      expect(parsed.shopping_cards).toEqual([]);
    });
  });

  describe('ChatGPT footnote sources (#1119)', () => {
    // Since 2026-10-09 ChatGPT lists the pages it read without citing them,
    // marked footnote: true, after the cited ones.
    const sources = [
      { url: 'https://cited.com/a', label: 'Cited A', position: 1, footnote: false },
      { url: 'https://cited.com/b', label: 'Cited B', position: 2, footnote: false },
      { url: 'https://read.com/c', label: 'Read only', position: 3, footnote: true },
    ];

    it('stores only the sources the answer cites', () => {
      const parsed = parseScraperResponse({ markdown: 't', sources }, 'chatgpt-web');
      expect(parsed.citations).toEqual([
        { url: 'https://cited.com/a', title: 'Cited A', startIndex: 0, endIndex: 50 },
        { url: 'https://cited.com/b', title: 'Cited B', startIndex: 100, endIndex: 150 },
      ]);
    });

    it('does the same on ChatGPT Shopping', () => {
      const parsed = parseScraperResponse({ markdown: 't', sources }, 'chatgpt-shopping');
      expect(parsed.citations.map((c) => c.url)).toEqual([
        'https://cited.com/a',
        'https://cited.com/b',
      ]);
    });

    it('keeps sources without the flag', () => {
      const parsed = parseScraperResponse(
        { markdown: 't', sources: [{ url: 'https://foo.com', label: 'Foo' }] },
        'copilot-web',
      );
      expect(parsed.citations).toHaveLength(1);
    });
  });

  describe('ChatGPT entity markup', () => {
    const markdown =
      'Top tools: **<Entity category="software" value="Tesseract" disambig="Adlift AI search optimization platform"/>** and <Entity category="software" value="GetCito" />.';

    it('stores the names instead of the entity tags', () => {
      const parsed = parseScraperResponse({ markdown, sources: [] }, 'chatgpt-web');
      expect(parsed.text).toBe('Top tools: **Tesseract** and GetCito.');
    });

    it('cleans the shopping answer too', () => {
      const parsed = parseScraperResponse({ markdown, sources: [] }, 'chatgpt-shopping');
      expect(parsed.text).toBe('Top tools: **Tesseract** and GetCito.');
    });
  });

  describe('search_queries (observed query fan-out, #332)', () => {
    it('maps Copilot string[] searchQueries to rich items tagged with the source platform', () => {
      const result = {
        markdown: 'text',
        sources: [],
        searchQueries: ['best running shoes 2026', 'running shoes flat feet'],
      };
      const parsed = parseScraperResponse(result, 'copilot-web');
      expect(parsed.search_queries).toEqual([
        { query: 'best running shoes 2026', source_platform: 'copilot-web' },
        { query: 'running shoes flat feet', source_platform: 'copilot-web' },
      ]);
    });

    it('maps the plain-string Perplexity search_model_queries shape (Cloro 2026-07)', () => {
      const result = {
        markdown: 'text',
        sources: [],
        search_model_queries: ['best laptops 2026', '  laptop reviews  ', '', '   ', 42, null],
      };
      const parsed = parseScraperResponse(result, 'perplexity-web');
      expect(parsed.search_queries).toEqual([
        { query: 'best laptops 2026', source_platform: 'perplexity-web' },
        { query: 'laptop reviews', source_platform: 'perplexity-web' },
      ]);
    });

    it('preserves the per-item engine label from Perplexity search_model_queries', () => {
      const result = {
        markdown: 'text',
        sources: [],
        search_model_queries: [
          { query: 'best laptops 2026', engine: 'web', limit: 10 },
          { query: 'laptop reviews', engine: 'web' },
        ],
      };
      const parsed = parseScraperResponse(result, 'perplexity-web');
      expect(parsed.search_queries).toEqual([
        { query: 'best laptops 2026', engine: 'web', source_platform: 'perplexity-web' },
        { query: 'laptop reviews', engine: 'web', source_platform: 'perplexity-web' },
      ]);
    });

    it('drops blank / non-string fan-out entries', () => {
      const result = {
        markdown: 'text',
        sources: [],
        searchQueries: ['ok query', '   ', '', 42, null],
      };
      const parsed = parseScraperResponse(result, 'copilot-web');
      expect(parsed.search_queries).toEqual([
        { query: 'ok query', source_platform: 'copilot-web' },
      ]);
    });

    it('reads searches an engine joined by semicolons as each search, with its engine', () => {
      const gemini = parseScraperResponse(
        {
          markdown: 't',
          sources: [],
          searchQueries: ['ChatGPT subscription;Gemini subscription; Google AIO subscription;'],
        },
        'gemini-web',
      );
      expect(gemini.search_queries).toEqual([
        { query: 'ChatGPT subscription', source_platform: 'gemini-web' },
        { query: 'Gemini subscription', source_platform: 'gemini-web' },
        { query: 'Google AIO subscription', source_platform: 'gemini-web' },
      ]);
      const perplexity = parseScraperResponse(
        {
          markdown: 't',
          sources: [],
          search_model_queries: [{ query: 'a; b', engine: 'web' }],
        },
        'perplexity-web',
      );
      expect(perplexity.search_queries).toEqual([
        { query: 'a', engine: 'web', source_platform: 'perplexity-web' },
        { query: 'b', engine: 'web', source_platform: 'perplexity-web' },
      ]);
    });

    it("never splits at an HTML entity's semicolon, and reads 'one;' as 'one', as the editor does", () => {
      const read = (searchQueries) =>
        parseScraperResponse(
          { markdown: 't', sources: [], searchQueries },
          'copilot-web',
        ).search_queries.map((item) => item.query);
      expect(read(['what&#39;s new in aeo'])).toEqual(['what&#39;s new in aeo']);
      expect(read(['r&amp;d budget;aeo tools;what&#x27;s aeo'])).toEqual([
        'r&amp;d budget',
        'aeo tools',
        'what&#x27;s aeo',
      ]);
      // The same as fanoutQueries('one;') in frontend/src/lib/content/sources.ts.
      expect(read(['one;'])).toEqual(['one']);
      expect(read([' ; '])).toEqual([]);
    });

    it('trims surrounding whitespace so a sub-query has one canonical form', () => {
      const copilot = parseScraperResponse(
        { markdown: 't', sources: [], searchQueries: ['  spaced query  '] },
        'copilot-web',
      );
      expect(copilot.search_queries).toEqual([
        { query: 'spaced query', source_platform: 'copilot-web' },
      ]);

      const perplexity = parseScraperResponse(
        {
          markdown: 't',
          sources: [],
          search_model_queries: [{ query: '  spaced  ', engine: '  web  ' }],
        },
        'perplexity-web',
      );
      expect(perplexity.search_queries).toEqual([
        { query: 'spaced', engine: 'web', source_platform: 'perplexity-web' },
      ]);
    });

    it('omits a non-string / empty Perplexity engine label', () => {
      const parsed = parseScraperResponse(
        {
          markdown: 't',
          sources: [],
          search_model_queries: [
            { query: 'no engine', engine: 42 },
            { query: 'blank engine', engine: '   ' },
          ],
        },
        'perplexity-web',
      );
      expect(parsed.search_queries).toEqual([
        { query: 'no engine', source_platform: 'perplexity-web' },
        { query: 'blank engine', source_platform: 'perplexity-web' },
      ]);
    });

    it('reads { query } objects in searchQueries too, so a shape change cannot empty it', () => {
      const parsed = parseScraperResponse(
        {
          markdown: 't',
          sources: [],
          searchQueries: [{ query: ' chatgpt query ' }, { query: '' }, { text: 'no query key' }],
        },
        'chatgpt-web',
      );
      expect(parsed.search_queries).toEqual([
        { query: 'chatgpt query', source_platform: 'chatgpt-web' },
      ]);
    });

    it("adds ChatGPT's map searches, labelled as maps", () => {
      const parsed = parseScraperResponse(
        {
          markdown: 't',
          sources: [],
          searchQueries: ['coffee subscription'],
          mapSearchQueries: ['coffee shops near me'],
        },
        'chatgpt-web',
      );
      expect(parsed.search_queries).toEqual([
        { query: 'coffee subscription', source_platform: 'chatgpt-web' },
        { query: 'coffee shops near me', engine: 'maps', source_platform: 'chatgpt-web' },
      ]);
    });

    it('does not let an empty search_model_queries hide a populated searchQueries', () => {
      const parsed = parseScraperResponse(
        { markdown: 't', sources: [], search_model_queries: [], searchQueries: ['kept'] },
        'copilot-web',
      );
      expect(parsed.search_queries).toEqual([{ query: 'kept', source_platform: 'copilot-web' }]);
    });

    it('defaults to an empty array when the engine returns none', () => {
      expect(
        parseScraperResponse({ markdown: 't', sources: [], searchQueries: [] }, 'chatgpt-web')
          .search_queries,
      ).toEqual([]);
      expect(
        parseScraperResponse({ markdown: 't', sources: [] }, 'gemini-web').search_queries,
      ).toEqual([]);
    });
  });
});

describe('cloro-scraper – buildRequestBody query fan-out (#332, #1119)', () => {
  it('asks Copilot, Perplexity, Gemini and Grok for their searches', () => {
    for (const scraperId of ['copilot-web', 'perplexity-web', 'gemini-web', 'grok-web']) {
      expect(buildRequestBody('p', scraperId, 'US').include.searchQueries).toBe(true);
    }
  });

  it("doesn't ask ChatGPT, whose default interface no longer carries them", () => {
    expect(buildRequestBody('p', 'chatgpt-web', 'US').include).not.toHaveProperty('searchQueries');
  });
});

describe('cloro-scraper – buildRequestBody ChatGPT legacy fan-out (CLORO_CHATGPT_FANOUT)', () => {
  const today = {
    prompt: 'p',
    country: 'US',
    state: 'CA',
    include: { html: false, markdown: true, rawResponse: false },
  };

  it("leaves ChatGPT's task as it is today without legacy", () => {
    expect(buildRequestBody('p', 'chatgpt-web', 'US', 'CA')).toEqual(today);
    expect(buildRequestBody('p', 'chatgpt-web', 'US', 'CA', undefined, {})).toEqual(today);
    expect(buildRequestBody('p', 'chatgpt-web', 'US', 'CA', undefined, { legacy: false })).toEqual(
      today,
    );
  });

  it('asks the legacy interface for the searches when legacy is on', () => {
    expect(buildRequestBody('p', 'chatgpt-web', 'US', 'CA', undefined, { legacy: true })).toEqual({
      ...today,
      legacy: true,
      include: { ...today.include, searchQueries: true },
    });
  });

  it('changes nothing on Google, ChatGPT Shopping or the other engines', () => {
    const location = 'Istanbul,Istanbul,Turkiye';
    for (const scraperId of [
      'google-aio',
      'google-aimode',
      'chatgpt-shopping',
      'copilot-web',
      'perplexity-web',
      'gemini-web',
      'grok-web',
    ]) {
      expect(buildRequestBody('p', scraperId, 'US', 'CA', location, { legacy: true })).toEqual(
        buildRequestBody('p', scraperId, 'US', 'CA', location),
      );
    }
  });
});

describe('cloro-scraper – a legacy ChatGPT answer', () => {
  it('stores its searches under ChatGPT, and its model', () => {
    const parsed = parseScraperResponse(
      {
        markdown: 'answer',
        model: 'gpt-6',
        sources: [{ url: 'https://a.com', label: 'A' }],
        searchQueries: ['best crm for startups 2026'],
        mapSearchQueries: [],
      },
      'chatgpt-web',
    );
    expect(parsed.search_queries).toEqual([
      { query: 'best crm for startups 2026', source_platform: 'chatgpt-web' },
    ]);
    expect(parsed.model).toBe('gpt-6');
  });
});

describe('cloro-scraper – buildRequestBody state targeting (#554)', () => {
  const AI_ENDPOINTS = ['chatgpt-web', 'copilot-web', 'grok-web', 'perplexity-web', 'gemini-web'];

  it('includes state on AI-endpoint tasks for US brands', () => {
    for (const scraperId of AI_ENDPOINTS) {
      expect(buildRequestBody('p', scraperId, 'US', 'CA').state).toBe('CA');
    }
  });

  it('includes state on chatgpt-shopping (same CHATGPT task)', () => {
    expect(buildRequestBody('p', 'chatgpt-shopping', 'US', 'TX').state).toBe('TX');
  });

  it('never includes state on Google AIO / AI Mode payloads', () => {
    expect(buildRequestBody('p', 'google-aio', 'US', 'CA')).not.toHaveProperty('state');
    expect(buildRequestBody('p', 'google-aimode', 'US', 'CA')).not.toHaveProperty('state');
  });

  it('drops state when the task country is not US', () => {
    expect(buildRequestBody('p', 'chatgpt-web', 'DE', 'CA')).not.toHaveProperty('state');
  });

  it('omits the key entirely when the brand has no state', () => {
    expect(buildRequestBody('p', 'chatgpt-web', 'US', null)).not.toHaveProperty('state');
    expect(buildRequestBody('p', 'chatgpt-web', 'US', undefined)).not.toHaveProperty('state');
  });

  it('defaults the country to US so a stateful brand with a null prompt region still targets', () => {
    expect(buildRequestBody('p', 'chatgpt-web', null, 'NY').state).toBe('NY');
  });
});

describe('cloro-scraper – buildRequestBody city targeting (PROMPT-015d)', () => {
  it("sends a city's Google name to the Google engines, beside the country", () => {
    const location = 'Istanbul,Istanbul,Turkiye';
    expect(buildRequestBody('p', 'google-aimode', 'TR', undefined, location)).toMatchObject({
      country: 'TR',
      location,
    });
    expect(buildRequestBody('p', 'google-aio', 'TR', undefined, location)).toMatchObject({
      country: 'TR',
      location,
    });
    expect(buildRequestBody('p', 'google-aio', 'TR')).not.toHaveProperty('location');
  });

  it("sends a US state's Google name the same way, and never as `state` too", () => {
    const location = 'California,United States';
    for (const id of ['google-aimode', 'google-aio']) {
      const body = buildRequestBody('p', id, 'US', 'CA', location);
      expect(body).toMatchObject({ country: 'US', location });
      expect(body).not.toHaveProperty('state');
    }
    // The AI endpoints take the state as `state`, and no `location`.
    const chat = buildRequestBody('p', 'chatgpt-web', 'US', 'CA', location);
    expect(chat).toMatchObject({ country: 'US', state: 'CA' });
    expect(chat).not.toHaveProperty('location');
  });

  it('never sends it to the other engines', () => {
    expect(
      buildRequestBody('p', 'chatgpt-web', 'TR', undefined, 'Istanbul,Istanbul,Turkiye'),
    ).not.toHaveProperty('location');
  });
});

describe('cloro-scraper – submitPromptTask', () => {
  /** Cloro's answers to the submissions, in order: an HTTP status, or a thrown network error. */
  let answers;
  const sent = () => fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

  beforeEach(() => {
    vi.stubEnv('CLORO_API_KEY', 'test-key');
    answers = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const next = answers.shift() ?? 200;
        if (next instanceof Error) throw next;
        return next === 200
          ? {
              ok: true,
              json: async () => ({ success: true, task: { id: `task-${sent().length}` } }),
            }
          : { ok: false, status: next, text: async () => 'refused' };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    log.warn.mockClear();
  });

  const task = {
    promptText: 'best crm for startups',
    promptId: 'prompt-1',
    scraperId: 'chatgpt-web',
    region: 'US-CA',
    webhookUrl: 'https://api.example.com/cloro/callback',
  };

  it("asks for the fan-out with the prompt's own targeting, and says so", async () => {
    await expect(submitPromptTask({ ...task, legacy: true })).resolves.toEqual({
      taskId: 'task-1',
      scraperId: 'chatgpt-web',
      legacy: true,
    });
    expect(sent()).toEqual([
      {
        taskType: 'CHATGPT',
        payload: expect.objectContaining({ country: 'US', state: 'CA', legacy: true }),
        webhook: { url: task.webhookUrl },
      },
    ]);
  });

  it('sends a task Cloro turned down (400, 422) again without legacy', async () => {
    for (const status of [400, 422]) {
      answers = [status];
      fetch.mockClear();
      await expect(submitPromptTask({ ...task, legacy: true })).resolves.toMatchObject({
        legacy: false,
      });
      expect(sent().map(({ payload }) => payload.legacy)).toEqual([true, undefined]);
    }
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('never sends it twice on a failure that may have billed it, or would fail again', async () => {
    for (const answer of [429, 500, 503, 401, 402, new TypeError('fetch failed')]) {
      answers = [answer];
      fetch.mockClear();
      const failure = submitPromptTask({ ...task, legacy: true });
      if (answer instanceof Error) await expect(failure).rejects.toThrow('fetch failed');
      else await expect(failure).rejects.toMatchObject({ status: answer });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps the prompt's US state or city as a Google task's location", async () => {
    await submitPromptTask({ ...task, scraperId: 'google-aio' });
    await submitPromptTask({ ...task, scraperId: 'google-aimode', region: 'TR~ISTANBUL' });
    expect(sent().map(({ payload }) => payload)).toEqual([
      expect.objectContaining({ country: 'US', location: 'California,United States' }),
      expect.objectContaining({ country: 'TR', location: 'Istanbul,Istanbul,Turkiye' }),
    ]);
  });

  it('sends a refused fan-out task again for the same state', async () => {
    answers = [400];
    await submitPromptTask({ ...task, legacy: true });
    expect(sent().map(({ payload }) => [payload.country, payload.state, payload.legacy])).toEqual([
      ['US', 'CA', true],
      ['US', 'CA', undefined],
    ]);
  });

  it('never retries a task that did not ask', async () => {
    answers = [400];
    await expect(submitPromptTask({ ...task, scraperId: 'copilot-web' })).rejects.toMatchObject({
      status: 400,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sent()[0].payload).not.toHaveProperty('legacy');
  });
});

describe('cloro-scraper – pollScraperResult', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('marks a task Cloro took and then failed, which a legacy task answers', async () => {
    vi.stubEnv('CLORO_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ task: { status: 'FAILED', failedReason: 'legacy unavailable' } }),
      })),
    );
    await expect(pollScraperResult('task-1', 'chatgpt-web')).rejects.toMatchObject({
      taskFailed: true,
      message: 'Cloro task task-1 failed: legacy unavailable',
    });
  });
});
