// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

/** Auto (CHAT-16 item 5): Claude Haiku 5.5 reads, Claude Sonnet 5.5 writes; Claude 5.5's settings. */

const key = vi.hoisted(() => ({
  resolve: vi.fn(),
  failure: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock('./key', () => ({ resolveChatModelKey: key.resolve }));
vi.mock('./keyHealth', () => ({ ownKeyFailure: key.failure }));

const { autoModels, estimateInputTokens, resolveChatModels } = await import('./engineModel');

describe('the run models', () => {
  it('read with Haiku 5.5 and write with Sonnet 5.5, priced by their catalog ids', () => {
    const models = autoModels('test-key', 'getcito');
    const read = models.pick('read');
    const write = models.pick('write');
    expect(models.phases).toBe('auto');
    expect((read.model as { modelId: string }).modelId).toBe('claude-haiku-5-5');
    expect((write.model as { modelId: string }).modelId).toBe('claude-sonnet-5-5');
    expect(read.budgetModel).toBe('anthropic/claude-haiku-5.5');
    expect(write.budgetModel).toBe('anthropic/claude-sonnet-5.5');
    expect(read.maxOutputTokens).toBe(8_000);
    expect(write.maxOutputTokens).toBe(16_000);
    // Native structured output, never the SDK's forced "json" tool; no sampling settings.
    expect(read.providerOptions).toEqual({ anthropic: { structuredOutputMode: 'outputFormat' } });
  });

  it('follow the key: Auto on an Anthropic key, one model on another provider’s', async () => {
    key.resolve.mockResolvedValueOnce({
      source: 'own',
      config: { provider: 'anthropic', apiKey: 'k', settings: {} },
    });
    expect((await resolveChatModels('org'))?.phases).toBe('auto');
    key.resolve.mockResolvedValueOnce({
      source: 'own',
      config: { provider: 'openai', apiKey: 'k', settings: {} },
    });
    const single = await resolveChatModels('org');
    expect(single?.phases).toBe('single');
    expect(single?.pick('read').budgetModel).toBe('openai/gpt-5.5');
    key.resolve.mockResolvedValueOnce(null);
    expect(await resolveChatModels('org')).toBeNull();
  });

  it('carry the key’s provider, and on the own key whether it was failing as the run started', async () => {
    key.failure.mockResolvedValueOnce({ provider: 'openai', class: 'no_credit' });
    key.resolve.mockResolvedValueOnce({
      source: 'own',
      config: { provider: 'openai', apiKey: 'k', settings: {} },
    });
    expect(await resolveChatModels('org')).toMatchObject({ provider: 'openai', keyFailing: true });

    // A health read that fails reads as working; GetCito's key is never read for it.
    key.failure.mockRejectedValueOnce(new Error('down'));
    key.resolve.mockResolvedValueOnce({
      source: 'own',
      config: { provider: 'anthropic', apiKey: 'k', settings: {} },
    });
    expect(await resolveChatModels('org')).toMatchObject({
      provider: 'anthropic',
      keyFailing: false,
    });
    key.failure.mockClear();
    key.resolve.mockResolvedValueOnce({
      source: 'getcito',
      config: { provider: 'anthropic', apiKey: 'k', settings: {} },
    });
    expect(await resolveChatModels('org')).toMatchObject({ source: 'getcito', keyFailing: false });
    expect(key.failure).not.toHaveBeenCalled();
  });

  it('count a prompt’s tokens up, not down', () => {
    expect(estimateInputTokens(['abcdef', { a: 1 }])).toBe(Math.ceil((6 + 7) / 3));
  });
});
