import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cheerio from 'cheerio';

const generateObject = vi.fn();
vi.mock('ai', () => ({ generateObject: (...args) => generateObject(...args) }));
vi.mock('../aiProvider.js', () => ({ resolveModel: () => ({}) }));
vi.mock('../retry.js', () => ({ withRetry: (fn) => fn() }));
const logger = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock('../logger.js', () => ({ logger, default: logger }));

const { brandFactsFor, generateRecommendations } = await import('./recommendations.js');
const { MAX_COPY_CHARS, sentencesOf } = await import('./recommendationGuard.js');

// The pricing page from the spec's bug report, cut down.
const html = `<html><head><title>GetCito pricing</title>
<meta name="description" content="Plans from $49 a month.">
<script type="application/ld+json">{"@type":"Offer","price":"249"}</script></head>
<body><h1>Pricing</h1><p>Starter $49 per month: 100 site audits. Growth: 500 site audits.</p></body></html>`;

const ctx = {
  url: 'https://getcito.com/pricing',
  $: cheerio.load(html),
  text: 'Pricing Starter $49 per month: 100 site audits. Growth: 500 site audits.',
  now: Date.UTC(2026, 9, 17),
};

const results = [
  { key: 'case-study-evidence', status: 'fail', evidence: { reason: 'No customer results' } },
  { key: 'faq-schema', status: 'warn', evidence: {} },
  { key: 'h1-quality', status: 'fail', evidence: {} },
  { key: 'https', status: 'fail', evidence: {} },
];

const brand = {
  name: 'GetCito',
  description: 'AI visibility platform',
  domains: ['getcito.com'],
};

const tooLong = `${'Show how each plan fits a team size, '.repeat(4)}and what it includes.`;

function modelReturns(...answers) {
  for (const recommendations of answers) {
    if (recommendations instanceof Error) generateObject.mockRejectedValueOnce(recommendations);
    else generateObject.mockResolvedValueOnce({ object: { recommendations } });
  }
}

const firstAnswer = [
  {
    signalKey: 'case-study-evidence',
    priority: 'medium',
    recommendation: 'Add one real customer result next to the plans.',
    draft: "Join brands like TechFlow. TechFlow saw a 34% increase in 'Recommended' citations.",
    code: null,
  },
  {
    signalKey: 'faq-schema',
    priority: 'high',
    recommendation: tooLong,
    draft: 'How much is Starter? Starter costs $49 a month.',
    code: '{"@type": "FAQPage", "mainEntity": [], "dateModified": "2024-03-01"}',
  },
  {
    signalKey: 'h1-quality',
    priority: 'high',
    recommendation: 'Use a descriptive H1 that says what the plans cover.',
    draft: 'GetCito pricing: AI visibility plans for every team size',
    code: null,
  },
  // Not a recommendable signal: dropped.
  { signalKey: 'https', priority: 'low', recommendation: 'Enable HTTPS.', draft: null, code: null },
];

beforeEach(() => {
  generateObject.mockReset();
  vi.clearAllMocks();
});

describe('generateRecommendations', () => {
  it('takes invented figures out, leaves the brand its own facts, rewrites the long item once and keeps the rest', async () => {
    modelReturns(firstAnswer, [
      {
        ref: '1',
        recommendation: 'Add an FAQ on plan prices with FAQPage markup.',
        draft: 'How much is Starter? Starter costs $49 a month.',
      },
    ]);

    const recs = await generateRecommendations(ctx, { results, brand, auditId: 'a1' });

    expect(recs.map((r) => r.signalKey)).toEqual([
      'case-study-evidence',
      'faq-schema',
      'h1-quality',
    ]);
    expect(recs[0]).toMatchObject({
      label: expect.any(String),
      category: 'eeat',
      // The customer is the brand's to name; the figure no page has goes with its sentence.
      draft: 'Join brands like [customer name].',
      code: null,
    });
    expect(recs[1]).toMatchObject({
      recommendation: 'Add an FAQ on plan prices with FAQPage markup.',
      draft: 'How much is Starter? Starter costs $49 a month.',
      // Code keeps its markup; only the invented date goes.
      code: '{"@type": "FAQPage", "mainEntity": [], "dateModified": "[date]"}',
    });
    expect(recs[2].draft).toBe('GetCito pricing: AI visibility plans for every team size');

    // The rewrite got only the long item, without its code.
    expect(generateObject).toHaveBeenCalledTimes(2);
    const rewritePrompt = generateObject.mock.calls[1][0].prompt;
    expect(rewritePrompt).toContain('"ref": "1"');
    expect(rewritePrompt).toContain('Show how each plan fits a team size');
    expect(rewritePrompt).not.toContain('Add one real customer result');
    expect(rewritePrompt).not.toContain('FAQPage", "mainEntity');

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ auditId: 'a1', facts: 5, tooLong: 1, rewritten: 1, cuts: 0 }),
      expect.any(String),
    );
  });

  it('gives the model the rules, the brand data and the page', async () => {
    modelReturns([]);
    await generateRecommendations(ctx, { results, brand });

    const { system, prompt } = generateObject.mock.calls[0][0];
    expect(system).toContain('Never invent customers');
    expect(system).toContain(`at most ${MAX_COPY_CHARS} characters`);
    // A fact anyone could look up is never left to the person; the brand's own may be, three at most.
    expect(system).toContain('is never a placeholder: write the sentence without it');
    expect(system).toContain('[your customer name], [your price], [your result]. At most 3');
    expect(system).not.toContain('[source URL]');
    expect(prompt).toContain('BRAND DATA');
    expect(prompt).toContain('- Name: GetCito');
    expect(prompt).toContain('- Description: AI visibility platform');
    expect(prompt).toContain('- Domains: getcito.com');
  });

  it("gives the model the brand's rules on any page it audits, and none without (00450)", async () => {
    modelReturns([]);
    await generateRecommendations(ctx, {
      results,
      brand: null,
      rules: ['No topics comparing us with a named competitor.'],
    });
    const { system, prompt } = generateObject.mock.calls[0][0];
    expect(system).toContain('When BRAND RULES are given, every recommendation');
    expect(prompt).toContain(
      "BRAND RULES (the brand's own; follow every one):\n- No topics comparing us with a named competitor.",
    );
    modelReturns([]);
    await generateRecommendations(ctx, { results, brand });
    expect(generateObject.mock.calls[1][0].prompt).not.toContain('BRAND RULES');
  });

  it('tells the model the page’s reading score and its aim, to rewrite it that way', async () => {
    modelReturns([]);
    await generateRecommendations(ctx, {
      results: [
        {
          key: 'readability',
          status: 'warn',
          evidence: { language: 'en', formula: 'flesch', readingScore: 86 },
        },
        {
          key: 'readability',
          status: 'warn',
          evidence: { language: 'tr', formula: 'atesman', readingScore: 42 },
        },
      ],
      brand,
    });
    const { system, prompt } = generateObject.mock.calls[0][0];
    expect(prompt).toContain('- readability [warn, impact: standard]');
    expect(prompt).toContain('| finding: Flesch Reading Ease 86 (language en; aim for 50–70)');
    expect(prompt).toContain('| finding: Ateşman 42 (language tr; aim for 50 or more)');
    expect(system).toContain(
      'fuller sentences with the detail readers expect when a Flesch score is over 70',
    );
    expect(system).toContain("in the page's language");
  });

  it('sends no brand data for another site, and the brand name there is unknown', async () => {
    modelReturns([
      {
        signalKey: 'case-study-evidence',
        priority: 'medium',
        recommendation: 'Add one real customer result next to the plans.',
        draft: 'Teams at GetCito cut audit time.',
        code: null,
      },
    ]);
    const other = {
      ...ctx,
      url: 'https://competitor.com/pricing',
      $: cheerio.load('<html><head><title>Competitor pricing</title></head><body></body></html>'),
      text: 'Competitor pricing: plans for teams.',
    };
    const recs = await generateRecommendations(other, { results, brand: null });

    expect(generateObject.mock.calls[0][0].prompt).not.toContain('BRAND DATA');
    expect(recs[0].draft).toBe('Teams at [customer name] cut audit time.');
  });

  it("keeps the page's prices from its meta tags and JSON-LD, and today's month", async () => {
    modelReturns([
      {
        signalKey: 'h1-quality',
        priority: 'high',
        recommendation: 'Name both plans and their prices in the H1.',
        draft: 'Plans from $49 to $249 a month, updated October 2026',
        code: null,
      },
    ]);
    const recs = await generateRecommendations(ctx, { results, brand });
    expect(recs[0].draft).toBe('Plans from $49 to $249 a month, updated October 2026');
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('cuts at a word boundary when the rewrite fails', async () => {
    modelReturns(
      [
        {
          signalKey: 'h1-quality',
          priority: 'high',
          recommendation: 'Use a descriptive H1.',
          draft: tooLong,
          code: null,
        },
      ],
      new Error('model down'),
    );
    const recs = await generateRecommendations(ctx, { results, brand });

    expect(sentencesOf(recs[0].draft).every((s) => s.length <= MAX_COPY_CHARS)).toBe(true);
    expect(recs[0].draft.endsWith('…')).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ tooLong: 1, rewritten: 0, cuts: 1 }),
      expect.any(String),
    );
  });

  it('cuts a rewrite that is still too long', async () => {
    modelReturns(
      [
        {
          signalKey: 'h1-quality',
          priority: 'high',
          recommendation: tooLong,
          draft: null,
          code: null,
        },
      ],
      [{ ref: '0', recommendation: `${tooLong} Still long.`, draft: null }],
    );
    const recs = await generateRecommendations(ctx, { results, brand });
    expect(recs[0].recommendation.length).toBeLessThanOrEqual(MAX_COPY_CHARS);
  });

  it('matches rewrites by position and keeps the parts that were within the limit', async () => {
    const draft = 'Acme pricing: plans for every team size';
    modelReturns(
      [
        { signalKey: 'h1-quality', priority: 'high', recommendation: tooLong, draft, code: null },
        {
          signalKey: 'h1-quality',
          priority: 'medium',
          recommendation: 'Name the plans in the H1.',
          draft: 'Starter and Growth plans',
          code: null,
        },
      ],
      // The rewrite leaves the draft out; the short second item isn't sent.
      [{ ref: '0', recommendation: 'Say what the plans cover in the H1.', draft: null }],
    );
    const recs = await generateRecommendations(ctx, { results, brand });

    expect(recs).toMatchObject([
      { recommendation: 'Say what the plans cover in the H1.', draft },
      { recommendation: 'Name the plans in the H1.', draft: 'Starter and Growth plans' },
    ]);
    const sent = generateObject.mock.calls[1][0].prompt;
    expect(sent).toContain('"ref": "0"');
    expect(sent).not.toContain('"ref": "1"');
  });

  it('calls no model when nothing it can help with failed', async () => {
    const recs = await generateRecommendations(ctx, {
      results: [{ key: 'https', status: 'fail', evidence: {} }],
    });
    expect(recs).toEqual([]);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('returns nothing when the model fails', async () => {
    modelReturns(new Error('model down'));
    expect(await generateRecommendations(ctx, { results, brand })).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('brandFactsFor', () => {
  const row = { name: 'GetCito', description: 'AI visibility platform' };
  const domains = [{ domain: 'getcito.com' }, { domain: null }];

  it("gives the brand's facts for a page on its domains", () => {
    expect(brandFactsFor('https://www.getcito.com/pricing', row, domains)).toEqual({
      name: 'GetCito',
      description: 'AI visibility platform',
      domains: ['getcito.com'],
    });
  });

  it("gives none for another site's page, or a brand without domains", () => {
    expect(brandFactsFor('https://competitor.com/pricing', row, domains)).toBeNull();
    expect(brandFactsFor('https://getcito.com/pricing', row, [])).toBeNull();
    expect(brandFactsFor('https://getcito.com/pricing', row, null)).toBeNull();
  });
});
