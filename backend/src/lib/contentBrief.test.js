import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * Rebuild outline (Content Editor CE-007): the brief written from the
 * sources the person kept, metered from the AI usage budget.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';
const PROMPT = '55555555-5555-5555-5555-555555555555';

let rows;
let writes;
let filters;
const generateObject = vi.fn();
const reserveAiBudget = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, filters: [] };
      filters.push(call);
      // A table set to an Error fails its read.
      const result = () =>
        rows[table] instanceof Error
          ? { data: null, error: rows[table] }
          : { data: rows[table] ?? null, error: null };
      const chain = {
        select: () => chain,
        eq: (col, v) => (call.filters.push(['eq', col, v]), chain),
        in: (col, v) => (call.filters.push(['in', col, v]), chain),
        insert: async (value) => (writes.push({ table, op: 'insert', value }), { error: null }),
        update: (value) => (writes.push({ table, op: 'update', value }), chain),
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (resolve) => resolve(result()),
      };
      return chain;
    },
  },
}));
/** The writes but the run's own steps (content_agent_runs, 00249). */
const draftWrites = () => writes.filter((w) => w.table !== 'content_agent_runs');
class NoObjectGeneratedError extends Error {
  static isInstance(err) {
    return err instanceof NoObjectGeneratedError;
  }
}
// The real schema helpers: a Claude call's schema is built with them (structuredOutput.js).
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal()),
  generateObject: (...args) => generateObject(...args),
  NoObjectGeneratedError,
}));
vi.mock('./aiProvider.js', () => ({ resolveModel: vi.fn((id) => `model:${id}`) }));
vi.mock('./planGuard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reserveAiBudget: (...args) => reserveAiBudget(...args),
}));
vi.mock('./logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const readLinkTargets = vi.fn();
vi.mock('./contentLinks.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readLinkTargets: (...args) => readLinkTargets(...args),
}));
const citedPagesLength = vi.fn();
vi.mock('./contentCitedLength.js', () => ({
  citedPagesLength: (...args) => citedPagesLength(...args),
}));
const stopIfStopped = vi.fn();
vi.mock('./contentRuns.js', async (importOriginal) => ({
  ...(await importOriginal()),
  stopIfStopped: (...args) => stopIfStopped(...args),
}));

const {
  BRIEF_FORMATS,
  BRIEF_V2_LIMITS,
  FACT_SOURCES,
  PROOF_KINDS,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_V2,
  briefGuard,
  buildBriefPrompt,
  mapOutline,
  outlineSchema,
  outlineSchemaV2,
  briefForWriter,
  briefNumbered,
  briefRules,
  contentBriefModelId,
  contentReadModelId,
  contentWriteModelId,
  rebuildDraftBrief,
  rebuildSources,
} = await import('./contentBrief.js');
const { NAME_PLACEHOLDER, QUOTE_PLACEHOLDER } = await import('./contentPeople.js');
const { NUMBER_PLACEHOLDER } = await import('./contentSources.js');
const { PlanLimitError } = await import('./planGuard.js');
// The real hold: self-hosted here, so it reserves nothing and writes each charge.
const realGuard = await vi.importActual('./planGuard.js');

const sources = (over = {}) => ({
  promptIds: [PROMPT],
  fanouts: [
    { query: 'Best espresso machine under 500', platforms: ['perplexity-web', 'copilot-web'] },
    { query: 'home espresso grinder', platforms: ['copilot-web'] },
  ],
  pages: [{ url: 'https://www.reddit.com/r/espresso/x', kind: 'forum' }],
  queries: ['espresso machine under 500'],
  headings: ['Choosing a machine'],
  length: 3000,
  ...over,
});

/** The rules in effect, as Fix sends them. */
const RULES = [{ key: 'h2Answer', name: 'Answer under each H2', detail: 'aim: 60 words' }];

const outline = [
  {
    heading: 'The best espresso machines under $500',
    keyPoints: ['Price bands', ' '],
    fanout: 'best espresso machine UNDER 500',
    platform: 'copilot-web',
  },
  {
    heading: 'Grinders',
    keyPoints: ['Burr vs blade'],
    fanout: 'home espresso grinder',
    platform: 'chatgpt',
  },
  { heading: 'Care', keyPoints: [], fanout: 'made up search', platform: 'copilot-web' },
];

beforeEach(() => {
  stopIfStopped.mockReset().mockResolvedValue(undefined);
  citedPagesLength.mockReset().mockResolvedValue({ characters: 4300, pages: 1 });
  readLinkTargets.mockReset().mockResolvedValue({ own: [], sources: [] });
  writes = [];
  filters = [];
  rows = {
    content_drafts: {
      id: DRAFT,
      brand_id: BRAND,
      title: 'The home espresso guide',
      page_type: 'buying_guide',
      method: 'optimize',
      source_url: 'https://acme.example/guides/espresso',
    },
    brands: {
      name: 'Acme Coffee',
      industry: 'Food & Beverage',
      description: null,
      organization_id: 'o1',
      language: 'tr',
    },
    prompts: [{ id: PROMPT, text: 'Best espresso machines under $500?' }],
  };
  generateObject.mockReset().mockResolvedValue({
    object: {
      goal: ' Help buyers pick ',
      audience: 'Home baristas',
      outline,
      keywords: ['espresso', 'espresso', ' grinder '],
    },
    usage: { inputTokens: 1000, outputTokens: 500 },
  });
  reserveAiBudget.mockReset().mockImplementation(realGuard.reserveAiBudget);
  // The models as a server without an Anthropic key picks them, whatever the shell has.
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('CONTENT_READ_MODEL', '');
  vi.stubEnv('CONTENT_WRITE_MODEL', '');
});
afterEach(() => vi.unstubAllEnvs());

const GEMINI = 'google/gemini-3-flash-preview';
const HAIKU = 'anthropic/claude-haiku-5-5';
const SONNET = 'anthropic/claude-sonnet-5-5';

describe("the Content Editor's models", () => {
  const ids = () => ({
    read: contentReadModelId(),
    write: contentWriteModelId(),
    improve: contentBriefModelId(),
  });

  it('stay on the model they had, the Improve tab’s, without an Anthropic key', () => {
    vi.stubEnv('IMPROVE_SUGGESTION_MODEL', '');
    vi.stubEnv('DEFAULT_SUGGESTION_MODEL', '');
    expect(ids()).toEqual({ read: GEMINI, write: GEMINI, improve: GEMINI });
    vi.stubEnv('IMPROVE_SUGGESTION_MODEL', 'openai/gpt-5-mini');
    expect(ids()).toEqual({
      read: 'openai/gpt-5-mini',
      write: 'openai/gpt-5-mini',
      improve: 'openai/gpt-5-mini',
    });
  });

  it('read with Claude Haiku and write with Claude Sonnet with an Anthropic key; Improve keeps its own', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubEnv('IMPROVE_SUGGESTION_MODEL', GEMINI);
    expect(ids()).toEqual({ read: HAIKU, write: SONNET, improve: GEMINI });
  });

  it('take CONTENT_READ_MODEL and CONTENT_WRITE_MODEL first, with the key or without it', () => {
    vi.stubEnv('CONTENT_READ_MODEL', 'google/gemini-3-flash');
    vi.stubEnv('CONTENT_WRITE_MODEL', 'openai/gpt-5-mini');
    const set = { read: 'google/gemini-3-flash', write: 'openai/gpt-5-mini' };
    expect(ids()).toMatchObject(set);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    expect(ids()).toMatchObject(set);
  });

  it('read with the fallback a caller gives when there is no key', () => {
    expect(contentReadModelId(() => 'openai/gpt-5-mini')).toBe('openai/gpt-5-mini');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    expect(contentReadModelId(() => 'openai/gpt-5-mini')).toBe(HAIKU);
  });
});

describe('rebuildDraftBrief', () => {
  it('takes out a number its sources don\u2019t have, and puts a name or quote as a placeholder', async () => {
    const year = new Date().getUTCFullYear();
    generateObject.mockResolvedValue({
      object: {
        goal: 'Win 73% of home baristas',
        audience: 'Home baristas who drink 4 cups a day',
        outline: [
          {
            heading: 'The 12 best espresso machines under $500',
            keyPoints: [
              'Dr. Jane Doe recommends a flat burr',
              '"Pressure matters far more than price," says the owner',
              'Machines under 500 dollars',
              'Compare 3 grinders',
              `The best machines of ${year}`,
            ],
            fanout: 'home espresso grinder',
            platform: 'copilot-web',
          },
        ],
        keywords: ['espresso', 'top 12 espresso machines', 'espresso under 500'],
      },
      usage: { inputTokens: 1000, outputTokens: 500 },
    });

    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });

    // A figure no source has goes with its sentence: nobody is left one to find.
    expect(brief.goal).toBe('');
    expect(JSON.stringify(brief)).not.toContain(NUMBER_PLACEHOLDER);
    // A lone digit is a count, as on a page.
    expect(brief.audience).toBe('Home baristas who drink 4 cups a day');
    expect(brief.outline).toEqual([
      {
        // A heading's number as a page's: "$500" is the prompt's; 12 goes on its own.
        heading: 'The best espresso machines under $500',
        keyPoints: [
          `${NAME_PLACEHOLDER} recommends a flat burr`,
          `${QUOTE_PLACEHOLDER} says the owner`,
          // The fan-out's number, a count and this year stay.
          'Machines under 500 dollars',
          'Compare 3 grinders',
          `The best machines of ${year}`,
        ],
        fanout: 'home espresso grinder',
        platform: 'copilot-web',
      },
    ]);
    // A keyword that adds one goes: a placeholder can't be searched for.
    expect(brief.keywords).toEqual(['espresso', 'espresso under 500']);
    expect(draftWrites().at(-1)).toEqual({
      table: 'content_drafts',
      op: 'update',
      value: { brief },
    });
  });

  it('writes the brief with Claude Haiku with an Anthropic key: structured output, a token cap, no sampling', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });

    expect(reserveAiBudget).toHaveBeenCalledWith('o1', {
      feature: 'content',
      modelId: HAIKU,
      draftId: DRAFT,
    });
    const call = generateObject.mock.calls[0][0];
    expect(call.model).toBe(`model:${HAIKU}`);
    expect(call.maxOutputTokens).toBe(16_000);
    expect(call.providerOptions).toEqual({ anthropic: { structuredOutputMode: 'outputFormat' } });
    for (const key of ['temperature', 'topP', 'topK']) expect(call).not.toHaveProperty(key);
    // A schema Claude takes: none of the keywords it turns away.
    expect(call.schema.jsonSchema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(JSON.stringify(call.schema.jsonSchema)).not.toMatch(
      /"(\$schema|maxItems|maxLength|minLength|minimum|maximum)"/,
    );
  });

  it('writes the brief from the kept sources, charges AI usage, and saves it on the draft', async () => {
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });

    expect(reserveAiBudget).toHaveBeenCalledWith('o1', {
      feature: 'content',
      modelId: GEMINI,
      draftId: DRAFT,
    });
    const call = generateObject.mock.calls[0][0];
    expect(call.model).toBe(`model:${GEMINI}`);
    // Another provider's call is sent as it was: no token cap, no provider options.
    expect(call).not.toHaveProperty('maxOutputTokens');
    expect(call).not.toHaveProperty('providerOptions');
    expect(call.prompt).toContain('- Best espresso machines under $500?');
    expect(call.prompt).toContain(
      '"Best espresso machine under 500" (perplexity-web, copilot-web)',
    );
    expect(call.prompt).toContain('Existing page to improve: https://acme.example/guides/espresso');
    expect(call.prompt).toContain('- Choosing a machine');
    expect(call.prompt).toContain('Write the brief in Turkish.');

    expect(brief).toMatchObject({
      goal: 'Help buyers pick',
      audience: 'Home baristas',
      keywords: ['espresso', 'grinder'],
      origin: 'rebuild',
      builtFrom: { prompts: 1, fanouts: 2, pages: 1, queries: 1 },
      // The cited pages' length (CE-030), read without the draft's own page.
      citedLength: { characters: 4300, pages: 1 },
    });
    expect(citedPagesLength).toHaveBeenCalledWith({
      brandId: BRAND,
      pages: [{ url: 'https://www.reddit.com/r/espresso/x', kind: 'forum' }],
      ownUrl: 'https://acme.example/guides/espresso',
      // The run's Stop ends the reads at once.
      signal: expect.any(AbortSignal),
    });
    expect(brief.outline).toEqual([
      {
        heading: 'The best espresso machines under $500',
        keyPoints: ['Price bands'],
        fanout: 'Best espresso machine under 500',
        platform: 'copilot-web',
      },
      // A platform that didn't run the search: the one that did.
      {
        heading: 'Grinders',
        keyPoints: ['Burr vs blade'],
        fanout: 'home espresso grinder',
        platform: 'copilot-web',
      },
      // A search the person didn't keep: none.
      { heading: 'Care', keyPoints: [], fanout: null, platform: null },
    ]);

    expect(draftWrites()).toEqual([
      {
        table: 'prompt_improve_usage',
        op: 'insert',
        value: expect.objectContaining({
          organization_id: 'o1',
          content_draft_id: DRAFT,
          feature: 'content',
          input_tokens: 1000,
        }),
      },
      { table: 'content_drafts', op: 'update', value: { brief } },
    ]);
    // Only the brand's prompts are read.
    expect(filters.find((f) => f.table === 'prompts').filters).toEqual([
      ['in', 'id', [PROMPT]],
      ['eq', 'prompt_sets.brand_id', BRAND],
    ]);
  });

  /** What the cited pages have (learning C2), read with their length, kept on the brief. */
  it('keeps what the cited pages have beside their length', async () => {
    const features = { pages: 2, checks: [{ key: 'faq-schema', label: 'FAQ schema', pages: 2 }] };
    citedPagesLength.mockResolvedValue({ characters: 4300, pages: 2, features });
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(brief.citedLength).toEqual({ characters: 4300, pages: 2 });
    expect(brief.citedFeatures).toEqual(features);

    citedPagesLength.mockResolvedValue(null);
    const none = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(none.citedLength).toBeNull();
    expect(none).not.toHaveProperty('citedFeatures');
  });

  it('refuses a draft of another brand before any model call', async () => {
    rows.content_drafts = {
      ...rows.content_drafts,
      brand_id: '44444444-4444-4444-4444-444444444444',
    };
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toMatchObject({
      status: 404,
    });
    rows.content_drafts = null;
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('needs a prompt, a fan-out or a query to build from', async () => {
    rows.prompts = [];
    await expect(
      rebuildDraftBrief({
        draftId: DRAFT,
        brandId: BRAND,
        sources: sources({ fanouts: [], queries: [] }),
      }),
    ).rejects.toMatchObject({ status: 422, code: 'no_sources' });
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('reads the prompts through their prompt set, so a prompt with no topic counts', async () => {
    await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(filters.find((call) => call.table === 'prompts').filters).toContainEqual([
      'eq',
      'prompt_sets.brand_id',
      BRAND,
    ]);
  });

  it('cuts the model’s answer to the limits the editor reads a brief with', async () => {
    generateObject.mockResolvedValue({
      object: {
        goal: 'g'.repeat(600),
        audience: 'Home baristas',
        outline: [
          { heading: '   ', keyPoints: ['Lost'], fanout: null, platform: null },
          {
            heading: 'h'.repeat(400),
            // Letters: a number the sources don't have would go as a placeholder.
            keyPoints: Array.from({ length: 10 }, (_, i) =>
              String.fromCharCode(97 + i).repeat(600),
            ),
            fanout: null,
            platform: null,
          },
          ...Array.from({ length: 14 }, (_, i) => ({
            heading: `Section ${String.fromCharCode(97 + i)}`,
            keyPoints: [],
            fanout: null,
            platform: null,
          })),
        ],
        keywords: Array.from(
          { length: 20 },
          (_, i) => `${String.fromCharCode(97 + i)}${'k'.repeat(90)}`,
        ),
      },
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(brief.goal).toHaveLength(500);
    // The empty heading went; the rest is capped at 12 sections.
    expect(brief.outline).toHaveLength(12);
    expect(brief.outline[0].heading).toHaveLength(300);
    expect(brief.outline[0].keyPoints).toHaveLength(8);
    expect(brief.outline[0].keyPoints.every((p) => p.length === 500)).toBe(true);
    expect(brief.keywords).toHaveLength(15);
    expect(brief.keywords.every((k) => k.length <= 80)).toBe(true);
  });

  it('saves nothing once stopped, and says so (CE-027)', async () => {
    const { RunStoppedError } = await import('./contentRuns.js');
    stopIfStopped.mockRejectedValueOnce(new RunStoppedError());
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toMatchObject({ status: 409, code: 'stopped' });
    // The call was made and charged; the brief stays as it was.
    expect(draftWrites().filter((w) => w.table === 'content_drafts')).toEqual([]);
  });

  it('charges a call whose answer didn’t fit, then fails', async () => {
    generateObject.mockRejectedValue(
      Object.assign(new NoObjectGeneratedError('no object'), {
        usage: { inputTokens: 900, outputTokens: 300 },
      }),
    );
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toBeInstanceOf(NoObjectGeneratedError);
    expect(draftWrites()).toEqual([
      expect.objectContaining({
        table: 'prompt_improve_usage',
        op: 'insert',
        value: expect.objectContaining({ input_tokens: 900, output_tokens: 300 }),
      }),
    ]);
  });

  it('lets the hold on the budget go when the model times out', async () => {
    const held = { charge: vi.fn(), release: vi.fn() };
    reserveAiBudget.mockResolvedValueOnce(held);
    generateObject.mockRejectedValue(new Error('timeout'));
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toThrow('timeout');
    expect(held.charge).not.toHaveBeenCalled();
    expect(held.release).toHaveBeenCalled();
  });

  it('stops when the AI usage budget is spent', async () => {
    reserveAiBudget.mockRejectedValue(new PlanLimitError('used up', 429));
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(generateObject).not.toHaveBeenCalled();
    expect(draftWrites()).toEqual([]);
  });
});

describe('rebuildSources', () => {
  it('cuts long text and drops empty items rather than refusing the rebuild', () => {
    const parsed = rebuildSources.parse(
      sources({
        headings: ['x'.repeat(400), '   ', 'Care'],
        queries: [' espresso ', ''],
        fanouts: [{ query: 'q'.repeat(350), platforms: ['p'.repeat(70)] }],
      }),
    );
    expect(parsed.headings).toEqual(['x'.repeat(300), 'Care']);
    expect(parsed.queries).toEqual(['espresso']);
    expect(parsed.fanouts[0].query).toHaveLength(300);
    expect(parsed.fanouts[0].platforms[0]).toHaveLength(60);
  });

  it('brings the length into the range a rebuild takes', () => {
    expect(rebuildSources.parse(sources({ length: 50 })).length).toBe(100);
    expect(rebuildSources.parse(sources({ length: 60_000 })).length).toBe(50_000);
  });
});

describe('briefRules', () => {
  it('reads the rules as Fix sends them, cut to fit, a rule without a detail too', () => {
    expect(
      briefRules.parse([
        { key: 'faq', name: 'FAQ' },
        { key: 'h2Answer', name: 'n'.repeat(250), detail: 'd'.repeat(600) },
      ]),
    ).toEqual([
      { key: 'faq', name: 'FAQ', detail: '' },
      { key: 'h2Answer', name: 'n'.repeat(200), detail: 'd'.repeat(500) },
    ]);
    expect(briefRules.safeParse(Array(61).fill({ key: 'faq', name: 'FAQ' })).success).toBe(false);
  });
});

describe('the brief guard', () => {
  const guardFor = (over = {}) =>
    briefGuard({
      brand: { name: 'Acme 24', industry: null, description: 'Roasting since 1998' },
      draft: { title: 'The 2019 espresso guide' },
      prompts: ['Who is Ada Lovelace?'],
      sources: sources({ headings: ['Our 7-day trial'] }),
      ...over,
    });

  it('knows what the brief was built from: the brand, the page, its sources and the length', () => {
    const guard = guardFor();
    for (const text of [
      'Acme 24 has roasted since 1998',
      'Update the 2019 guide',
      'Keep the 7-day trial',
      'About 3,000 characters',
      'Machines under 500',
      'Ask Ada Lovelace',
    ]) {
      expect(guard.text(text)).toBe(text);
    }
  });

  it('takes out a figure it adds with its sentence, a person as a placeholder, and drops a keyword that adds one', () => {
    const guard = guardFor();
    expect(guard.text('Prices rose 40% in 2021')).toBe('');
    expect(guard.text('Prices rose 40% in 2021. Compare the plans.')).toBe('Compare the plans.');
    expect(guard.heading('Prices in 2021, plan by plan')).toBe('Prices in, plan by plan');
    expect(guard.heading('Why CEO Grace Hopper chose Acme')).toBe(
      'Why CEO Grace Hopper chose Acme',
    );
    expect(guard.text('Ask CEO Grace Hopper')).toBe(`Ask CEO ${NAME_PLACEHOLDER}`);
    expect(guard.keeps('espresso under 500')).toBe(true);
    expect(guard.keeps('espresso 2021')).toBe(false);
    expect(guard.text(null)).toBe('');
  });

  it('reads names in a heading by their honorific, and drops a keyword that names someone', () => {
    const guard = guardFor();
    expect(guard.heading('Why Dr. Jane Doe pulls short shots')).toBe(
      `Why ${NAME_PLACEHOLDER} pulls short shots`,
    );
    expect(guard.keeps('Dr. Jane Doe espresso')).toBe(false);
  });

  it('leaves a question in quotes alone: it is one to answer, not a quote', () => {
    const guard = guardFor();
    expect(guard.text('Answer "Which espresso machine should I buy first?" up top')).toBe(
      'Answer "Which espresso machine should I buy first?" up top',
    );
    expect(guard.text('Quote “Pressure matters far more than price for beginners”')).toBe(
      `Quote ${QUOTE_PLACEHOLDER}`,
    );
  });

  it('reads Turkish percentages as the writer does', () => {
    const guard = guardFor({ prompts: ['Espresso makinelerinde %25 indirim var mı?'] });
    expect(guard.text('%25 indirimi anlat')).toBe('%25 indirimi anlat');
    expect(guard.text('Satışlar yüzde 40 arttı')).toBe('');
  });
});

describe('the brief\u2019s cut', () => {
  it('never splits a placeholder: one the cut would reach goes whole', () => {
    const [section] = mapOutline(
      [
        {
          heading: 'Heading',
          keyPoints: [`${'a'.repeat(490)} ${NUMBER_PLACEHOLDER}`],
          fanout: null,
          platform: null,
        },
      ],
      [],
    );
    expect(section.keyPoints).toEqual(['a'.repeat(490)]);
  });
});

describe('the brief prompt', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('says a new page is new, and lists none where a source is empty', () => {
    const prompt = buildBriefPrompt({
      brand: { name: 'Acme', language: 'en' },
      draft: { title: 'Grinders', page_type: null, method: 'create', source_url: null },
      prompts: [],
      sources: sources({ fanouts: [], pages: [], queries: ['burr grinder'], headings: [] }),
    });
    expect(prompt).toContain('A new page.');
    expect(prompt).toContain('Page type: not set');
    expect(prompt).toContain('Prompts the page must answer:\n- none');
    expect(prompt).toContain('- burr grinder');
    expect(prompt).not.toContain('headings now');
    expect(prompt).toContain('Write the brief in English.');
  });

  it('names the brand’s site type once Quality’s phase 2 is live (CE-056)', () => {
    const draft = { title: 'Rain jackets', page_type: null, method: 'create', source_url: null };
    const read = (phase) => {
      vi.stubEnv('CONTENT_QUALITY_PHASE', phase);
      return buildBriefPrompt({
        brand: { name: 'Acme', industry: 'Fashion & Apparel', language: 'en' },
        draft,
        prompts: [],
        sources: sources({ fanouts: [], pages: [], queries: [], headings: [] }),
      });
    };
    expect(read('2')).toContain(
      'Industry: Fashion & Apparel\nSite type: E-commerce (an online shop selling products)\nDescription:',
    );
    expect(read('1')).toContain('Industry: Fashion & Apparel\nDescription:');
  });

  it('matches a fan-out copied in its quotes, one written as listed first', () => {
    const fanouts = [
      { query: 'best crm', platforms: ['chatgpt'] },
      { query: '"best crm"', platforms: ['copilot-web'] },
      { query: 'crm for startups', platforms: ['perplexity-web'] },
    ];
    const section = (fanout) => ({ heading: 'H', keyPoints: [], fanout, platform: null });
    expect(
      mapOutline(
        [section('"best crm"'), section('best crm'), section('“crm for startups”')],
        fanouts,
      ).map((s) => s.fanout),
    ).toEqual(['"best crm"', 'best crm', 'crm for startups']);
  });

  it('maps an outline with no fan-outs kept to none', () => {
    expect(mapOutline(outline.slice(0, 1), [])).toEqual([
      {
        heading: 'The best espresso machines under $500',
        keyPoints: ['Price bands'],
        fanout: null,
        platform: null,
      },
    ]);
  });
});

describe('the brief rules (2026), behind CONTENT_BRIEF_RULES', () => {
  afterEach(() => {
    delete process.env.CONTENT_BRIEF_RULES;
    vi.unstubAllEnvs();
  });

  it('asks as before while they are off: the same rules, schema and prompt', async () => {
    await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources(), rules: RULES });
    const call = generateObject.mock.calls[0][0];
    expect(call.system).toBe(SYSTEM_PROMPT);
    expect(call.schema).toBe(outlineSchema);
    expect(call.prompt).not.toMatch(/\bS\d+: /);
    expect(call.prompt).not.toContain('Its sections lean to');
    expect(call.prompt).not.toContain('Rules the page is written to');
    const brief = writes.find((w) => w.table === 'content_drafts')?.value.brief;
    expect(brief).not.toHaveProperty('version');
    expect(brief.outline[0]).not.toHaveProperty('answer');
  });

  it('asks for each section’s answer, format and facts, with the cited pages numbered and the rules', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    generateObject.mockResolvedValue({
      object: { goal: 'g', audience: 'a', outline: [], keywords: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources(), rules: RULES });
    const call = generateObject.mock.calls[0][0];
    expect(call.system).toBe(SYSTEM_PROMPT_V2);
    expect(call.schema).toBe(outlineSchemaV2);
    // The cited pages by number; a prompt, a fan-out or a query is a question, not a source.
    expect(call.prompt).toContain('- S1: https://www.reddit.com/r/espresso/x (forum)');
    expect(call.prompt).toContain('- Best espresso machines under $500?');
    expect(call.prompt).toContain('- "Best espresso machine under 500"');
    expect(call.prompt).not.toContain('S2');
    expect(call.prompt).toContain(
      'Its sections lean to: a list of the criteria, and a table of the picks.',
    );
    expect(call.prompt).toContain(
      'Rules the page is written to:\n- Answer under each H2: aim: 60 words',
    );
  });

  it('keeps each section’s plan, cut and guarded as the rest, its facts’ sources by kind and ref', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    const fact = (over) => ({
      claim: 'Average price of a machine',
      sourceType: 'statistic',
      source: 'S1',
      ...over,
    });
    generateObject.mockResolvedValue({
      object: {
        goal: 'Help buyers pick',
        audience: 'Home baristas',
        outline: [
          {
            heading: 'The best espresso machines under $500',
            keyPoints: ['Price bands'],
            // Copied with the quotes it was listed in.
            fanout: '“Best espresso machine under 500”',
            platform: 'copilot-web',
            answer: 'Say that 73% of buyers pick a single boiler (S1), in 60 words.',
            format: 'carousel',
            facts: [
              fact(),
              fact({ sourceType: 'rumour' }),
              fact({ claim: '41% of baristas say so [S1]', sourceType: 'Study', source: 'S99' }),
              fact({ source: 's1' }),
              // S2 isn't a page: a fan-out is a question, not a source.
              fact({ source: 'S2' }),
              fact({ claim: ' ' }),
              fact(),
            ],
          },
          {
            heading: 'Grinders (S1)',
            // Only the numbers given go: a name with one stays.
            keyPoints: ['Burr vs blade [S1]', 'Model (S23) grinders'],
            fanout: null,
            platform: null,
            answer: null,
            format: ' Table ',
            facts: [],
          },
        ],
        keywords: ['espresso'],
      },
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    const brief = await rebuildDraftBrief({
      draftId: DRAFT,
      brandId: BRAND,
      sources: sources(),
      rules: RULES,
    });
    expect(brief.version).toBe(2);
    const [section, second] = brief.outline;
    expect(section.fanout).toBe('Best espresso machine under 500');
    // A figure of its own takes its sentence with it: the answer had no other.
    expect(section.answer).toBeNull();
    // A format the web doesn't know: none; one it knows, as it lists it.
    expect(section.format).toBeNull();
    expect(second).toMatchObject({
      heading: 'Grinders',
      keyPoints: ['Burr vs blade', 'Model (S23) grinders'],
      format: 'table',
    });
    const page = {
      kind: 'cited_page',
      ref: 'https://www.reddit.com/r/espresso/x',
      label: 'https://www.reddit.com/r/espresso/x',
    };
    expect(section.facts).toEqual([
      { claim: 'Average price of a machine', sourceType: 'statistic', source: page },
      // A number the data doesn't have: the claim goes, and with it the fact.
      { claim: 'Average price of a machine', sourceType: 'statistic', source: page },
      { claim: 'Average price of a machine', sourceType: 'statistic', source: null },
      // So the last one fits under the cap.
      { claim: 'Average price of a machine', sourceType: 'statistic', source: page },
    ]);
    expect(section.facts.length).toBeLessThanOrEqual(BRIEF_V2_LIMITS.facts);
  });

  it('holds the model to the format and source keys, without failing a call on one off the list', () => {
    // The JSON schema the model is given, as the AI SDK writes it.
    const json = z.toJSONSchema(outlineSchemaV2, { target: 'draft-7', io: 'input' });
    const section = json.properties.outline.items.properties;
    expect(section.format.anyOf).toEqual([
      { type: 'string', enum: BRIEF_FORMATS },
      { type: 'null' },
    ]);
    expect(section.facts.items.properties.sourceType.enum).toEqual(FACT_SOURCES);
    expect(json.properties.proof.items.properties.kind.enum).toEqual(PROOF_KINDS);
    expect(SYSTEM_PROMPT_V2).toContain('write them as listed, in English');
    // A model that writes "Table" or a translated key still answers: read by key afterwards.
    const read = outlineSchemaV2.safeParse({
      goal: 'g',
      audience: 'a',
      tldr: null,
      angle: null,
      proof: [{ kind: 'Fallstudie', what: 'w' }],
      leftOut: [],
      datedPoint: null,
      products: [],
      competitors: [],
      links: { internal: [], outbound: [] },
      outline: [
        {
          heading: 'h',
          keyPoints: [],
          fanout: null,
          platform: null,
          answer: null,
          format: 'Tablo',
          facts: [{ claim: 'c', sourceType: 'Statistic', source: null }],
        },
      ],
      keywords: [],
    });
    expect(read.success).toBe(true);
  });

  it('plans the page: its essentials, angle, proof to gather, fan-outs left out and freshness', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        tldr: 'Say which machine wins for 73% of home baristas (S1).',
        angle: ' Our own side-by-side pull tests. ',
        proof: [
          { kind: 'Test', what: 'Shot times on each machine' },
          { kind: 'rumour', what: 'What people say' },
          { kind: 'case', what: ' ' },
          { kind: 'data', what: 'Returns by model' },
        ],
        leftOut: [
          '“home espresso grinder”',
          'Best espresso machine under 500',
          'made up search',
          'home espresso grinder',
        ],
        datedPoint: 'Each price, with its month',
        outline: [
          {
            heading: 'The best espresso machines under $500',
            keyPoints: [],
            fanout: 'Best espresso machine under 500',
            platform: null,
            answer: null,
            format: null,
            facts: [],
          },
        ],
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(brief).toMatchObject({
      version: 2,
      // Guarded and cut as the rest: a figure it wasn't given goes with its sentence.
      tldr: null,
      angle: 'Our own side-by-side pull tests.',
      // Kinds the web knows, read by key; none left empty.
      proof: [
        { kind: 'test', what: 'Shot times on each machine' },
        { kind: 'data', what: 'Returns by model' },
      ],
      // Fan-outs the person kept that no H2 answers, as listed, each once.
      leftOut: ['home espresso grinder'],
      // A buying guide dates: an "Updated" line and the year in its title.
      freshness: { datedPoint: 'Each price, with its month', updatedLine: true, yearInTitle: true },
    });
  });

  it('plans no freshness for a page that doesn’t date and names nothing to date', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    rows.content_drafts.page_type = 'feature_page';
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        tldr: null,
        angle: null,
        proof: [],
        leftOut: [],
        datedPoint: null,
        outline: [],
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(brief).toMatchObject({ version: 2, tldr: null, angle: null, proof: [], leftOut: [] });
    expect(brief.freshness).toBeNull();
  });

  it('numbers the person’s input after the cited pages, for the facts’ sources, and knows its words', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
    rows.content_draft_inputs = {
      experience: 'We pulled 40 shots on each machine.',
      data: [
        {
          name: 'Returns by model',
          rows: [
            ['Model', 'Returns'],
            ['Bambino', '4.2%'],
          ],
        },
      ],
      getcito_data: [],
      quotes: [],
    };
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        tldr: 'The Bambino had 4.2% returns.',
        angle: null,
        proof: [{ kind: 'experience', what: 'The 40 shots we pulled' }],
        leftOut: [],
        datedPoint: null,
        outline: [
          {
            heading: 'Machines',
            keyPoints: [],
            fanout: null,
            platform: null,
            answer: null,
            format: null,
            facts: [{ claim: 'Returns by model', sourceType: 'statistic', source: 'S3' }],
          },
        ],
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    const prompt = generateObject.mock.calls[0][0].prompt;
    expect(prompt).toContain('- S1: https://www.reddit.com/r/espresso/x (forum)');
    expect(prompt).toContain(
      'The person\'s own input for this page (Brief › Your input):\n- S2 "We pulled 40 shots on each machine.": Their experience, first-hand',
    );
    expect(prompt).toContain('- S3 "Returns by model": Their own data, a table');
    // Their figures are given: kept, not placeholders.
    expect(brief.tldr).toBe('The Bambino had 4.2% returns.');
    expect(brief.proof).toEqual([{ kind: 'experience', what: 'The 40 shots we pulled' }]);
    expect(brief.outline[0].facts[0].source).toEqual({
      kind: 'input',
      ref: 'data:1',
      label: 'Returns by model',
    });
  });

  it('names the brand, its competitors as listed and its products as the data writes them, and links to the pages listed only', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    rows.competitors = [{ name: 'Acme Rival' }, { name: ' ' }];
    readLinkTargets.mockResolvedValue({
      own: [
        { url: 'https://acme.example/guides/grinders', title: 'Grinder guide' },
        ...Array.from({ length: 14 }, (_, i) => ({
          url: `https://acme.example/p/${i}`,
          title: `Page ${i}`,
        })),
      ],
      sources: [{ url: 'https://sca.example/brew', title: 'SCA brew' }],
    });
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        tldr: null,
        angle: null,
        proof: [],
        leftOut: [],
        datedPoint: null,
        products: ['bambino plus', 'Made Up 3000', 'Acme Coffee', 'acme rival', 'Bambino Plus'],
        competitors: ['acme rival', 'Unknown Co'],
        links: {
          internal: [
            {
              url: 'https://acme.example/guides/grinders/?utm_source=x',
              anchor: 'our grinder guide',
              section: 'grinders',
            },
            { url: 'https://made-up.example/x', anchor: 'made up', section: null },
            { url: 'https://acme.example/guides/grinders', anchor: 'again', section: null },
          ],
          outbound: [
            { url: 'https://sca.example/brew', anchor: '73% of baristas agree', section: 'Nope' },
            { url: 'https://acme.example/p/13', anchor: 'not a source', section: null },
          ],
        },
        outline: [
          {
            heading: 'Grinders',
            keyPoints: [],
            fanout: null,
            platform: null,
            answer: null,
            format: null,
            facts: [],
          },
        ],
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({
      draftId: DRAFT,
      brandId: BRAND,
      sources: sources({ headings: ['Breville Bambino Plus vs Gaggia Classic'] }),
    });
    expect(readLinkTargets).toHaveBeenCalledWith({
      brandId: BRAND,
      draftId: DRAFT,
      sourceUrl: 'https://acme.example/guides/espresso',
      ruleKeys: new Set(['internalLinks', 'outboundLinks']),
    });
    const prompt = generateObject.mock.calls[0][0].prompt;
    expect(prompt).toContain('Competitors (names as written): Acme Rival\n');
    expect(prompt).toContain(
      "The brand's pages to link to:\n- Grinder guide — https://acme.example/guides/grinders",
    );
    expect(prompt).toContain('Sources to link to and cite:\n- SCA brew — https://sca.example/brew');
    // Twelve of the brand's pages at most: the most cited first.
    expect(prompt).toContain('Page 10 — ');
    expect(prompt).not.toContain('Page 11 — ');
    expect(brief.entities).toEqual({
      brand: 'Acme Coffee',
      // As the data writes it, once; none made up, never the brand's or a competitor's.
      products: ['Bambino Plus'],
      competitors: ['Acme Rival'],
    });
    expect(brief.links).toEqual({
      // A page listed, by its address as listed, in the H2 the outline has.
      internal: [
        {
          url: 'https://acme.example/guides/grinders',
          anchor: 'our grinder guide',
          section: 'Grinders',
        },
      ],
      // Words that came back with a placeholder aren't linked; a source as an internal link isn't one.
      outbound: [],
    });
  });

  it('takes a product only from the brand’s own words, as written there, and caps each list', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
    rows.brands.name = null;
    rows.competitors = new Error('down');
    rows.content_draft_inputs = {
      experience: 'We tune every Barista Pro before it ships.',
      data: [],
      getcito_data: [],
      quotes: [],
    };
    const page = (i, host) => ({
      url: `https://${host}.example/${i}`,
      title: `T${i}${'x'.repeat(200)}`,
    });
    readLinkTargets.mockResolvedValue({
      own: [
        { url: `https://acme.example/${'p'.repeat(2100)}`, title: 'Too long an address' },
        ...Array.from({ length: 14 }, (_, i) => page(i, 'acme')),
      ],
      sources: Array.from({ length: 10 }, (_, i) => page(i, 'sca')),
    });
    const link = (host) => (_, i) => ({
      url: `https://${host}.example/${i}`,
      anchor: `words ${i}`,
      section: null,
    });
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        tldr: null,
        angle: null,
        proof: [],
        leftOut: [],
        datedPoint: null,
        // "ChatGPT" is a prompt's, "FAQ" a rule's: neither the brand's.
        products: [
          'barista pro',
          'C++ SDK',
          'ChatGPT',
          'FAQ',
          ...Array.from({ length: 12 }, (_, i) => `Kit ${i}`),
        ],
        competitors: [],
        links: {
          internal: Array.from({ length: 12 }, link('acme')),
          outbound: Array.from({ length: 8 }, link('sca')),
        },
        outline: [],
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({
      draftId: DRAFT,
      brandId: BRAND,
      sources: sources({
        headings: [`The C++ SDK, ${Array.from({ length: 12 }, (_, i) => `Kit ${i}`).join(', ')}`],
      }),
      rules: [{ key: 'faq', name: 'FAQ', detail: '' }],
    });
    const prompt = generateObject.mock.calls[0][0].prompt;
    // A failed read of the competitors: none listed, the rebuild goes on.
    expect(prompt).not.toContain('Competitors');
    // An address the web can't keep isn't offered; titles are cut; 12 and 8 pages at most.
    expect(prompt).not.toContain('Too long an address');
    expect(prompt).toContain(`T0${'x'.repeat(148)} — https://acme.example/0`);
    expect(prompt).toContain('https://acme.example/11');
    expect(prompt).not.toContain('https://acme.example/12');
    expect(prompt).toContain('https://sca.example/7');
    expect(prompt).not.toContain('https://sca.example/8');
    expect(brief.entities.brand).toBe('');
    expect(brief.entities.products).toEqual([
      'Barista Pro',
      'C++ SDK',
      ...Array.from({ length: 8 }, (_, i) => `Kit ${i}`),
    ]);
    expect(brief.links.internal).toHaveLength(BRIEF_V2_LIMITS.internalLinks);
    expect(brief.links.outbound).toHaveLength(BRIEF_V2_LIMITS.outboundLinks);
  });

  it('reads no competitors and no pages to link to while the brief rules are off', async () => {
    rows.competitors = [{ name: 'Acme Rival' }];
    await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(readLinkTargets).not.toHaveBeenCalled();
    expect(filters.some((f) => f.table === 'competitors')).toBe(false);
    expect(generateObject.mock.calls[0][0].prompt).not.toContain('Competitors');
  });

  it('reads no input while the brief rules are off', async () => {
    vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
    rows.content_draft_inputs = {
      experience: 'We pulled 40 shots.',
      data: [],
      getcito_data: [],
      quotes: [],
    };
    await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(filters.some((f) => f.table === 'content_draft_inputs')).toBe(false);
    expect(generateObject.mock.calls[0][0].prompt).not.toContain('Your input');
  });

  it('leaves version 1’s words as they were: numbers aren’t taken out, the rules aren’t known', async () => {
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        outline: [
          {
            heading: 'Machines',
            keyPoints: ['Price bands (S1)', 'Answer in 60 words'],
            fanout: null,
            platform: null,
          },
        ],
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({
      draftId: DRAFT,
      brandId: BRAND,
      sources: sources(),
      rules: RULES,
    });
    // Without the rules, their 60 is no number it was given: the key point goes.
    expect(brief.outline[0].keyPoints).toEqual(['Price bands (S1)']);
  });

  it('fits the brief under the column’s 64 KB: sources go first, then facts', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    const long = 'https://www.reddit.com/r/espresso/' + 'x'.repeat(2000);
    const section = (i) => ({
      heading: `Machines ${String.fromCharCode(97 + i)}`,
      keyPoints: [],
      fanout: null,
      platform: null,
      answer: null,
      format: null,
      facts: Array(4).fill({ claim: 'c'.repeat(300), sourceType: 'study', source: 'S1' }),
    });
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        outline: Array.from({ length: 12 }, (_, i) => section(i)),
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({
      draftId: DRAFT,
      brandId: BRAND,
      sources: sources({ pages: [{ url: long, kind: 'forum' }] }),
    });
    expect(Buffer.byteLength(JSON.stringify(brief))).toBeLessThan(64_000);
    expect(brief.outline[0].facts).toHaveLength(4);
    expect(brief.outline.every((s) => s.facts.every((f) => f.source === null))).toBe(true);
  });

  it('lets the links go first, when that is enough to fit', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    const long = (i) => `https://acme.example/${'p'.repeat(1900)}/${i}`;
    readLinkTargets.mockResolvedValue({
      own: Array.from({ length: 8 }, (_, i) => ({ url: long(i), title: `P${i}` })),
      sources: [],
    });
    const section = (i) => ({
      heading: `Machines ${String.fromCharCode(97 + i)}`,
      keyPoints: [],
      fanout: null,
      platform: null,
      answer: '中'.repeat(600),
      format: null,
      // Two bytes a character: with the links past the limit, without them under it.
      facts: Array(4).fill({ claim: 'é'.repeat(300), sourceType: 'study', source: null }),
    });
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        tldr: null,
        angle: null,
        proof: [],
        leftOut: ['home espresso grinder'],
        datedPoint: null,
        products: [],
        competitors: [],
        links: {
          internal: Array.from({ length: 8 }, (_, i) => ({
            url: long(i),
            anchor: 'a'.repeat(120),
            section: null,
          })),
          outbound: [],
        },
        outline: Array.from({ length: 12 }, (_, i) => section(i)),
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(Buffer.byteLength(JSON.stringify(brief))).toBeLessThan(64_000);
    expect(brief.links).toBeNull();
    expect(brief.leftOut).toEqual(['home espresso grinder']);
    expect(brief.outline[0].facts).toHaveLength(4);
  });

  it('lets the fan-outs left out go first, when that is enough to fit', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    const long = 'https://www.reddit.com/r/espresso/' + 'x'.repeat(2000);
    const queries = Array.from({ length: 20 }, (_, i) =>
      `${String.fromCharCode(97 + i)} `.repeat(150),
    );
    const section = (i) => ({
      heading: `Machines ${String.fromCharCode(97 + i)}`,
      keyPoints: [],
      fanout: null,
      platform: null,
      answer: null,
      format: null,
      facts: Array(4).fill({ claim: 'c'.repeat(300), sourceType: 'study', source: 'S1' }),
    });
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        tldr: null,
        angle: null,
        proof: [],
        leftOut: queries,
        datedPoint: null,
        outline: Array.from({ length: 5 }, (_, i) => section(i)),
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({
      draftId: DRAFT,
      brandId: BRAND,
      sources: sources({
        pages: [{ url: long, kind: 'forum' }],
        fanouts: queries.map((query) => ({ query: query.trim(), platforms: ['chatgpt'] })),
      }),
    });
    expect(Buffer.byteLength(JSON.stringify(brief))).toBeLessThan(64_000);
    expect(brief.leftOut).toEqual([]);
    expect(brief.outline[0].facts[0].source).toMatchObject({ kind: 'cited_page', ref: long });
  });

  it('lets the facts go too when the brief is still too big without their sources', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    // Three bytes a character: the answers fit, the facts don't beside them.
    const section = (i) => ({
      heading: `Machines ${String.fromCharCode(97 + i)}`,
      keyPoints: [],
      fanout: null,
      platform: null,
      answer: '中'.repeat(600),
      format: null,
      facts: Array(4).fill({ claim: '中'.repeat(300), sourceType: 'study', source: null }),
    });
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        outline: Array.from({ length: 12 }, (_, i) => section(i)),
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(Buffer.byteLength(JSON.stringify(brief))).toBeLessThan(64_000);
    expect(brief.outline).toHaveLength(12);
    expect(brief.outline.every((s) => s.facts.length === 0)).toBe(true);
    expect(brief.outline[0].answer).toHaveLength(BRIEF_V2_LIMITS.answer);
  });

  it('cuts a long answer and claim to the web’s limits, never splitting a placeholder', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        outline: [
          {
            heading: 'Machines',
            keyPoints: [],
            fanout: null,
            platform: null,
            answer: 'a'.repeat(700),
            format: 'table',
            facts: [{ claim: 'c'.repeat(400), sourceType: 'study', source: null }],
          },
        ],
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(brief.outline[0].answer).toHaveLength(BRIEF_V2_LIMITS.answer);
    expect(brief.outline[0].format).toBe('table');
    expect(brief.outline[0].facts[0].claim).toHaveLength(BRIEF_V2_LIMITS.claim);
  });

  // The web's reading of version 2 (frontend/src/lib/content/brief.ts, #1539): read
  // here so the two can't drift apart unseen; skipped until the web has it.
  const webBrief = new URL('../../../frontend/src/lib/content/brief.ts', import.meta.url);
  const webText = existsSync(webBrief) ? readFileSync(webBrief, 'utf8') : '';
  const webHasV2 = webText.includes('BRIEF_V2_LIMITS');
  it.skipIf(!webHasV2)('writes version 2 to the web’s limits, kinds and sample', () => {
    const limits = webText.match(/export const BRIEF_V2_LIMITS = \{([\s\S]*?)\} as const/)[1];
    const limit = (key) => Number(limits.match(new RegExp(`\\b${key}: (\\d+)`))[1]);
    for (const key of Object.keys(BRIEF_V2_LIMITS)) {
      expect(BRIEF_V2_LIMITS[key], key).toBe(limit(key));
    }
    const kinds = (name) =>
      [
        ...webText
          .match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))[1]
          .matchAll(/'([a-z_]+)'/g),
      ].map((m) => m[1]);
    expect(BRIEF_FORMATS).toEqual(kinds('BRIEF_FORMATS'));
    expect(FACT_SOURCES).toEqual(kinds('FACT_SOURCES'));
    expect(PROOF_KINDS).toEqual(kinds('PROOF_KINDS'));
    const sample = JSON.parse(
      readFileSync(
        new URL('../../../frontend/src/lib/content/__fixtures__/brief-v2.json', import.meta.url),
        'utf8',
      ),
    );
    for (const section of sample.outline) {
      expect(BRIEF_FORMATS).toContain(section.format);
      for (const f of section.facts) expect(FACT_SOURCES).toContain(f.sourceType);
    }
    // A fact's source is a kind the web keeps (sources.ts DRAFT_SOURCE_KINDS).
    const webSources = readFileSync(
      new URL('../../../frontend/src/lib/content/sources.ts', import.meta.url),
      'utf8',
    );
    const draftKinds = [
      ...webSources
        .match(/export const DRAFT_SOURCE_KINDS = \[([^\]]*)\]/)[1]
        .matchAll(/'([a-z_]+)'/g),
    ].map((m) => m[1]);
    // …and Brief › Your input, which a suggestion keeps as 'input' too.
    expect(webSources).toMatch(/SUGGESTION_SOURCE_KINDS = \[\.\.\.DRAFT_SOURCE_KINDS, 'input'\]/);
    const inputs = [{ kind: 'input', ref: 'experience', label: 'We tested', detail: 'We tested' }];
    for (const n of briefNumbered(sources(), inputs)) {
      expect([...draftKinds, 'input']).toContain(n.kind);
    }
  });
});

describe('briefForWriter', () => {
  afterEach(() => {
    delete process.env.CONTENT_BRIEF_RULES;
  });
  // The web's sample of version 2 (frontend/src/lib/content/__fixtures__/brief-v2.json).
  const sample = JSON.parse(
    readFileSync(
      new URL('../../../frontend/src/lib/content/__fixtures__/brief-v2.json', import.meta.url),
      'utf8',
    ),
  );

  it('says nothing with the brief rules off, or for a brief before version 2', () => {
    expect(briefForWriter(sample)).toBe('');
    process.env.CONTENT_BRIEF_RULES = 'true';
    expect(briefForWriter({ ...sample, version: undefined })).toBe('');
  });

  it('gives the writer the plan: top, angle, sections, proof, scope, freshness, names, links', () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    const text = briefForWriter(sample);
    expect(text).toContain(`TL;DR (what the page's top must say): ${sample.tldr}`);
    expect(text).toContain(`Angle (what only this page shows): ${sample.angle}`);
    expect(text).toContain(
      `- ${sample.outline[0].heading} — answer first: ${sample.outline[0].answer}`,
    );
    // A table the writer can't make is a comparison set out point by point.
    expect(text).toContain('show as a comparison, the same points for each option in turn');
    // A fact the brief has no source for is looked up (contentResearch.js), never a placeholder.
    expect(text).toContain('(study, look it up with {{find: …}})');
    expect(text).toContain('(statistic, from Your input "Forecast error by month")');
    expect(text).toContain(
      'Proof to gather (write it only from Your input; else {{ask: …}}): data:',
    );
    expect(text).not.toContain('placeholder');
    expect(text).toContain(
      `Keep to one topic; these searches are for another page: ${sample.leftOut[0]}`,
    );
    expect(text).toContain('Freshness: date');
    expect(text).toContain('Names, written exactly so:');
    expect(text).toContain('Links planned (only as the links rule allows):');
    // Without the links: a new page's writer has no links rule.
    expect(briefForWriter(sample, { links: false })).not.toContain('Links planned');
    expect(briefForWriter(sample, { links: false })).toContain('Names, written exactly so:');
  });
});
