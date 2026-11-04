import { describe, expect, it } from 'vitest';
import { azureEndpoint, chatModelId, isAiProvider, parseProviderSettings } from './providers';

/** What each AI provider keeps besides its key, and the model Chat calls with it. */

describe('isAiProvider', () => {
  it('knows the five providers only', () => {
    expect(['anthropic', 'openai', 'google', 'azure', 'openrouter'].every(isAiProvider)).toBe(true);
    expect(isAiProvider('copilot')).toBe(false);
    expect(isAiProvider(null)).toBe(false);
  });
});

describe('azureEndpoint', () => {
  it("keeps an Azure resource's https origin", () => {
    expect(azureEndpoint(' https://acme.openai.azure.com/openai/v1/ ')).toBe(
      'https://acme.openai.azure.com',
    );
    expect(azureEndpoint('https://acme.cognitiveservices.azure.com')).toBe(
      'https://acme.cognitiveservices.azure.com',
    );
    expect(azureEndpoint('https://acme.services.ai.azure.com/models')).toBe(
      'https://acme.services.ai.azure.com',
    );
  });

  it('refuses other hosts, plain http, ports and credentials', () => {
    expect(azureEndpoint('https://openai.azure.com.evil.example')).toBeNull();
    expect(azureEndpoint('https://localhost')).toBeNull();
    expect(azureEndpoint('http://acme.openai.azure.com')).toBeNull();
    expect(azureEndpoint('https://acme.openai.azure.com:8443')).toBeNull();
    expect(azureEndpoint('https://u:p@acme.openai.azure.com')).toBeNull();
    expect(azureEndpoint('acme')).toBeNull();
  });
});

describe('parseProviderSettings', () => {
  it("keeps Azure's endpoint and deployment, and names the one that's wrong", () => {
    expect(
      parseProviderSettings('azure', {
        endpoint: 'https://acme.openai.azure.com/',
        deployment: ' gpt-5-chat ',
        model: 'ignored',
      }),
    ).toEqual({
      settings: { endpoint: 'https://acme.openai.azure.com', deployment: 'gpt-5-chat' },
    });
    expect(
      parseProviderSettings('azure', { endpoint: 'https://x.example', deployment: 'a' }),
    ).toEqual({ error: 'endpoint' });
    expect(
      parseProviderSettings('azure', { endpoint: 'https://acme.openai.azure.com', deployment: '' }),
    ).toEqual({ error: 'deployment' });
  });

  it('needs an OpenRouter model with its maker in the id', () => {
    expect(parseProviderSettings('openrouter', { model: 'openai/gpt-5.5' })).toEqual({
      settings: { model: 'openai/gpt-5.5' },
    });
    expect(parseProviderSettings('openrouter', { model: 'gpt-5.5' })).toEqual({ error: 'model' });
    expect(parseProviderSettings('openrouter', {})).toEqual({ error: 'model' });
  });

  it('lets the first-party providers keep their default model, or name another', () => {
    expect(parseProviderSettings('openai', { model: '  ' })).toEqual({ settings: {} });
    expect(parseProviderSettings('google', undefined)).toEqual({ settings: {} });
    expect(parseProviderSettings('anthropic', { model: 'claude-opus-4-8' })).toEqual({
      settings: { model: 'claude-opus-4-8' },
    });
    expect(parseProviderSettings('openai', { model: 'gpt 5' })).toEqual({ error: 'model' });
    // The id can land in a URL path: no `..`, and `/` only on OpenRouter.
    expect(parseProviderSettings('google', { model: '../v1/files' })).toEqual({ error: 'model' });
    expect(parseProviderSettings('openai', { model: 'org/gpt-5.5' })).toEqual({ error: 'model' });
    expect(parseProviderSettings('openrouter', { model: 'openai/../x' })).toEqual({
      error: 'model',
    });
  });
});

describe('chatModelId', () => {
  it("is the named model, the provider's default, or Azure's deployment", () => {
    expect(chatModelId('anthropic', {})).toBe('claude-sonnet-5');
    expect(chatModelId('openai', {})).toBe('gpt-5.5');
    expect(chatModelId('google', { model: 'gemini-3.1-pro-preview' })).toBe(
      'gemini-3.1-pro-preview',
    );
    expect(chatModelId('azure', { endpoint: 'https://a.openai.azure.com', deployment: 'd1' })).toBe(
      'd1',
    );
    expect(chatModelId('openrouter', { model: 'openai/gpt-5.5' })).toBe('openai/gpt-5.5');
  });
});
