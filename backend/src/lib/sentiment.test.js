import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

const generateObject = vi.fn();
const resolveModel = vi.fn();
const decide = vi.fn();

vi.mock('ai', () => ({ generateObject: (...args) => generateObject(...args) }));
vi.mock('./aiProvider.js', () => ({ resolveModel: (...args) => resolveModel(...args) }));
vi.mock('./decider.js', () => ({
  decide: (...args) => decide(...args),
  isDeciderConfigured: () => Boolean(process.env.OPENROUTER_API_KEY),
}));
vi.mock('./logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { analyzeSentimentAI, brandExcerpt, sentimentSchema } = await import('./sentiment.js');

const ORIGINAL_ENV = {
  SENTIMENT_MODEL: process.env.SENTIMENT_MODEL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('analyzeSentimentAI', () => {
  beforeEach(() => {
    generateObject.mockReset();
    resolveModel.mockReset();
    decide.mockReset();
    resolveModel.mockReturnValue({ id: 'stub-model' });
    delete process.env.SENTIMENT_MODEL;
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(restoreEnv);

  it('keeps the historical OpenAI default when SENTIMENT_MODEL is unset', async () => {
    generateObject.mockResolvedValue({
      object: { sentiment: 'positive', confidence: 0.9, reason: 'Recommended first' },
    });

    await analyzeSentimentAI('Acme Coffee is the top pick.', 'Acme Coffee');

    expect(resolveModel).toHaveBeenCalledWith('openai/gpt-5-mini');
  });

  it('routes to any configured provider — no OpenAI key required', async () => {
    process.env.SENTIMENT_MODEL = 'anthropic/claude-haiku-4-5';
    generateObject.mockResolvedValue({
      object: { sentiment: 'neutral', confidence: 0.4, reason: 'Listed among others' },
    });

    const result = await analyzeSentimentAI('Several roasters exist.', 'Acme Coffee');

    expect(resolveModel).toHaveBeenCalledWith('anthropic/claude-haiku-4-5');
    expect(result.sentiment).toBe('neutral');
  });

  it('accepts nested OpenRouter model ids verbatim', async () => {
    process.env.SENTIMENT_MODEL = 'openrouter/anthropic/claude-haiku-4.5';
    generateObject.mockResolvedValue({
      object: { sentiment: 'negative', confidence: 0.7, reason: 'Called overpriced' },
    });

    await analyzeSentimentAI('Acme Coffee is overpriced.', 'Acme Coffee');

    expect(resolveModel).toHaveBeenCalledWith('openrouter/anthropic/claude-haiku-4.5');
  });

  it('sends the first 3000 chars when the brand is never named, as before', async () => {
    generateObject.mockResolvedValue({
      object: { sentiment: 'neutral', confidence: 0.5, reason: 'ok' },
    });

    await analyzeSentimentAI('x'.repeat(5000), 'Acme Coffee');

    const { prompt } = generateObject.mock.calls[0][0];
    expect(prompt).toContain('x'.repeat(3000));
    expect(prompt).not.toContain('x'.repeat(3001));
  });

  it('degrades to neutral instead of throwing when the model call fails', async () => {
    generateObject.mockRejectedValue(new Error('rate limited'));

    const result = await analyzeSentimentAI('Acme Coffee is great.', 'Acme Coffee');

    expect(result).toEqual({ sentiment: 'neutral', confidence: 0, reason: 'Analysis failed' });
  });

  it('degrades to neutral when the provider is not configured at all', async () => {
    resolveModel.mockImplementation(() => {
      throw new Error('Provider "openrouter" is not configured.');
    });

    const result = await analyzeSentimentAI('Acme Coffee is great.', 'Acme Coffee');

    expect(result.sentiment).toBe('neutral');
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('constrains the schema to the three sentiment values', () => {
    expect(
      sentimentSchema.safeParse({ sentiment: 'mixed', confidence: 0.5, reason: 'x' }).success,
    ).toBe(false);
  });

  it('keeps confidence free of min/max so Anthropic accepts the schema', () => {
    // Anthropic rejects `minimum`/`maximum` on numbers in strict structured
    // output, and OpenRouter surfaces that 400 from every backing provider.
    // Verified against the live endpoint, not just in principle.
    const json = z.toJSONSchema(sentimentSchema);

    expect(json.properties.confidence.minimum).toBeUndefined();
    expect(json.properties.confidence.maximum).toBeUndefined();
  });

  it('clamps out-of-range confidence in code instead', async () => {
    generateObject.mockResolvedValue({
      object: { sentiment: 'positive', confidence: 1.5, reason: 'over-confident model' },
    });
    expect((await analyzeSentimentAI('great', 'Acme')).confidence).toBe(1);

    generateObject.mockResolvedValue({
      object: { sentiment: 'negative', confidence: -0.2, reason: 'negative number' },
    });
    expect((await analyzeSentimentAI('bad', 'Acme')).confidence).toBe(0);
  });

  it('falls back to 0.5 when the model omits a usable confidence', async () => {
    generateObject.mockResolvedValue({
      object: { sentiment: 'neutral', confidence: Number.NaN, reason: 'unparseable' },
    });

    expect((await analyzeSentimentAI('meh', 'Acme')).confidence).toBe(0.5);
  });

  it('sends the text around a mention past the first 3000 chars (#986)', async () => {
    generateObject.mockResolvedValue({
      object: { sentiment: 'negative', confidence: 0.8, reason: 'warned against' },
    });
    const text = `${'filler '.repeat(800)}Avoid Acme Coffee, it is stale.`;

    await analyzeSentimentAI(text, 'Acme Coffee');

    const { prompt } = generateObject.mock.calls[0][0];
    expect(prompt).toContain('Avoid Acme Coffee, it is stale.');
  });
});

describe('analyzeSentimentAI with the decision model', () => {
  const answer = (choice, probabilities) => ({
    sentiment: { type: 'choice', choice, probabilities },
  });

  beforeEach(() => {
    generateObject.mockReset();
    resolveModel.mockReset();
    decide.mockReset();
    resolveModel.mockReturnValue({ id: 'stub-model' });
    delete process.env.SENTIMENT_MODEL;
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(restoreEnv);

  it('is the default with an OpenRouter key, and reads the whole answer', async () => {
    decide.mockResolvedValue(answer('positive', { positive: 0.9, neutral: 0.08, negative: 0.02 }));
    const text = `${'filler '.repeat(800)}Acme Coffee is the best roaster.`;

    const result = await analyzeSentimentAI(text, 'Acme Coffee');

    expect(result).toEqual({ sentiment: 'positive', confidence: 0.9, reason: '' });
    expect(decide.mock.calls[0][0].state).toEqual({ brand: 'Acme Coffee', ai_response: text });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('falls back to the chat model when the decision model fails', async () => {
    decide.mockRejectedValue(new Error('Decisions API 503'));
    generateObject.mockResolvedValue({
      object: { sentiment: 'neutral', confidence: 0.6, reason: 'listed' },
    });

    const result = await analyzeSentimentAI('Acme Coffee is listed.', 'Acme Coffee');

    expect(result.sentiment).toBe('neutral');
    expect(resolveModel).toHaveBeenCalledWith('openai/gpt-5-mini');
  });

  it('falls back when the answer is not one of the three choices', async () => {
    decide.mockResolvedValue(answer('mixed', { mixed: 1 }));
    generateObject.mockResolvedValue({
      object: { sentiment: 'positive', confidence: 0.7, reason: 'ok' },
    });

    expect((await analyzeSentimentAI('Acme Coffee rocks.', 'Acme Coffee')).sentiment).toBe(
      'positive',
    );
  });

  it('leaves an explicit SENTIMENT_MODEL on the chat model', async () => {
    process.env.SENTIMENT_MODEL = 'anthropic/claude-haiku-4-5';
    generateObject.mockResolvedValue({
      object: { sentiment: 'neutral', confidence: 0.5, reason: 'ok' },
    });

    await analyzeSentimentAI('Acme Coffee.', 'Acme Coffee');

    expect(decide).not.toHaveBeenCalled();
    expect(resolveModel).toHaveBeenCalledWith('anthropic/claude-haiku-4-5');
  });
});

describe('brandExcerpt', () => {
  const brand = { brandName: 'Acme', domains: ['acme.com'] };

  it('returns text that fits unchanged', () => {
    expect(brandExcerpt('Acme is fine.', brand, 100)).toBe('Acme is fine.');
  });

  it('keeps the opening and the text around each mention', () => {
    const text = `Intro line. ${'a '.repeat(1000)}Acme is great. ${'b '.repeat(1000)}See acme.com today.`;

    const excerpt = brandExcerpt(text, brand, 3000);

    expect(excerpt.startsWith('Intro line.')).toBe(true);
    expect(excerpt).toContain('Acme is great.');
    expect(excerpt).toContain('See acme.com today.');
    expect(excerpt.length).toBeLessThanOrEqual(3000);
  });

  it('merges mentions close enough to overlap into one stretch', () => {
    const text = `${'x '.repeat(1000)}Acme one. Acme two. ${'y '.repeat(1000)}`;

    const excerpt = brandExcerpt(text, brand, 3000);

    expect(excerpt.split('\n…\n')).toHaveLength(2);
  });

  it('never exceeds the budget, however many mentions there are', () => {
    const text = Array.from({ length: 50 }, (_, i) => `${'z '.repeat(400)}Acme ${i}.`).join(' ');

    expect(brandExcerpt(text, brand, 3000).length).toBeLessThanOrEqual(3000);
  });
});
