import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_PROVIDER_OPTIONS, buildAgentModel, type AgentModel } from './model';

/** Chat's model for each AI provider, called with the organization's own key. */

const KEY = 'test-key-0123456789abcdef';

/** The request a model sends, caught before it leaves. */
async function firstRequest(model: AgentModel) {
  const fetch = vi.fn(async () => new Response('{}', { status: 418 }));
  vi.stubGlobal('fetch', fetch);
  await Promise.resolve(
    model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      providerOptions: AGENT_PROVIDER_OPTIONS,
    }),
  ).catch(() => {});
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  return { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAgentModel', () => {
  it("calls each first-party provider's default model, or the one named", async () => {
    const anthropic = buildAgentModel({ provider: 'anthropic', apiKey: KEY, settings: {} });
    expect([anthropic.provider, anthropic.modelId]).toEqual([
      'anthropic.messages',
      'claude-sonnet-5',
    ]);
    const openai = buildAgentModel({ provider: 'openai', apiKey: KEY, settings: {} });
    expect([openai.provider, openai.modelId]).toEqual(['openai.responses', 'gpt-5.5']);
    expect((await firstRequest(openai)).body.store).toBe(false);
    const google = buildAgentModel({
      provider: 'google',
      apiKey: KEY,
      settings: { model: 'gemini-3.1-pro-preview' },
    });
    expect([google.provider, google.modelId]).toEqual([
      'google.generative-ai',
      'gemini-3.1-pro-preview',
    ]);
  });

  it("calls an Azure deployment on the resource's own endpoint", async () => {
    const model = buildAgentModel({
      provider: 'azure',
      apiKey: KEY,
      settings: { endpoint: 'https://acme.openai.azure.com', deployment: 'gpt-5-chat' },
    });
    expect(model.modelId).toBe('gpt-5-chat');
    const { url, headers, body } = await firstRequest(model);
    expect(url).toBe('https://acme.openai.azure.com/openai/v1/responses?api-version=v1');
    expect(headers.get('api-key')).toBe(KEY);
    // Chat keeps its history: nothing stored for it to refer back to.
    expect(body.store).toBe(false);
  });

  it("calls OpenRouter's Chat Completions with the model named", async () => {
    const model = buildAgentModel({
      provider: 'openrouter',
      apiKey: KEY,
      settings: { model: 'openai/gpt-5.5' },
    });
    expect([model.provider, model.modelId]).toEqual(['openai.chat', 'openai/gpt-5.5']);
    const { url, headers } = await firstRequest(model);
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(headers.get('x-title')).toBeNull();
    expect(headers.get('http-referer')).toBeNull();
  });
});
