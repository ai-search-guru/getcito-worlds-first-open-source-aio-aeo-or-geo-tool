import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// aiProvider.js builds its registry at import time from process.env, so each
// case sets the environment first and then imports a fresh module instance.
async function loadWith(env) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  return import('./aiProvider.js');
}

const AI_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'DEFAULT_SUGGESTION_MODEL',
];

describe('ai-provider registry', () => {
  const saved = {};

  beforeEach(() => {
    for (const key of AI_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of AI_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.resetModules();
  });

  it('registers openrouter only when its key is present', async () => {
    const without = await loadWith({});
    expect(without.getAvailableProviders()).not.toContain('openrouter');

    const withKey = await loadWith({ OPENROUTER_API_KEY: 'sk-or-test' });
    expect(withKey.getAvailableProviders()).toContain('openrouter');
  });

  it('uses Chat Completions, not the Responses API, for openrouter', async () => {
    // OpenRouter does not implement /responses — @ai-sdk/openai's default call
    // would 404 there. Regression guard for that specific wiring.
    const { resolveModel } = await loadWith({ OPENROUTER_API_KEY: 'sk-or-test' });
    const model = resolveModel('openrouter/anthropic/claude-haiku-4.5');

    expect(model.provider).toBe('openai.chat');
  });

  it('preserves namespaced model ids after the provider prefix', async () => {
    const { resolveModel } = await loadWith({ OPENROUTER_API_KEY: 'sk-or-test' });

    expect(resolveModel('openrouter/anthropic/claude-haiku-4.5').modelId).toBe(
      'anthropic/claude-haiku-4.5',
    );
    expect(resolveModel('openrouter/google/gemini-3-flash').modelId).toBe('google/gemini-3-flash');
  });

  it('still routes first-party providers to their own SDKs', async () => {
    const { resolveModel } = await loadWith({ ANTHROPIC_API_KEY: 'sk-ant-test' });

    expect(resolveModel('anthropic/claude-haiku-4-5').provider).toBe('anthropic.messages');
  });

  it('names the configured providers when an unknown one is requested', async () => {
    const { resolveModel } = await loadWith({ OPENROUTER_API_KEY: 'sk-or-test' });

    expect(() => resolveModel('mistral/large')).toThrow(/not configured.*openrouter/s);
  });

  it('attaches each first-party provider its own hosted web search tool', async () => {
    const { webSearchTools } = await loadWith({
      GOOGLE_GENERATIVE_AI_API_KEY: 'g-test',
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });

    expect(webSearchTools('google/gemini-3-flash-preview').google_search.id).toBe(
      'google.google_search',
    );
    expect(webSearchTools('openai/gpt-5-mini').web_search.id).toBe('openai.web_search');
    expect(webSearchTools('anthropic/claude-haiku-4-5').web_search.id).toBe(
      'anthropic.web_search_20250305',
    );
    // Claude Haiku 5.5 takes the basic version; a call may cap its searches.
    expect(webSearchTools('anthropic/claude-haiku-5-5').web_search.args).toEqual({ maxUses: 5 });
    expect(webSearchTools('anthropic/claude-haiku-5-5', { maxUses: 3 }).web_search.args).toEqual({
      maxUses: 3,
    });
  });

  it('asks OpenRouter for providers that keep no data on every call', async () => {
    const fetchMock = vi.fn(
      async () =>
        new globalThis.Response(
          JSON.stringify({
            id: 'gen-1',
            object: 'chat.completion',
            created: 0,
            model: 'anthropic/claude-haiku-4.5',
            choices: [
              { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { resolveModel } = await loadWith({ OPENROUTER_API_KEY: 'sk-or-test' });
      const { generateText } = await import('ai');

      const { text } = await generateText({
        model: resolveModel('openrouter/anthropic/claude-haiku-4.5'),
        prompt: 'Hi',
      });

      expect(text).toBe('ok');
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
      const body = JSON.parse(init.body);
      expect(body.provider.data_collection).toBe('deny');
      expect(body.model).toBe('anthropic/claude-haiku-4.5');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('has no search tool for openrouter or an unconfigured provider', async () => {
    const { webSearchTools } = await loadWith({ OPENROUTER_API_KEY: 'sk-or-test' });

    expect(webSearchTools('openrouter/google/gemini-3-flash')).toBeNull();
    expect(webSearchTools('google/gemini-3-flash-preview')).toBeNull();
  });
});

describe('openRouterFetch', () => {
  const post = (body) => ({ method: 'POST', body });

  it('adds data_collection deny to a JSON body without a provider', async () => {
    const own = vi.fn(async () => 'sent');
    const { openRouterFetch, OPENROUTER_ROUTING } = await import('./aiProvider.js');

    await openRouterFetch(OPENROUTER_ROUTING, own)('https://x', post('{"model":"m"}'));

    expect(JSON.parse(own.mock.calls[0][1].body)).toEqual({
      model: 'm',
      provider: { data_collection: 'deny' },
    });
  });

  it("keeps the body's own provider settings and denies data collection over them", async () => {
    const own = vi.fn(async () => 'sent');
    const { openRouterFetch, OPENROUTER_ROUTING } = await import('./aiProvider.js');
    const body = { model: 'm', provider: { order: ['azure'], data_collection: 'allow' } };

    await openRouterFetch(OPENROUTER_ROUTING, own)('https://x', post(JSON.stringify(body)));

    expect(JSON.parse(own.mock.calls[0][1].body).provider).toEqual({
      order: ['azure'],
      data_collection: 'deny',
    });
  });

  it('sends a body that is not JSON, or no body, as it is', async () => {
    const own = vi.fn(async () => 'sent');
    const { openRouterFetch, OPENROUTER_ROUTING } = await import('./aiProvider.js');
    const send = openRouterFetch(OPENROUTER_ROUTING, own);

    await send('https://x', post('not json'));
    await send('https://x', { method: 'GET' });

    expect(own.mock.calls[0][1].body).toBe('not json');
    expect(own.mock.calls[1][1]).toEqual({ method: 'GET' });
  });
});
