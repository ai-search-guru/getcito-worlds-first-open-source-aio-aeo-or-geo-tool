import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "+ Track" on a People Also Ask question (PROMPT-014): the question is
 * tracked once. A brand that already tracks the same text (case, accents,
 * punctuation and spacing aside) gets nothing added.
 */

let brandPrompts: { text: string }[] = [];
let pages: [number, number][] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'token' } } }),
    },
    from: (table: string) => {
      expect(table).toBe('prompts');
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: async (from: number, to: number) => {
          pages.push([from, to]);
          return { data: brandPrompts.slice(from, to + 1), error: null };
        },
      };
      return chain;
    },
  })),
}));

const trackPagePrompts = vi.fn();
vi.mock('@/lib/actions/promptSuggestions', () => ({
  trackPagePrompts: (...args: unknown[]) => trackPagePrompts(...args),
}));

const { getPromptDemandSignals, trackDemandQuestion } = await import('./promptDemandSignals');

beforeEach(() => {
  brandPrompts = [{ text: 'What is the best AI search monitoring tool?' }];
  pages = [];
  trackPagePrompts.mockReset().mockResolvedValue({ promptIds: ['n1'] });
});

describe('trackDemandQuestion', () => {
  it('tracks a question the brand has no prompt for, in its topic', async () => {
    expect(
      await trackDemandQuestion('b1', ' How do I track my brand in ChatGPT? ', 'Monitoring'),
    ).toEqual({
      promptIds: ['n1'],
    });
    expect(trackPagePrompts).toHaveBeenCalledWith('b1', null, [
      { text: 'How do I track my brand in ChatGPT?', topic: 'Monitoring' },
    ]);
  });

  it('adds nothing a second time for the same text, however it is written', async () => {
    brandPrompts.push({ text: 'how do i track my brand in chatgpt' });
    expect(
      await trackDemandQuestion('b1', 'How do I track my brand in ChatGPT?', 'Monitoring'),
    ).toEqual({
      promptIds: [],
      alreadyTracked: true,
    });
    expect(trackPagePrompts).not.toHaveBeenCalled();
  });

  it("reads every page of the brand's prompts", async () => {
    brandPrompts = Array.from({ length: 1000 }, (_, i) => ({ text: `prompt ${i}` }));
    brandPrompts.push({ text: 'How do I track my brand in ChatGPT' });
    expect(await trackDemandQuestion('b1', 'How do I track my brand in ChatGPT?', 'x')).toEqual({
      promptIds: [],
      alreadyTracked: true,
    });
    expect(pages).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('asks for a question', async () => {
    expect(await trackDemandQuestion('b1', '  ', 'x')).toEqual({
      promptIds: [],
      error: 'Pick a question.',
    });
    expect(trackPagePrompts).not.toHaveBeenCalled();
  });
});

describe('getPromptDemandSignals', () => {
  const answer = (status: number, body: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status })),
    );

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the demand', async () => {
    answer(200, JSON.stringify({ demand: { level: 'high' } }));
    expect(await getPromptDemandSignals('p1')).toEqual({ demand: { level: 'high' } });
  });

  it('is unavailable on an API without the route yet', async () => {
    answer(404, '<pre>Cannot GET /api/prompts/p1/demand</pre>');
    expect(await getPromptDemandSignals('p1')).toEqual({ unavailable: true });
  });

  it("keeps the route's own 404 and other failures as errors", async () => {
    answer(404, JSON.stringify({ error: 'Prompt not found' }));
    expect(await getPromptDemandSignals('p1')).toEqual({ error: 'Prompt not found' });
    answer(500, JSON.stringify({ error: 'Failed to load demand' }));
    expect(await getPromptDemandSignals('p1')).toEqual({ error: 'Failed to load demand' });
    answer(502, 'Bad gateway');
    expect(await getPromptDemandSignals('p1')).toEqual({ error: 'Server error: 502' });
  });
});
