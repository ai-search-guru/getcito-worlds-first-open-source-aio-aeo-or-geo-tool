import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1282, part 1 — an own product's keyword match with each prompt it was
 * shown for, against the products shown for that prompt in the window.
 */

const BRAND = '5b0c3b8e-8a5f-4a41-9d0e-1f2a3b4c5d6e';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

let cards: Array<Record<string, unknown>> = [];
let prompts: Array<{ id: string; text: string }> = [];
let cardFilters: Array<[string, unknown]> = [];

function fakeQueryBuilder(table: string) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    or: () => builder,
    order: () => builder,
    range: () => builder,
    in: (column: string, values: unknown) => {
      if (table === 'prompt_result_shopping_cards') cardFilters.push([column, values]);
      return builder;
    },
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({
        data: table === 'prompts' ? prompts : cards,
        error: null,
      }).then(onFulfilled),
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (table: string) => fakeQueryBuilder(table) }),
}));

const { getProductMatchScores } = await import('./shopping');

function card(
  title: string,
  resultId: string,
  promptId: string,
  position: number,
  createdAt: string,
  searches: string[] = [],
) {
  return {
    id: `${resultId}-${position}`,
    created_at: createdAt,
    position,
    product_title: title,
    prompt_result_id: resultId,
    prompt_results: {
      prompt_id: promptId,
      search_queries: searches.map((query) => ({ query, source_platform: 'chatgpt-web' })),
    },
  };
}

beforeEach(() => {
  cardFilters = [];
  prompts = [
    { id: P1, text: 'Best waterproof hiking boots' },
    { id: P2, text: 'White sneakers for the city' },
  ];
  cards = [
    // P1, latest answer: a rival first, then the brand's boot.
    card('Summit Waterproof Hiking Boot for Wet Rock', 'r2', P1, 1, '2026-10-20T10:00:00Z', [
      'waterproof hiking boots wet rock',
    ]),
    card('Trailrunner Waterproof Hiking Boot', 'r2', P1, 2, '2026-10-20T10:00:00Z'),
    // P1, an older answer, where the brand's boot was first.
    card('Trailrunner Waterproof Hiking Boot', 'r1', P1, 1, '2026-10-10T10:00:00Z'),
    // P2: the brand's boot alone.
    card('trailrunner waterproof hiking boot', 'r3', P2, 1, '2026-10-21T10:00:00Z'),
  ];
});

describe('getProductMatchScores', () => {
  it("scores the product for each prompt, with the latest answer's first product", async () => {
    const [p1, p2] = await getProductMatchScores(
      BRAND,
      'Trailrunner Waterproof Hiking Boot',
      [P1, P2],
      { datePreset: '30d' },
    );
    expect(cardFilters).toEqual([['prompt_results.prompt_id', [P1, P2]]]);

    expect(p1.promptText).toBe('Best waterproof hiking boots');
    // The searches' words count: "wet" and "rock" are missing.
    expect(p1.missing).toEqual(['wet', 'rock']);
    expect(p1.top).toMatchObject({
      title: 'Summit Waterproof Hiking Boot for Wet Rock',
      isThis: false,
    });
    expect(p1.top!.score).toBeGreaterThan(p1.score);

    // Its own title shown first, case aside.
    expect(p2.top).toMatchObject({ isThis: true, score: p2.score });
    expect(p2.missing).toEqual(['white', 'sneaker', 'city']);
    expect(p2.score).toBe(0);
  });

  it('leaves out a prompt the member can no longer read, and has no top without cards', async () => {
    prompts = [{ id: P2, text: 'White sneakers for the city' }];
    cards = [];
    const matches = await getProductMatchScores(BRAND, 'White City Sneaker', [P1, P2], {
      datePreset: '7d',
    });
    expect(matches).toEqual([
      {
        promptId: P2,
        promptText: 'White sneakers for the city',
        score: 100,
        missing: [],
        top: null,
      },
    ]);
  });

  it('refuses bad input before reading anything', async () => {
    const window = { datePreset: '30d' as const };
    await expect(getProductMatchScores('b1', 'Boot', [P1], window)).rejects.toThrow('invalid');
    await expect(getProductMatchScores(BRAND, ' ', [P1], window)).rejects.toThrow('invalid');
    await expect(getProductMatchScores(BRAND, 'Boot', [], window)).rejects.toThrow('invalid');
    await expect(getProductMatchScores(BRAND, 'Boot', ['p1'], window)).rejects.toThrow('invalid');
    const many = Array.from(
      { length: 21 },
      (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
    );
    await expect(getProductMatchScores(BRAND, 'Boot', many, window)).rejects.toThrow('invalid');
    expect(cardFilters).toEqual([]);
  });
});
