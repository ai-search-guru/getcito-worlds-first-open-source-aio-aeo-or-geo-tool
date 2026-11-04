import { afterEach, describe, expect, it } from 'vitest';
import { setSyncedPrices } from './modelPriceCache.js';
import {
  FALLBACK_PRICE,
  MODEL_PRICES,
  estimateGenerationsLeft,
  generationCostUsd,
  medianCost,
  priceFor,
  searchCostUsd,
  typicalCostUsd,
} from './improveCost.js';

describe('generationCostUsd', () => {
  it('prices input and output tokens per million at the model rate', () => {
    // Gemini 3 Flash: $0.50 in / $3 out per 1M.
    expect(
      generationCostUsd('google/gemini-3-flash-preview', { inputTokens: 7000, outputTokens: 2000 }),
    ).toBeCloseTo(0.0095, 6);
    // GPT-5 mini: $0.25 / $2.
    expect(
      generationCostUsd('openai/gpt-5-mini', { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(0.25);
  });

  it('charges an unknown model at the expensive fallback, never at zero', () => {
    expect(priceFor('someone/new-model')).toBe(FALLBACK_PRICE);
    expect(priceFor('openrouter/someone/new-model')).toBe(FALLBACK_PRICE);
    expect(generationCostUsd('someone/new-model', { inputTokens: 1000, outputTokens: 1000 })).toBe(
      0.03,
    );
  });

  it('prices an OpenRouter id as the model it routes to', () => {
    expect(priceFor('openrouter/google/gemini-3-flash-preview')).toBe(
      MODEL_PRICES['google/gemini-3-flash-preview'],
    );
  });

  it('prices web searches at $10 per 1,000, and none as nothing', () => {
    expect(searchCostUsd(5)).toBeCloseTo(0.05, 6);
    expect(searchCostUsd(0)).toBe(0);
    expect(searchCostUsd(undefined)).toBe(0);
    expect(searchCostUsd(-2)).toBe(0);
  });

  it('treats missing usage as zero tokens', () => {
    expect(generationCostUsd('openai/gpt-5-mini', undefined)).toBe(0);
  });

  it("prices the Content Editor's Claude models: Haiku 5.5 reads, Sonnet 5.5 writes", () => {
    // Haiku 5.5: $0.10 / $0.50 per 1M; Sonnet 5.5: $2 / $10.
    expect(
      generationCostUsd('anthropic/claude-haiku-5-5', { inputTokens: 7000, outputTokens: 2000 }),
    ).toBeCloseTo(0.0017, 6);
    expect(
      generationCostUsd('anthropic/claude-sonnet-5-5', { inputTokens: 7000, outputTokens: 2000 }),
    ).toBeCloseTo(0.034, 6);
    expect(priceFor('anthropic/claude-sonnet-5-5')).not.toBe(FALLBACK_PRICE);
  });

  it("charges Haiku 5.5's long rate, $0.50 / $2.50, on a prompt past 100k tokens only", () => {
    expect(
      generationCostUsd('anthropic/claude-haiku-5-5', {
        inputTokens: 100_000,
        outputTokens: 1_000,
      }),
    ).toBeCloseTo(0.0105, 6);
    expect(
      generationCostUsd('anthropic/claude-haiku-5-5', {
        inputTokens: 100_001,
        outputTokens: 1_000,
      }),
    ).toBeCloseTo(0.0525005, 7);
    // A model with one rate has none.
    expect(
      generationCostUsd('anthropic/claude-sonnet-5-5', { inputTokens: 200_000, outputTokens: 0 }),
    ).toBe(0.4);
  });
});

describe("the table's prompt-cache read rates", () => {
  it("price a Claude model's cache read at a tenth of its input, as Anthropic does", () => {
    // Chat's models with no synced price (the table is what prices them then).
    for (const id of [
      'anthropic/claude-haiku-4-5',
      'anthropic/claude-haiku-5-5',
      'anthropic/claude-sonnet-5-5',
    ]) {
      const price = MODEL_PRICES[id];
      expect(price.cacheRead).toBeCloseTo(price.input / 10, 12);
    }
    // Chat's writer, by the id it's charged under: 1M tokens read from the cache cost $0.20.
    expect(
      generationCostUsd('anthropic/claude-sonnet-5.5', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.2, 12);
  });
});

describe('priceFor with synced prices (CHAT-16 §A)', () => {
  afterEach(() => setSyncedPrices([]));

  const HAIKU = {
    model_id: 'anthropic/claude-haiku-5.5',
    input_per_m: 0.1,
    output_per_m: 0.5,
    overrides: [{ min_prompt_tokens: 100000, prompt: '0.0000005', completion: '0.0000025' }],
  };

  const SYNCED = { synced: true };

  it('reads the synced price first for a Chat step, under its hyphened or OpenRouter id too', () => {
    setSyncedPrices([HAIKU]);
    for (const id of [
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-haiku-5-5',
      'openrouter/anthropic/claude-haiku-5.5',
    ]) {
      expect(priceFor(id, SYNCED)).toEqual({ input: 0.1, output: 0.5 });
    }
  });

  it("falls back to the server's own table for a model that isn't synced", () => {
    setSyncedPrices([HAIKU]);
    expect(priceFor('google/gemini-3-flash-preview', SYNCED)).toBe(
      MODEL_PRICES['google/gemini-3-flash-preview'],
    );
    expect(priceFor('someone/new-model', SYNCED)).toBe(FALLBACK_PRICE);
  });

  it('prices a call at the prompt-size override once its input is that large', () => {
    setSyncedPrices([HAIKU]);
    expect(
      generationCostUsd(
        'anthropic/claude-haiku-5.5',
        { inputTokens: 10_000, outputTokens: 1000 },
        SYNCED,
      ),
    ).toBeCloseTo(0.0015, 8);
    expect(
      generationCostUsd(
        'anthropic/claude-haiku-5.5',
        { inputTokens: 100_000, outputTokens: 1000 },
        SYNCED,
      ),
    ).toBeCloseTo(0.0525, 8);
  });

  it("leaves every other call on the table: the synced catalog prices Chat's steps only", () => {
    setSyncedPrices([
      { model_id: 'google/gemini-3-flash-preview', input_per_m: 9, output_per_m: 9, overrides: [] },
    ]);
    expect(priceFor('google/gemini-3-flash-preview')).toBe(
      MODEL_PRICES['google/gemini-3-flash-preview'],
    );
    expect(
      generationCostUsd('google/gemini-3-flash-preview', { inputTokens: 7000, outputTokens: 2000 }),
    ).toBeCloseTo(0.0095, 6);
  });

  it('never meters a paid model at a synced $0: the table, or the fallback, prices it', () => {
    setSyncedPrices([
      { model_id: 'anthropic/claude-sonnet-5.5', input_per_m: 0, output_per_m: 0, overrides: [] },
      { model_id: 'anthropic/claude-haiku-5.5', input_per_m: 0.1, output_per_m: 0, overrides: [] },
      { model_id: 'someone/new-model', input_per_m: 0, output_per_m: 0, overrides: [] },
      { model_id: 'someone/free-model:free', input_per_m: 0, output_per_m: 0, overrides: [] },
    ]);
    expect(priceFor('anthropic/claude-sonnet-5.5', SYNCED)).toBe(
      MODEL_PRICES['anthropic/claude-sonnet-5-5'],
    );
    expect(priceFor('anthropic/claude-haiku-5.5', SYNCED)).toBe(
      MODEL_PRICES['anthropic/claude-haiku-5-5'],
    );
    expect(priceFor('someone/new-model', SYNCED)).toBe(FALLBACK_PRICE);
    expect(
      generationCostUsd(
        'anthropic/claude-sonnet-5.5',
        { inputTokens: 7000, outputTokens: 2000 },
        SYNCED,
      ),
    ).toBeCloseTo(0.034, 6);
    // A `:free` model is free by name: its $0 is its price.
    expect(priceFor('someone/free-model:free', SYNCED)).toEqual({ input: 0, output: 0 });
  });

  it("prices OpenRouter's dotted id from the table when nothing is synced", () => {
    expect(priceFor('anthropic/claude-haiku-5.5', SYNCED)).toBe(
      MODEL_PRICES['anthropic/claude-haiku-5-5'],
    );
    expect(priceFor('anthropic/claude-sonnet-5.5')).toBe(
      MODEL_PRICES['anthropic/claude-sonnet-5-5'],
    );
  });
});

describe('the same 1% budget buys more on a cheaper model', () => {
  it('Growth ($2.49) on Flash vs GPT-5 mini vs Haiku', () => {
    const left = (model) => estimateGenerationsLeft(2.49, typicalCostUsd(model));
    expect(left('google/gemini-3-flash-preview')).toBe(262);
    expect(left('openai/gpt-5-mini')).toBe(433);
    expect(left('anthropic/claude-haiku-4-5')).toBe(146);
    expect(left('anthropic/claude-haiku-5-5')).toBe(1464);
    expect(left('anthropic/claude-sonnet-5-5')).toBe(73);
  });
});

describe('estimateGenerationsLeft', () => {
  it('is zero once the budget is spent or the cost is unknown', () => {
    expect(estimateGenerationsLeft(0, 0.01)).toBe(0);
    expect(estimateGenerationsLeft(1, 0)).toBe(0);
  });

  it('rounds down', () => {
    expect(estimateGenerationsLeft(0.1, 0.03)).toBe(3);
  });
});

describe('medianCost', () => {
  it('ignores one outlier', () => {
    expect(medianCost([0.0095, 0.0095, 1.6, 0.0095])).toBe(0.0095);
  });

  it('averages the two middle values of an even list, and is null when empty', () => {
    expect(medianCost([0.01, 0.03])).toBe(0.02);
    expect(medianCost([])).toBeNull();
  });
});
