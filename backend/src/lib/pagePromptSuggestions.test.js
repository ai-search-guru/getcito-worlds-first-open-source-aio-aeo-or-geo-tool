import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompts suggested for one page (AT-006 part B2). These pin which Search
 * Console queries count as the page's, that the model is told what the page
 * says and how it does, that a sitemap entry saves reading the page, and
 * that what goes out is new, one of each, with a query only when it was one
 * of those given.
 */

let db;
const rpc = vi.fn();
const generateObject = vi.fn();
const readPage = vi.fn();

function table(name) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve, reject) =>
      Promise.resolve({ data: db[name] ?? [], error: null }).then(resolve, reject),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: { from: (name) => table(name), rpc: (...args) => rpc(...args) },
}));
vi.mock('ai', () => ({
  generateObject: (...args) => generateObject(...args),
  NoObjectGeneratedError: { isInstance: (err) => err?.name === 'NoObjectGenerated' },
}));
vi.mock('./aiProvider.js', () => ({ resolveModel: () => 'model' }));
vi.mock('./retry.js', () => ({ withRetry: (fn) => fn() }));
vi.mock('./gaSuggestions.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readPage: (...args) => readPage(...args),
}));

const {
  PAGE_SUGGESTIONS,
  buildPagePrompt,
  finishSuggestions,
  matchPageQueries,
  pageWords,
  suggestPromptsForPage,
} = await import('./pagePromptSuggestions.js');

const context = {
  brand: { name: 'Acme Coffee', description: 'Specialty coffee roaster', language: 'en' },
  existingPromptTexts: ['Best monthly coffee bean subscription for offices'],
  existingTopicNames: ['Subscriptions', 'Espresso'],
};

const listRow = {
  page: '/Gifts',
  ai_visits: 0,
  citations: 6,
  targeting_prompts: 0,
  sessions: 90,
  key_events: 6,
};

const suggestion = (text, over = {}) => ({
  text,
  topic: 'Gift Ideas',
  reason: 'The gifts page lists coffee gift boxes by budget, which answers this directly.',
  ...over,
});

beforeEach(() => {
  rpc.mockReset();
  generateObject.mockReset();
  readPage.mockReset();
  db = {
    site_pages: [
      {
        url: 'https://acme-coffee.example.com/gifts/',
        title: 'Coffee gifts',
        description: 'Coffee gift boxes and sets for every budget',
        h1: 'Coffee gift ideas',
      },
    ],
    brand_domains: [{ domain: 'acme-coffee.example.com' }],
  };
  rpc.mockImplementation(async (fn) =>
    fn === 'ai_traffic_pages'
      ? { data: { rows: [listRow] }, error: null }
      : {
          data: [
            { query: 'coffee gift box ideas', impressions: 400, clicks: 12 },
            { query: 'best coffee gifts under 50', impressions: 900, clicks: 30 },
            { query: 'espresso machine descaling', impressions: 2000, clicks: 80 },
          ],
          error: null,
        },
  );
});

describe('matchPageQueries', () => {
  const words = pageWords('/gifts', {
    title: 'Coffee gifts',
    description: 'Coffee gift boxes and sets',
    h1: null,
  });

  it("keeps queries most of whose words are the page's, busiest first", () => {
    const rows = [
      { query: 'coffee gift box', impressions: 100, clicks: 1 },
      { query: 'coffee gifts', impressions: 300, clicks: 9 },
      { query: 'espresso machine descaling', impressions: 2000, clicks: 80 },
      { query: 'the best', impressions: 50, clicks: 0 },
    ];
    expect(matchPageQueries(rows, words, []).map((q) => q.query)).toEqual([
      'coffee gifts',
      'coffee gift box',
    ]);
  });

  it('leaves out queries a tracked prompt already covers, and caps the list', () => {
    const rows = [{ query: 'coffee gifts', impressions: 300, clicks: 9 }];
    expect(matchPageQueries(rows, words, ['Which coffee gifts do people love?'])).toEqual([]);
    const many = Array.from({ length: 14 }, (_, i) => ({
      query: `coffee gift ${i}`,
      impressions: i,
      clicks: 0,
    }));
    expect(matchPageQueries(many, words, [])).toHaveLength(10);
  });
});

describe('finishSuggestions', () => {
  it('drops tracked prompts and repeats, and keeps only queries it was given', () => {
    const out = finishSuggestions(
      [
        suggestion('Best monthly coffee bean subscription for offices'),
        suggestion('What coffee gift box should I buy for a coffee lover?', {
          sourceQuery: 'Coffee Gift Box Ideas ',
        }),
        suggestion('What coffee gift box should I buy for a coffee lover?'),
        suggestion('Good coffee gifts for a new home owner?', { sourceQuery: 'made up query' }),
      ],
      {
        existingPromptTexts: context.existingPromptTexts,
        queries: [{ query: 'coffee gift box ideas', impressions: 400, clicks: 12 }],
      },
    );
    expect(out).toEqual([
      expect.objectContaining({
        text: 'What coffee gift box should I buy for a coffee lover?',
        sourceQuery: 'coffee gift box ideas',
        impressions: 400,
      }),
      expect.objectContaining({
        text: 'Good coffee gifts for a new home owner?',
        sourceQuery: null,
        impressions: null,
      }),
    ]);
  });

  it(`sends at most ${PAGE_SUGGESTIONS}`, () => {
    const raw = Array.from({ length: PAGE_SUGGESTIONS + 1 }, (_, i) =>
      suggestion(`Which coffee gift works best for occasion number ${i}?`),
    );
    expect(finishSuggestions(raw, { existingPromptTexts: [], queries: [] })).toHaveLength(
      PAGE_SUGGESTIONS,
    );
  });
});

describe('buildPagePrompt', () => {
  it("tells the model what the page says, its figures and the brand's queries", () => {
    const { system, prompt } = buildPagePrompt({
      context,
      page: '/gifts',
      summary: { title: 'Coffee gifts', description: 'Gift boxes', h1: null },
      figures: { sessions: 90, keyEvents: 6, aiVisits: 0, citations: 6, targetingPrompts: 0 },
      queries: [{ query: 'coffee gift box ideas', impressions: 400, clicks: 12 }],
    });
    expect(system).toContain('whose best answer is ONE page');
    expect(system).toContain('sourceQuery');
    // This year, and no year unless one belongs (currentYear.js).
    expect(system).toContain(`Current year: ${new Date().getUTCFullYear()}`);
    expect(system).toContain('Leave years out');
    expect(prompt).toContain('The page: /gifts');
    expect(prompt).toContain('Coffee gifts — Gift boxes');
    expect(prompt).toContain('90 sessions');
    expect(prompt).toContain('cited 6 times');
    expect(prompt).toContain('"coffee gift box ideas" — 400 impressions');
    expect(prompt).toContain('1. Best monthly coffee bean subscription for offices');
  });

  it('says when the page could not be read and has no figures, and asks for no queries', () => {
    const { system, prompt } = buildPagePrompt({
      context,
      page: '/about',
      summary: null,
      figures: null,
      queries: [],
    });
    expect(system).not.toContain('sourceQuery');
    expect(prompt).toContain('could not be read');
    expect(prompt).toContain('No traffic or citation figures');
  });
});

describe('suggestPromptsForPage', () => {
  it("writes suggestions from the page's sitemap entry, figures and queries", async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion('What coffee gift box should I buy for a coffee lover?', {
            sourceQuery: 'coffee gift box ideas',
          }),
          suggestion('Good coffee gifts under 50 dollars?'),
          suggestion('Which coffee gift set suits a beginner?'),
        ],
      },
    });
    const result = await suggestPromptsForPage('b1', {
      page: '/gifts',
      from: '2026-09-18T12:00:00.000Z',
      to: '2026-10-18T12:00:00.000Z',
      context,
    });

    // The same range as the page's list.
    expect(rpc).toHaveBeenCalledWith('ai_traffic_pages', {
      p_brand_id: 'b1',
      p_from: '2026-09-18T12:00:00.000Z',
      p_to: '2026-10-18T12:00:00.000Z',
      p_tab: 'all',
      p_limit: 10_000,
      p_offset: 0,
    });
    // The sitemap entry says what the page is: nothing to read.
    expect(readPage).not.toHaveBeenCalled();
    const { prompt } = generateObject.mock.calls[0][0];
    expect(prompt).toContain('Coffee gifts');
    expect(prompt).toContain('90 sessions');
    expect(prompt).toContain('"best coffee gifts under 50"');
    expect(prompt).not.toContain('espresso machine descaling');

    expect(result.page).toEqual({ path: '/gifts', title: 'Coffee gifts' });
    expect(result.queries).toBe(2);
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]).toMatchObject({
      sourceQuery: 'coffee gift box ideas',
      impressions: 400,
    });
  });

  it('reads a page the sitemap knows nothing about, on the primary domain', async () => {
    db.site_pages = [];
    readPage.mockResolvedValue({ title: 'About Acme', description: null, h1: null, headings: [] });
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion('Which coffee roasters source beans directly from farms?'),
          suggestion('How do specialty coffee roasters choose their beans?'),
          suggestion('What makes a coffee roaster sustainable and ethical?'),
        ],
      },
    });
    const result = await suggestPromptsForPage('b1', { page: '/about', context });
    expect(readPage).toHaveBeenCalledWith('https://acme-coffee.example.com/about');
    expect(result.page.title).toBe('About Acme');
  });

  it('says plainly when no attempt gave usable suggestions', async () => {
    generateObject.mockRejectedValue(Object.assign(new Error('x'), { name: 'NoObjectGenerated' }));
    await expect(suggestPromptsForPage('b1', { page: '/gifts', context })).rejects.toMatchObject({
      status: 502,
      message: "Couldn't write suggestions for this page. Try again.",
    });
  });
});
