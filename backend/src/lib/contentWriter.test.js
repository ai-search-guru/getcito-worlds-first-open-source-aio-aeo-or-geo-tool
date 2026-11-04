import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Start's Agent (Content Editor CE-015): the Content Agent writes a new page
 * whole, or leaves suggestions on an existing one, in the background, and
 * the draft goes to In review — or says it failed.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';

let rows;
let writes;
let claimed;
let finished;
let rpcCalls;
let reads;
const generateObject = vi.fn();
const reserveAiBudget = vi.fn();
/**
 * The facts pass (contentResearch.js), as a search that finds nothing:
 * each sentence written again without what it needed.
 */
const notFound = async ({ prompt }) => ({
  text: JSON.stringify({
    facts: [...prompt.matchAll(/^(G\d+): "(.*)"$/gmu)].map(([, id, sentence]) => ({
      id,
      text: sentence.replace(/\s*\(?\[[^\]]+\]\)?|\s*\{\{[^}]*\}\}/gu, ''),
      source: null,
    })),
  }),
  sources: [],
  usage: { inputTokens: 1000, outputTokens: 100 },
});
const generateText = vi.fn(notFound);

vi.mock('../config/supabase.js', () => ({
  default: {
    rpc: async (name, args) => (rpcCalls.push([name, args]), { data: 'v1', error: null }),
    from: (table) => {
      const op = { table, kind: 'select', filters: [] };
      const result = () => {
        if (op.kind === 'select') {
          reads.push(op);
          // The organization's other drafts being written.
          if (op.filters.some(([col]) => col === 'brands.organization_id')) {
            return { data: rows.writingInOrg ?? [], error: null };
          }
          return { data: rows[table] ?? null, error: null };
        }
        writes.push(op);
        // The claim and the finish read back their row, when they matched one.
        const claim = op.kind === 'update' && op.value.agent_state === 'writing';
        return { data: claim ? claimed : op.kind === 'update' ? finished : null, error: null };
      };
      const chain = {
        select: () => chain,
        eq: (col, v) => (op.filters.push([col, v]), chain),
        neq: (col, v) => (op.filters.push([`${col}<>`, v]), chain),
        gt: (col, v) => (op.filters.push([`${col}>`, v]), chain),
        in: (col, v) => (op.filters.push([col, v]), chain),
        is: (col, v) => (op.filters.push([`${col} is`, v]), chain),
        or: (v) => (op.filters.push(['or', v]), chain),
        order: () => chain,
        range: () => chain,
        limit: () => chain,
        update: (value) => ((op.kind = 'update'), (op.value = value), chain),
        insert: (value) => ((op.kind = 'insert'), (op.value = value), chain),
        delete: () => ((op.kind = 'delete'), chain),
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
      };
      return chain;
    },
  },
}));
class NoObjectGeneratedError extends Error {
  static isInstance(err) {
    return err instanceof NoObjectGeneratedError;
  }
}
// The real schema helpers: a Claude call's schema is built with them (structuredOutput.js).
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal()),
  generateObject: (...args) => generateObject(...args),
  generateText: (...args) => generateText(...args),
  NoObjectGeneratedError,
}));
const resolveModel = vi.hoisted(() => vi.fn((id) => `model:${id}`));
vi.mock('./aiProvider.js', () => ({
  resolveModel,
  webSearchTools: () => ({ web_search: { id: 'anthropic.web_search_20250305' } }),
}));
vi.mock('./planGuard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reserveAiBudget: (...args) => reserveAiBudget(...args),
}));
vi.mock('./logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const readLinkTargets = vi.hoisted(() => vi.fn());
const stopIfStopped = vi.fn();
const fixUnderWay = vi.hoisted(() => vi.fn());
vi.mock('./contentRuns.js', async (importOriginal) => ({
  ...(await importOriginal()),
  stopIfStopped: (...args) => stopIfStopped(...args),
  fixUnderWay: (...args) => fixUnderWay(...args),
}));
vi.mock('./contentLinks.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readLinkTargets: (...args) => readLinkTargets(...args),
}));
// Write this's brief (customer priorities item 9): the editor's Build brief, as its own run.
const rebuildDraftBrief = vi.hoisted(() => vi.fn());
vi.mock('./contentBrief.js', async (importOriginal) => ({
  ...(await importOriginal()),
  rebuildDraftBrief: (...args) => rebuildDraftBrief(...args),
}));
const hasOpenSuggestions = vi.hoisted(() => vi.fn());
vi.mock('./contentAgent.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasOpenSuggestions: (...args) => hasOpenSuggestions(...args),
}));

const {
  WRITER_CHECKS,
  WRITE_SYSTEM_PROMPT,
  buildWritePrompt,
  headingCase,
  briefText,
  lengthNow,
  renderPage,
  rewriteSystemPrompt,
  runDraftWriting,
  sourcedPage,
  startDraftWriting,
  suggestSystemPrompt,
  writeSystemPrompt,
} = await import('./contentWriter.js');
const { WRITING_GUARDRAIL } = await import('./contentBrief.js');
const { REWRITE_SYSTEM_PROMPT } = await import('./contentRewrite.js');
const { NAME_PLACEHOLDER, QUOTE_PLACEHOLDER, knownPeople } = await import('./contentPeople.js');
const { FEATURE_CHECKS } = await import('./action-center/pageFeatures.js');
const { textLength } = await import('./contentRewrite.js');
const { SYSTEM_PROMPT: AGENT_SYSTEM_PROMPT, passageKey } = await import('./contentAgent.js');
const { RESEARCH_RULE } = await import('./contentResearch.js');
const { PlanLimitError } = await import('./planGuard.js');
// The real hold: self-hosted here, so it reserves nothing and writes each charge.
const realGuard = await vi.importActual('./planGuard.js');

const input = (over = {}) => ({
  sources: {
    promptIds: ['p1'],
    fanouts: [{ query: 'pour over ratio', platforms: ['copilot-web'] }],
    pages: [],
    queries: [],
    headings: [],
    length: 3000,
  },
  rules: [{ key: 'faq', name: 'FAQ with 5 questions', detail: 'aim: 5' }],
  textRules: [],
  locked: [],
  ...over,
});

const draftRow = (over = {}) => ({
  id: DRAFT,
  brand_id: BRAND,
  title: 'How to brew pour-over coffee',
  page_type: 'guide',
  method: 'create',
  source_url: null,
  body_html: '<h1>How to brew pour-over coffee</h1>',
  status: 'draft',
  agent_state: null,
  agent_state_at: null,
  opportunity_id: null,
  brief: null,
  action_id: null,
  ...over,
});
const brand = {
  name: 'Acme Coffee',
  industry: 'Coffee',
  description: 'Beans',
  organization_id: 'org-1',
  language: 'en',
};

const page = {
  title: 'How to brew pour-over coffee',
  intro: ['Use 15 g of coffee for 250 g of water.'],
  sections: [
    { heading: 'What you need', paragraphs: ['A dripper & a filter.'], bullets: ['Kettle', ''] },
    { heading: 'Step by step', paragraphs: ['Rinse, bloom, pour.'], bullets: [] },
  ],
  faqHeading: 'FAQ',
  faq: [{ question: 'How long?', answer: '[time] minutes.' }],
};

beforeEach(() => {
  readLinkTargets.mockReset().mockResolvedValue({ own: [], sources: [] });
  writes = [];
  rpcCalls = [];
  reads = [];
  claimed = { id: DRAFT };
  finished = { id: DRAFT };
  rows = { content_drafts: draftRow(), brands: brand, prompts: [{ id: 'p1', text: 'ratio?' }] };
  generateObject.mockReset().mockResolvedValue({
    object: page,
    usage: { inputTokens: 10, outputTokens: 20 },
  });
  reserveAiBudget.mockReset().mockImplementation(realGuard.reserveAiBudget);
  generateText.mockReset().mockImplementation(notFound);
  hasOpenSuggestions.mockReset().mockResolvedValue(false);
  rebuildDraftBrief.mockReset();
  fixUnderWay.mockReset().mockResolvedValue(false);
  stopIfStopped.mockReset().mockResolvedValue(undefined);
  // The model as a server without an Anthropic key picks it, whatever the shell has.
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('CONTENT_WRITE_MODEL', '');
  // The facts pass searches on Anthropic only (contentResearch.js searchesCapped).
  vi.stubEnv('CONTENT_READ_MODEL', 'anthropic/claude-haiku-5-5');
});
afterEach(() => vi.unstubAllEnvs());

const SONNET = 'anthropic/claude-sonnet-5-5';
/** A call as Claude 5.5 takes it: structured output, a token cap, no sampling. */
const expectClaudeCall = (call) => {
  expect(call.maxOutputTokens).toBe(32_000);
  expect(call.providerOptions).toEqual({ anthropic: { structuredOutputMode: 'outputFormat' } });
  for (const key of ['temperature', 'topP', 'topK']) expect(call).not.toHaveProperty(key);
  expect(JSON.stringify(call.schema.jsonSchema)).not.toMatch(
    /"(\$schema|maxItems|maxLength|minLength|minimum|maximum)"/,
  );
};

const draftUpdates = () =>
  writes.filter((w) => w.table === 'content_drafts' && w.kind === 'update').map((w) => w.value);

describe('renderPage', () => {
  it('writes the editor’s HTML from text, escaped', () => {
    expect(renderPage({ ...page, title: 'Pour-over <b>101</b>' })).toBe(
      '<h1>Pour-over &lt;b&gt;101&lt;/b&gt;</h1>' +
        '<p>Use 15 g of coffee for 250 g of water.</p>' +
        '<h2>What you need</h2><p>A dripper &amp; a filter.</p><ul><li><p>Kettle</p></li></ul>' +
        '<h2>Step by step</h2><p>Rinse, bloom, pour.</p>' +
        '<h2>FAQ</h2><h3>How long?</h3><p>[time] minutes.</p>',
    );
  });

  it('starts each heading with a capital, as a fan-out’s words come lowercase', () => {
    const html = renderPage({
      ...page,
      sections: [{ heading: 'latest news ChatGPT', paragraphs: ['News.'], bullets: [] }],
      faqHeading: 'questions',
      faq: [{ question: 'how long does it take?', answer: 'Four minutes.' }],
    });
    expect(html).toContain('<h2>Latest news ChatGPT</h2>');
    expect(html).toContain('<h2>Questions</h2><h3>How long does it take?</h3>');
  });
});

describe('headingCase', () => {
  it('capitalizes a lowercase first word, in the page’s language', () => {
    expect(headingCase('latest news ChatGPT', 'en')).toBe('Latest news ChatGPT');
    expect(headingCase('istanbul’da kahve', 'tr')).toBe('İstanbul’da kahve');
    expect(headingCase('  çay rehberi ', 'tr')).toBe('Çay rehberi');
  });

  it('keeps a name written lowercase on purpose, a number and a heading already capitalized', () => {
    expect(headingCase('iPhone tips for writers', 'en')).toBe('iPhone tips for writers');
    expect(headingCase('eBay sellers', 'en')).toBe('eBay sellers');
    expect(headingCase('2026 guide', 'en')).toBe('2026 guide');
    expect(headingCase('Best CRM tools', 'en')).toBe('Best CRM tools');
    // A language the runtime can't read still gets a capital.
    expect(headingCase('latest news', 'not a locale!')).toBe('Latest news');
  });
});

describe('sourcedPage', () => {
  it('puts a person or a quote the agent was not given as a placeholder (CE-044)', () => {
    const written = sourcedPage(
      {
        ...page,
        intro: ['Dr. Jane Doe brews with Ada Lovelace every morning.'],
        faq: [
          {
            question: 'Who says so?',
            answer: '“Slow pours taste sweeter and cleaner,” says Ada Lovelace.',
          },
        ],
      },
      new Set(),
      knownPeople('Ada Lovelace'),
    );
    expect(written.intro).toEqual([`${NAME_PLACEHOLDER} brews with Ada Lovelace every morning.`]);
    expect(written.faq[0].answer).toBe(`${QUOTE_PLACEHOLDER} says Ada Lovelace.`);
  });
});

describe('briefText', () => {
  it('reads the draft’s brief, else its opportunity’s', () => {
    const own = briefText(
      {
        goal: 'Sell beans',
        audience: 'Home brewers',
        outline: [{ heading: 'Ratio', keyPoints: ['15:250'], fanout: 'pour over ratio' }],
        keywords: ['pour over'],
      },
      { outline: [{ heading: 'Ignored' }] },
    );
    expect(own).toContain('Goal: Sell beans');
    expect(own).toContain('- Ratio: 15:250 (answers the AI search "pour over ratio")');
    expect(own).not.toContain('Ignored');

    expect(
      briefText(null, {
        suggestedTitle: 'Pour-over guide',
        outline: [{ heading: 'Gear', keyPoints: [] }],
        targetKeywords: [],
        callToAction: 'Shop',
      }),
    ).toContain('- Gear');
    expect(briefText(null, null)).toMatch(/^No brief/);
  });

  /** What the pages AI cites have (learning C2), as the brief's rebuild read them. */
  it('tells the writer what the cited pages have, seen rather than guessed', () => {
    const text = briefText(
      {
        goal: 'Sell beans',
        outline: [{ heading: 'Ratio' }],
        citedFeatures: {
          pages: 4,
          checks: [
            { key: 'statistic-density', label: 'Statistics', pages: 3 },
            { key: 'tables', label: 'Tables', pages: 2 },
          ],
        },
      },
      null,
    );
    expect(text).toContain(
      "What the pages AI cites for these prompts have (Site Audit's checks, 4 pages read): Statistics on 3; Tables on 2. Give the page these where they serve its readers.",
    );
    expect(briefText({ goal: 'Sell beans', outline: [] }, null)).not.toContain('pages AI cites');
  });

  it("doesn't ask the writer for what the page's body can't give: schema, dates, a byline", () => {
    const template = [
      { key: 'faq-schema', label: 'FAQ schema', pages: 4 },
      { key: 'json-ld-presence', label: 'JSON-LD', pages: 4 },
      { key: 'date-markup', label: 'Date markup', pages: 3 },
      { key: 'freshness', label: 'Freshness', pages: 3 },
      { key: 'author-byline', label: 'Author byline', pages: 2 },
    ];
    const brief = (checks) => ({
      goal: 'Sell beans',
      outline: [{ heading: 'Ratio' }],
      citedFeatures: { pages: 4, checks },
    });
    const text = briefText(
      brief([...template, { key: 'tables', label: 'Tables', pages: 2 }]),
      null,
    );
    expect(text).toContain("(Site Audit's checks, 4 pages read): Tables on 2.");
    for (const { label } of template) expect(text).not.toContain(label);
    // Nothing the body can give: no line at all.
    expect(briefText(brief(template), null)).not.toContain('pages AI cites');
    // Each is a check the cited pages are read for.
    expect(WRITER_CHECKS.filter((key) => !FEATURE_CHECKS.includes(key))).toEqual([]);
  });
});

describe('startDraftWriting', () => {
  it('claims the draft, answers at once, and writes the new page for review', async () => {
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ started: true });
    expect(reserveAiBudget).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ feature: 'content', modelId: expect.any(String) }),
    );
    // Which run holds it, for every device (00247).
    expect(draftUpdates()[0]).toMatchObject({ agent_state: 'writing', agent_run: 'write' });
    // Its run carries the claim, the one a Stop on it lets go of (00249).
    expect(
      writes.find((w) => w.table === 'content_agent_runs' && w.kind === 'insert').value,
    ).toMatchObject({ kind: 'write', claimed_at: draftUpdates()[0].agent_state_at });
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
  });

  it('writes with Claude Sonnet with an Anthropic key', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    await startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() });
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    expect(resolveModel).toHaveBeenCalledWith(SONNET);
    // The facts it needs are looked up on the read model, Claude Haiku.
    expect(generateText.mock.calls[0][0].model).toBe('model:anthropic/claude-haiku-5-5');
    expect(reserveAiBudget).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ feature: 'content', modelId: SONNET }),
    );
    const call = generateObject.mock.calls[0][0];
    expect(call.model).toBe(`model:${SONNET}`);
    expectClaudeCall(call);
    // Two to twelve sections, told in words: Claude takes minItems 0 or 1 only.
    expect(call.schema.jsonSchema.properties.sections).toMatchObject({
      minItems: 1,
      description: '(at least 2 items, at most 12 items)',
    });
  });

  it('says it reads as many rules as the editor counts, when it says so', async () => {
    await startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input({ counted: 7 }) });
    const run = writes.find((w) => w.table === 'content_agent_runs' && w.kind === 'insert').value;
    expect(run.steps.find((s) => s.key === 'read_rules')).toMatchObject({ count: 7 });
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
  });

  it('writes the new page for review once claimed', async () => {
    // The search finds the ratio (G1) on a page, and the time (G2) nowhere.
    generateText.mockImplementationOnce(async (call) => ({
      ...(await notFound(call)),
      text: JSON.stringify({
        facts: [
          {
            id: 'G1',
            text: 'Use 15 g of coffee for 250 g of water.',
            source: 'https://sca.example/ratio',
            words: '15 g of coffee for 250 g of water',
          },
          { id: 'G2', text: '', source: null },
        ],
      }),
      sources: [{ sourceType: 'url', url: 'https://sca.example/ratio', title: 'Ratio' }],
    }));
    await startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() });

    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    // It ends only its own claim: a newer run's, after a Stop let go, is left alone.
    const updates = writes.filter((w) => w.table === 'content_drafts' && w.kind === 'update');
    expect(updates[1].filters).toContainEqual(['agent_state_at', updates[0].value.agent_state_at]);
    expect(draftUpdates()[1]).toMatchObject({
      title: 'How to brew pour-over coffee',
      status: 'in_review',
      author: 'agent',
      agent_state: null,
    });
    // No number without a source (CE-033): none of the data has 15 or 250, so
    // they were looked up, and are linked to the page that has them; the time
    // no page had went with its sentence, and its question with it. No
    // placeholder is left.
    const body = draftUpdates()[1].body_html;
    expect(body).toMatch(
      /^<h1>How to brew pour-over coffee<\/h1><p>Use <a href="https:\/\/sca\.example\/ratio">15 g of coffee for 250 g of water<\/a>\.<\/p>/,
    );
    expect(body).not.toContain('[');
    expect(body).not.toContain('How long?');
    expect(generateText.mock.calls[0][0].prompt).toContain(
      'G1: "Use 15 g of coffee for 250 g of water."\nneeds: check: 15; check: 250',
    );
    const finish = writes.filter((w) => w.table === 'content_drafts')[1];
    expect(finish.filters).toContainEqual(['agent_state', 'writing']);
    // Only while it is still open to it: one marked ready meanwhile keeps its page.
    expect(finish.filters).toContainEqual(['status', ['draft', 'in_review']]);
    // A new page holds only its H1: nothing of the person's to keep first.
    expect(rpcCalls).toEqual([]);
    expect(writes.find((w) => w.table === 'prompt_improve_usage')).toMatchObject({
      value: expect.objectContaining({ feature: 'content' }),
    });
    const { prompt } = generateObject.mock.calls[0][0];
    // The data, numbered as the agent cites it.
    expect(prompt).toContain('- S1 ratio?');
    expect(prompt).toContain('- S2 "pour over ratio"');
    expect(prompt).toContain('- faq: FAQ with 5 questions — aim: 5');
    expect(prompt).toContain('Page type: How-to guide: numbered steps to get one thing done');
  });

  it('leaves the page as it was once stopped, and lets go of it (CE-027)', async () => {
    const { RunStoppedError } = await import('./contentRuns.js');
    stopIfStopped.mockRejectedValueOnce(new RunStoppedError());
    // A page the person wrote in: stopped, History gets no "before the agent".
    rows.content_drafts = draftRow({
      body_html: '<h1>How to brew pour-over coffee</h1><p>My notes.</p>',
    });
    await startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() });
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    // Claimed, then let go: no page written, no 'failed'.
    expect(draftUpdates()[1]).toEqual({ agent_state: null, agent_state_at: expect.any(String) });
    expect(draftUpdates().some((u) => 'body_html' in u)).toBe(false);
    expect(rpcCalls).toEqual([]);
  });

  // Rewrite from brief: a draft the agent wrote is in review, and is written again.
  it('writes a draft in review again, keeping its page in History first', async () => {
    rows.content_drafts = draftRow({
      status: 'in_review',
      author: 'agent',
      body_html: '<h1>How to brew pour-over coffee</h1><p>The first run.</p>',
    });
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ started: true });
    const claim = writes.find((w) => w.table === 'content_drafts');
    expect(claim.filters).toContainEqual(['status', ['draft', 'in_review']]);

    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    expect(rpcCalls).toEqual([
      ['content_draft_snapshot', { p_draft_id: DRAFT, p_origin: 'agent_before' }],
    ]);
    expect(draftUpdates()[1]).toMatchObject({ status: 'in_review', agent_state: null });
  });

  it('refuses another brand’s draft, one marked ready or published, or one the agent is on — before charging', async () => {
    const start = () => startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() });
    rows.content_drafts = draftRow({ brand_id: 'other' });
    await expect(start()).rejects.toMatchObject({ status: 404 });
    for (const status of ['ready', 'published']) {
      rows.content_drafts = draftRow({ status });
      await expect(start()).rejects.toMatchObject({ status: 409, code: 'not_draft' });
    }
    rows.content_drafts = draftRow({
      agent_state: 'writing',
      agent_state_at: new Date().toISOString(),
    });
    await expect(start()).rejects.toMatchObject({ status: 409, code: 'writing' });
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(writes).toEqual([]);

    // A 'writing' left long ago can start again; a start that lost the claim can't.
    rows.content_drafts = draftRow({
      agent_state: 'writing',
      agent_state_at: '2026-01-01T00:00:00Z',
    });
    claimed = null;
    await expect(start()).rejects.toMatchObject({ status: 409, code: 'writing' });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('waits on an existing page while its suggestions are open, before charging', async () => {
    rows.content_drafts = draftRow({ method: 'optimize', source_url: 'https://acme.example/x' });
    hasOpenSuggestions.mockResolvedValue(true);
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 409, code: 'open_suggestions' });
    expect(hasOpenSuggestions).toHaveBeenCalledWith(DRAFT);
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(writes).toEqual([]);

    // A new page is written whole: its run adds no batch.
    rows.content_drafts = draftRow();
    hasOpenSuggestions.mockClear();
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ started: true });
    expect(hasOpenSuggestions).not.toHaveBeenCalled();
    // Its run finished before the next test reads the writes.
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
  });

  it('waits while a Fix open rules runs on the draft, before charging, for a Start or a rewrite', async () => {
    fixUnderWay.mockResolvedValue(true);
    for (const [row, rewrite] of [
      [draftRow(), false],
      [draftRow({ method: 'optimize', source_url: 'https://acme.example/x' }), false],
      [draftRow({ method: 'optimize', source_url: 'https://acme.example/x' }), true],
    ]) {
      rows.content_drafts = row;
      await expect(
        startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input(), rewrite }),
      ).rejects.toMatchObject({ status: 409, code: 'running' });
    }
    expect(fixUnderWay).toHaveBeenCalledWith(DRAFT);
    // Nothing held on the budget, no claim on the draft, no model call.
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(generateObject).not.toHaveBeenCalled();

    // Once it has finished, the Start goes.
    fixUnderWay.mockResolvedValue(false);
    rows.content_drafts = draftRow();
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ started: true });
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
  });

  it('writes one of the organization’s drafts at a time', async () => {
    rows.writingInOrg = [{ id: 'other-draft' }];
    const held = { charge: vi.fn(), release: vi.fn() };
    reserveAiBudget.mockResolvedValueOnce(held);
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 409, code: 'org_writing' });
    expect(writes).toEqual([]);
    expect(generateObject).not.toHaveBeenCalled();
    // Not started: the hold on the budget goes.
    expect(held.release).toHaveBeenCalled();
    expect(held.charge).not.toHaveBeenCalled();
  });

  it('fails at once when the model isn’t set up, claiming nothing', async () => {
    resolveModel.mockImplementationOnce(() => {
      throw new Error('Provider "google" is not configured');
    });
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toThrow('not configured');
    expect(writes).toEqual([]);
  });

  it('stops at the budget', async () => {
    reserveAiBudget.mockRejectedValue(new PlanLimitError('used up', 429));
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(writes).toEqual([]);
  });
});

// The hold Start took on the AI budget (reserveAiBudget), handed to the run.
const budget = { charge: vi.fn(), release: vi.fn() };
beforeEach(() => {
  budget.charge.mockReset();
  budget.release.mockReset();
});

describe('Write this: the brief, then the page from it (customer priorities item 9)', () => {
  const built = {
    goal: 'Show the pour-over ratio',
    audience: 'Home brewers',
    outline: [{ heading: 'The ratio', keyPoints: ['15:250'], fanout: 'pour over ratio' }],
    keywords: ['pour over ratio'],
  };
  const withKeywords = () =>
    input({
      buildBrief: true,
      rules: [
        { key: 'faq', name: 'FAQ with 5 questions', detail: 'aim: 5' },
        { key: 'keywords', name: 'Keywords', detail: 'pour over' },
      ],
    });

  it('builds the brief first, holding the claim, and writes the page from it', async () => {
    rebuildDraftBrief.mockResolvedValue(built);
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: withKeywords() }),
    ).resolves.toEqual({ started: true });
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    const claim = draftUpdates()[0];
    expect(claim).toMatchObject({ agent_state: 'writing', agent_run: 'write' });
    // From the sources the page is written from; the keywords written anew, as Build brief does.
    expect(rebuildDraftBrief).toHaveBeenCalledWith({
      draftId: DRAFT,
      brandId: BRAND,
      sources: withKeywords().sources,
      rules: [{ key: 'faq', name: 'FAQ with 5 questions', detail: 'aim: 5' }],
      claimedAt: claim.agent_state_at,
    });
    // The page's own run after it, with the same claim.
    expect(
      writes.find((w) => w.table === 'content_agent_runs' && w.kind === 'insert').value,
    ).toMatchObject({ kind: 'write', claimed_at: claim.agent_state_at });
    expect(generateObject.mock.calls[0][0].prompt).toContain('Goal: Show the pour-over ratio');
    expect(draftUpdates()[1]).toMatchObject({ status: 'in_review', agent_state: null });
  });

  it('keeps a brief the draft has, and writes from it', async () => {
    rows.content_drafts = draftRow({ brief: built });
    await startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: withKeywords() });
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    expect(rebuildDraftBrief).not.toHaveBeenCalled();
    expect(generateObject.mock.calls[0][0].prompt).toContain('Goal: Show the pour-over ratio');
  });

  it('writes the page from what there is when the brief can’t be built', async () => {
    rebuildDraftBrief.mockRejectedValue(
      Object.assign(new Error('No prompts, fan-outs or queries to build from'), {
        status: 422,
        code: 'no_sources',
      }),
    );
    await startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: withKeywords() });
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    expect(generateObject.mock.calls[0][0].prompt).toContain('No brief: plan the sections');
    expect(draftUpdates()[1]).toMatchObject({ status: 'in_review', agent_state: null });
  });

  it('writes nothing once the brief is stopped, lets go of the draft and of its hold', async () => {
    const { RunStoppedError } = await import('./contentRuns.js');
    rebuildDraftBrief.mockRejectedValue(new RunStoppedError());
    const release = vi.fn();
    reserveAiBudget.mockResolvedValue({ charge: vi.fn(), release });
    await startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: withKeywords() });
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    expect(draftUpdates()[1]).toEqual({ agent_state: null, agent_state_at: expect.any(String) });
    expect(generateObject).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    expect(writes.some((w) => w.table === 'content_agent_runs' && w.kind === 'insert')).toBe(false);
  });

  it('builds no brief for a rewrite, nor without being asked', async () => {
    await startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() });
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    expect(rebuildDraftBrief).not.toHaveBeenCalled();
  });
});

describe('runDraftWriting on a new page', () => {
  const run = (draft) =>
    runDraftWriting({ draft, brand, model: 'model:m', input: input(), budget });

  it('keeps the person’s text in History before writing over it, and reads prompts by their set', async () => {
    const tried = draftRow({
      agent_state: 'failed',
      body_html: '<h1>How to brew pour-over coffee</h1><p>My own notes.</p>',
    });
    await expect(run(tried)).resolves.toEqual({ written: true });
    // The answer is charged to the hold; nothing is left to release after.
    expect(budget.charge).toHaveBeenCalledTimes(1);
    expect(budget.release).toHaveBeenCalled();
    // The fan-outs a rule names, in their words, on a new page too (B).
    expect(generateObject.mock.calls[0][0].system).toContain(
      'For each fan-out a rule names, use its words, not questions of your own: a section heading for fanoutH2, an FAQ question ending in "?" for fanoutFaq.',
    );
    expect(rpcCalls).toEqual([
      ['content_draft_snapshot', { p_draft_id: DRAFT, p_origin: 'agent_before' }],
    ]);
    // A prompt without a topic is the brand's too.
    expect(reads.find((r) => r.table === 'prompts').filters).toContainEqual([
      'prompt_sets.brand_id',
      BRAND,
    ]);
  });

  it('looks up what the page needs, leaving the person only the brand’s own facts (2026-10-29)', async () => {
    const PLANS = 'https://www.hootsuite.com/plans';
    // The page the person got: three gaps for them to research.
    generateObject.mockResolvedValue({
      object: {
        ...page,
        intro: [
          'AI use in social media keeps growing: {{find: share of marketers using AI for social media}}.',
          'We help {{ask: number of customers}} teams, and {{ask: agencies served}} agencies, with {{ask: average hours saved}} hours saved.',
          'Our churn is {{ask: churn rate}}. Pick a plan that fits.',
        ],
        sections: [
          {
            heading: '2. Hootsuite',
            paragraphs: [
              'Compare seats and profiles: {{find: Hootsuite Professional plan price}}.',
              'Check client workspace limits: [plan limits].',
            ],
            bullets: [],
          },
          { heading: 'Step by step', paragraphs: ['Rinse, bloom, pour.'], bullets: [] },
        ],
        faq: [],
      },
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    generateText.mockImplementationOnce(async (call) => ({
      ...(await notFound(call)),
      text: JSON.stringify({
        facts: [
          // Found nowhere trustworthy: the sentence says nothing without it.
          { id: 'G1', text: '', source: null },
          {
            id: 'G2',
            text: 'Compare seats and profiles: the Professional plan costs $99 per month.',
            source: PLANS,
            words: '$99 per month',
          },
          // Not found: written without it.
          { id: 'G3', text: 'Check each plan’s client workspace limits.', source: null },
        ],
      }),
      sources: [{ sourceType: 'url', url: PLANS, title: 'Plans' }],
    }));
    await expect(run(draftRow())).resolves.toEqual({ written: true });
    const written = draftUpdates().find((u) => u.body_html).body_html;

    // What a page needs, looked up: found and linked, or written without.
    expect(written).toContain(
      `<p>Compare seats and profiles: the Professional plan costs <a href="${PLANS}">$99 per month</a>.</p>`,
    );
    expect(written).toContain('<p>Check each plan’s client workspace limits.</p>');
    expect(written).not.toContain('AI use in social media');
    // Only the brand’s own facts are left for the person, three at most:
    // the fourth’s sentence goes.
    expect(written).toContain(
      '<p>We help [number of customers] teams, and [agencies served] agencies, with [average hours saved] hours saved.</p>',
    );
    expect(written).toContain('<p>Pick a plan that fits.</p>');
    expect(written).not.toContain('churn');
    expect(written).not.toMatch(
      /\{\{|\[(?!number of customers|agencies served|average hours saved)/,
    );
    expect(generateText.mock.calls[0][0].prompt).toContain(
      'needs: find: share of marketers using AI for social media',
    );
  });

  it("writes from Brief › Your input in Quality's second phase, its numbers and people kept (CE-048)", async () => {
    rows.content_draft_inputs = {
      experience: null,
      data: [{ name: 'Survey', rows: [['Teams'], ['1,250']] }],
      getcito_data: [],
      quotes: [
        {
          name: 'Ada Lovelace',
          title: 'Head of Research, Acme',
          text: 'We cut our forecast misses in half.',
          sourceUrl: 'https://acme.example/talk',
        },
      ],
    };
    generateObject.mockResolvedValue({
      object: {
        ...page,
        intro: [
          '1,250 teams brew this way. “We cut our forecast misses in half,” says Ada Lovelace.',
          'Marco Rossi said 3,400 cups a day.',
        ],
      },
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    const before = process.env.CONTENT_QUALITY_PHASE;
    process.env.CONTENT_QUALITY_PHASE = '2';
    try {
      await expect(run(draftRow())).resolves.toEqual({ written: true });
    } finally {
      if (before === undefined) delete process.env.CONTENT_QUALITY_PHASE;
      else process.env.CONTENT_QUALITY_PHASE = before;
    }
    expect(generateObject.mock.calls[0][0].prompt).toContain(
      '"Survey" (Their own data, a table: Teams; 1,250)',
    );
    const written = draftUpdates().find((u) => u.body_html)?.body_html;
    expect(written).toContain(
      '1,250 teams brew this way. “We cut our forecast misses in half,” says Ada Lovelace.',
    );
    // What the person didn't give is still a placeholder.
    expect(written).not.toContain('Marco Rossi');
    expect(written).not.toContain('3,400');
  });

  it('saves the title as its H1 reads, a capital first, in the brand’s language', async () => {
    generateObject.mockResolvedValue({
      object: { ...page, title: 'latest news on pour-over coffee' },
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    await expect(run(draftRow())).resolves.toEqual({ written: true });
    const saved = draftUpdates().find((u) => u.body_html);
    expect(saved.title).toBe('Latest news on pour-over coffee');
    expect(saved.body_html).toContain('<h1>Latest news on pour-over coffee</h1>');

    // Turkish: "i" is "İ", in the title column as in the H1.
    writes = [];
    generateObject.mockResolvedValue({
      object: { ...page, title: 'istanbul’da filtre kahve' },
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    await expect(
      runDraftWriting({
        draft: draftRow(),
        brand: { ...brand, language: 'tr' },
        model: 'model:m',
        input: input(),
        budget,
      }),
    ).resolves.toEqual({ written: true });
    const tr = draftUpdates().find((u) => u.body_html);
    expect(tr.title).toBe('İstanbul’da filtre kahve');
    expect(tr.body_html).toContain('<h1>İstanbul’da filtre kahve</h1>');
  });

  /** A draft's shopping path as content_drafts.shopping_path keeps it. */
  const shoppingPath = (over = {}) => ({
    version: 1,
    builtAt: '2026-10-27T10:00:00.000Z',
    pageType: 'guide',
    categories: [
      { name: 'Hiking Boots', url: 'https://shop.example/collections/hiking-boots', title: null },
    ],
    products: [
      {
        id: 'p1',
        title: 'Summit GTX Boot',
        url: 'https://shop.example/products/p1',
        price: 189,
        salePrice: null,
        currency: 'USD',
        availability: 'in_stock',
        image: null,
        issues: [],
        score: 9,
      },
      {
        id: 'p2',
        title: 'Trail 450 Boot',
        url: 'https://shop.example/products/p2',
        price: 129,
        salePrice: null,
        currency: 'USD',
        availability: 'in_stock',
        image: null,
        issues: [],
        score: 8,
      },
      {
        id: 'p3',
        title: 'Evil Boot',
        url: 'https://evil.example/products/p3',
        price: 99,
        salePrice: null,
        currency: 'USD',
        availability: 'in_stock',
        image: null,
        issues: [],
        score: 7,
      },
    ],
    leftOut: [],
    locked: [],
    removed: [],
    added: [],
    ...over,
  });

  it("writes with the draft's shopping path, its prices kept and its names linked (shopping path)", async () => {
    generateObject.mockResolvedValue({
      object: {
        ...page,
        intro: [
          'Good hiking boots keep you dry. The Summit GTX Boot costs $189, or 189.00 USD. The Trail 450 Boot weighs [figure, source].',
          'At 450 g it is light, and $199 elsewhere.',
        ],
      },
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    rows.brand_domains = [{ domain: 'shop.example' }];
    // Sold out since the path was built: the catalog's stock now.
    rows.catalog_variants = [
      { id: 'v1', product_id: 'p1', availability: 'out of stock', price: 189, currency: 'USD' },
    ];
    await expect(run(draftRow({ shopping_path: shoppingPath() }))).resolves.toEqual({
      written: true,
    });
    const { prompt } = generateObject.mock.calls[0][0];
    expect(prompt).toContain('- Summit GTX Boot: 189.00 USD, out of stock');
    // A page off the brand's site isn't offered.
    expect(prompt).not.toContain('Evil Boot');
    const written = draftUpdates().find((u) => u.body_html)?.body_html;
    expect(written).toContain(
      '<a href="https://shop.example/collections/hiking-boots">hiking boots</a>',
    );
    expect(written).toContain(
      'The <a href="https://shop.example/products/p1">Summit GTX Boot</a> costs $189, or 189.00 USD.',
    );
    // A product's spec is the catalog's, never looked up: the sentence asking for one goes.
    expect(written).not.toContain('weighs');
    expect(generateText.mock.calls[0][0].prompt).not.toContain('Trail 450');
    // A product's own number where its name is: nowhere else, nor another
    // price. Looked up, found nowhere: left for the person, not taken out.
    expect(written).toContain('At [figure, source] g it is light, and [figure, source] elsewhere.');
  });

  it('writes a draft whose shopping path is broken as one with none', async () => {
    generateObject.mockResolvedValue({
      object: { ...page, intro: ['The Summit GTX Boot costs $189.'] },
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    rows.brand_domains = [{ domain: 'shop.example' }];
    for (const broken of [
      shoppingPath({ categories: { name: 'Hiking Boots' } }),
      shoppingPath({ products: [null] }),
    ]) {
      generateObject.mockClear();
      writes = [];
      await expect(run(draftRow({ shopping_path: broken }))).resolves.toEqual({ written: true });
      expect(generateObject.mock.calls[0][0].prompt).not.toContain('The shopping path');
      const written = draftUpdates().find((u) => u.body_html)?.body_html;
      // Its price is no catalog's now: no page has it, so it is the person's to fill.
      expect(written).toContain('<p>The Summit GTX Boot costs [figure, source].</p>');
    }
  });

  it("puts the checked path's products in stock as a grid, not the ones the draft keeps (shopping path, part 5)", async () => {
    generateObject.mockResolvedValue({
      object: {
        ...page,
        sections: [
          { heading: 'How to choose', paragraphs: ['Fit first.'], bullets: [] },
          {
            heading: 'Our picks',
            paragraphs: ['The Summit GTX Boot, then the Trail 450 Boot.'],
            bullets: [],
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    rows.brand_domains = [{ domain: 'shop.example' }];
    const variant = (id, productId, price) => ({
      id,
      product_id: productId,
      availability: 'in stock',
      price,
      sale_price: null,
      currency: 'USD',
    });
    // All in stock now, the first cheaper than when the path was built.
    rows.catalog_variants = [
      variant('v1', 'p1', 179),
      variant('v2', 'p2', 129),
      variant('v3', 'p3', 99),
      variant('v4', 'p4', 99),
    ];
    const kept = shoppingPath({ pageType: 'buying_guide' });
    // Kept as a member saved it: one page off the brand's site (Evil Boot), one over http.
    kept.products.push({
      ...kept.products[1],
      id: 'p4',
      title: 'Plain Boot',
      url: 'http://shop.example/products/p4',
    });
    await expect(
      run(draftRow({ page_type: 'buying_guide', shopping_path: kept })),
    ).resolves.toEqual({ written: true });
    const written = draftUpdates().find((u) => u.body_html)?.body_html;
    const encoded = /<div data-html-block="([^"]+)"><\/div>/.exec(written);
    const grid = Buffer.from(encoded[1], 'base64').toString('utf8');
    expect(grid.match(/class="getcito-product"/g)).toHaveLength(2);
    expect(grid).toContain('href="https://shop.example/products/p1"');
    expect(grid).toContain('href="https://shop.example/products/p2"');
    expect(grid).not.toContain('Evil Boot');
    expect(grid).not.toContain('Plain Boot');
    // The catalog's price now, not the one the path was built with.
    expect(grid).toContain('$179.00');
    expect(grid).not.toContain('$189.00');
    // At the end of the section that links them.
    expect(written).toMatch(
      /Trail 450 Boot<\/a>\.<\/p><div data-html-block="[^"]+"><\/div><h2>FAQ<\/h2>/,
    );
  });

  it('leaves a draft marked ready during the run as it is', async () => {
    finished = null;
    await expect(run(draftRow())).resolves.toEqual({ skipped: true });
    // The page wasn't written; the agent let go of the draft.
    expect(draftUpdates().at(-1)).toEqual({
      agent_state: null,
      agent_state_at: expect.any(String),
    });
  });
});

describe('runDraftWriting on an existing page', () => {
  const QUOTED = 'Pour-over coffee tastes cleaner than a French press.';
  const existing = draftRow({
    method: 'optimize',
    source_url: 'https://acme.example/pour-over',
    body_html: `<h1>Pour-over</h1><p>${QUOTED}</p><p>Use good coffee.</p>`,
    action_id: 'act-1',
  });
  const run = (over = {}) =>
    runDraftWriting({
      draft: existing,
      brand,
      model: 'model:m',
      input: input({ locked: [passageKey(QUOTED)], ...over }),
      budget,
    });

  it('leaves its suggestions for review, never on a locked passage', async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          {
            kind: 'replace',
            passage: 2,
            before: 'cleaner',
            after: 'brighter',
            reason: 'x',
            rules: [],
          },
          {
            kind: 'replace',
            passage: 3,
            before: 'good coffee',
            after: 'freshly ground coffee',
            reason: 'answer the ratio search',
            rules: ['faq'],
            // From the fan-out it answers, S2 (CE-033).
            sources: ['S2'],
            marks: [{ words: 'freshly ground coffee', source: 'S2' }],
          },
        ],
      },
      usage: {},
    });
    await expect(run()).resolves.toEqual({ suggestions: 1 });
    const batch = writes.find((w) => w.table === 'content_draft_suggestions').value;
    expect(batch).toEqual([
      expect.objectContaining({
        draft_id: DRAFT,
        action_id: 'act-1',
        block_text: 'Use good coffee.',
        before_text: 'good coffee',
        position: 0,
        sources: [{ kind: 'fanout', ref: 'pour over ratio', label: 'pour over ratio' }],
        source_marks: [{ start: 0, end: 21, source: 0 }],
      }),
    ]);
    expect(generateObject.mock.calls[0][0].prompt).toContain(`[2] (p, LOCKED) ${QUOTED}`);
    // An answer goes after a heading, never into it.
    expect(generateObject.mock.calls[0][0].system).toContain(
      'Never write an answer, a sentence or a FAQ into a heading',
    );
    // Links only to the pages and sources listed (A); none asked for here.
    expect(generateObject.mock.calls[0][0].system).toContain('Never invent a URL');
    expect(generateObject.mock.calls[0][0].system).toContain(
      'Call a change a fan-out answer only when it uses a fan-out listed',
    );
    expect(readLinkTargets).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: DRAFT, ruleKeys: new Set(['faq']) }),
    );
    expect(draftUpdates()).toEqual([
      { status: 'in_review', agent_state: null, agent_state_at: expect.any(String) },
    ]);
  });

  it('adds no batch over one that came in during the run', async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          { kind: 'replace', passage: 3, before: 'good', after: 'fresh', reason: 'x', rules: [] },
        ],
      },
      usage: {},
    });
    hasOpenSuggestions.mockResolvedValue(true);
    await expect(run()).resolves.toEqual({ skipped: true });
    expect(writes.some((w) => w.table === 'content_draft_suggestions')).toBe(false);
    expect(draftUpdates()).toEqual([{ agent_state: null, agent_state_at: expect.any(String) }]);
  });

  it('drops its suggestions when the draft was marked ready during the run', async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          { kind: 'replace', passage: 3, before: 'good', after: 'fresh', reason: 'x', rules: [] },
        ],
      },
      usage: {},
    });
    finished = null;
    await expect(run()).resolves.toEqual({ skipped: true });
    const batch = writes.find(
      (w) => w.table === 'content_draft_suggestions' && w.kind === 'insert',
    );
    const drop = writes.find((w) => w.table === 'content_draft_suggestions' && w.kind === 'delete');
    expect(drop.filters).toEqual([['batch_id', batch.value[0].batch_id]]);
  });

  it('says it failed when the model fails or leaves nothing to place', async () => {
    generateObject.mockResolvedValue({ object: { suggestions: [] }, usage: {} });
    await expect(run()).resolves.toEqual({ failed: true });
    generateObject.mockRejectedValue(new Error('timeout'));
    await expect(run()).resolves.toEqual({ failed: true });
    expect(draftUpdates()).toEqual([
      { agent_state: 'failed', agent_state_at: expect.any(String) },
      { agent_state: 'failed', agent_state_at: expect.any(String) },
    ]);
    // The first answer was paid for; the second never came, and its hold goes.
    expect(budget.charge).toHaveBeenCalledTimes(1);
    expect(budget.release).toHaveBeenCalledTimes(2);
  });

  it('charges an answer that missed the schema, as the provider billed it', async () => {
    const billed = { inputTokens: 5000, outputTokens: 6000 };
    generateObject.mockRejectedValueOnce(
      Object.assign(new NoObjectGeneratedError('no object'), { usage: billed }),
    );
    await expect(run()).resolves.toEqual({ failed: true });
    expect(budget.charge).toHaveBeenCalledTimes(1);
    expect(budget.charge).toHaveBeenCalledWith(billed);
    // The run still ends failed.
    expect(draftUpdates()).toEqual([{ agent_state: 'failed', agent_state_at: expect.any(String) }]);
  });
});

describe('Rewrite the page to these rules', () => {
  const QUOTED = 'Pour-over coffee tastes cleaner than a French press.';
  const existing = draftRow({
    method: 'optimize',
    status: 'in_review',
    body_html:
      `<h1>Pour-over</h1><p>${QUOTED}</p><p>Use good coffee. ${'Filler. '.repeat(20)}</p>` +
      '<table><tbody><tr><td>Ratio</td><td>1:16</td></tr></tbody></table>' +
      '<p>See <a href="/pricing">pricing</a>.</p>',
    action_id: 'act-1',
  });
  const locked = [passageKey(QUOTED)];
  const run = (over = {}) =>
    runDraftWriting({
      draft: existing,
      brand,
      model: 'model:m',
      input: input({ locked, ...over }),
      budget,
      rewrite: true,
    });
  const answer = (html, reason = 'cut to about 3,000 characters') =>
    generateObject.mockResolvedValue({
      object: { html, reason },
      usage: { inputTokens: 900, outputTokens: 700 },
    });

  it('starts only on a page with text, small enough to send whole, and no open batch', async () => {
    rows.content_drafts = existing;
    hasOpenSuggestions.mockResolvedValueOnce(true);
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input(), rewrite: true }),
    ).rejects.toMatchObject({ status: 409, code: 'open_suggestions' });
    rows.content_drafts = { ...existing, method: 'create', body_html: '<p> </p>' };
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input(), rewrite: true }),
    ).rejects.toMatchObject({ status: 422, code: 'empty' });
    rows.content_drafts = { ...existing, body_html: `<p>${'word '.repeat(13_000)}</p>` };
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input(), rewrite: true }),
    ).rejects.toMatchObject({ status: 422, code: 'too_long' });
    // Refused before anything was held or claimed.
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(draftUpdates()).toEqual([]);
  });

  it('claims the draft as a rewrite, so every device tries a failed one again as one', async () => {
    rows.content_drafts = existing;
    answer('<h1>Pour-over</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p><p>Shorter.</p>');
    await expect(
      startDraftWriting({
        draftId: DRAFT,
        brandId: BRAND,
        input: input({ locked }),
        rewrite: true,
      }),
    ).resolves.toEqual({ started: true });
    expect(draftUpdates()[0]).toMatchObject({ agent_state: 'writing', agent_run: 'rewrite' });
    await vi.waitFor(() => expect(draftUpdates().length).toBeGreaterThan(1));
  });

  it('leaves the whole page as one suggestion, with what it kept put back as it was', async () => {
    answer(
      '<h1>Pour-over coffee</h1><p>[[KEEP 1]]</p><p>Use good coffee, freshly ground.</p>' +
        '<p>[[KEEP 2]]</p><p>See <a href="/pricing">pricing</a> or <a href="https://evil.example">this</a>.</p>',
    );
    await expect(
      run({
        rules: [
          { key: 'length', name: 'Length', detail: 'aim: 3,000 characters' },
          { key: 'faq', name: 'FAQ with 5 questions', detail: 'aim: 5' },
        ],
      }),
    ).resolves.toEqual({ rewritten: true });

    const { system, prompt } = generateObject.mock.calls[0][0];
    expect(system).toContain('stands for a block kept word for word');
    // The quoted passage and the table never reach the model to rewrite:
    // they are described, and count toward Length.
    expect(prompt).toContain('Length: about 3000 characters.');
    expect(prompt).toMatch(
      /The page now, as HTML: about \d+ characters of text, \d+ of them in its kept blocks/,
    );
    expect(prompt).toContain(`- [[KEEP 1]]: a passage AI assistants quote today: "${QUOTED}"`);
    expect(prompt).toContain('- [[KEEP 2]]: a table, 1 rows: "Ratio1:16"');
    expect(prompt).not.toContain(`<p>${QUOTED}</p>`);
    expect(prompt).toContain("Write in the page's own language.");
    expect(budget.charge).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 700 });

    const row = writes.find((w) => w.table === 'content_draft_suggestions').value;
    expect(row).toMatchObject({
      draft_id: DRAFT,
      action_id: 'act-1',
      position: 0,
      kind: 'page',
      block_text: 'Pour-over',
      before_text: '',
      before_html: existing.body_html,
      reason: 'cut to about 3,000 characters',
      rule_keys: ['length', 'faq'],
      // What it was asked for and came to (00285): the kept passage and table count.
      length_target: 3000,
      kept_chars: textLength(`${QUOTED} Ratio 1:16`),
      after_chars: textLength(row.after_text),
    });
    expect(row.after_text).toBe(
      `<h1>Pour-over coffee</h1><p>${QUOTED}</p><p>Use good coffee, freshly ground.</p>` +
        '<table><tbody><tr><td>Ratio</td><td>1:16</td></tr></tbody></table>' +
        '<p>See <a href="/pricing">pricing</a> or this.</p>',
    );
    // The agent lets go; the draft's status stays as it was.
    expect(draftUpdates().at(-1)).toEqual({
      agent_state: null,
      agent_state_at: expect.any(String),
    });
  });

  it('keeps the data it wrote from, and no number without a source (CE-033)', async () => {
    generateObject.mockResolvedValue({
      object: {
        html:
          '<h1>Pour-over coffee</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p>' +
          '<p>Brew it in 4 minutes; 87% of baristas agree, as "pour over ratio" asks.</p>',
        reason: 'answered the ratio search',
        sources: ['S2', 'S7'],
      },
      usage: { inputTokens: 900, outputTokens: 700 },
    });
    await expect(run()).resolves.toEqual({ rewritten: true });
    const row = writes.find((w) => w.table === 'content_draft_suggestions').value;
    // Length off: it was asked for none (00285).
    expect(row.length_target).toBeNull();
    // The fan-out it named; S7 isn't on the list.
    expect(row.sources).toEqual([
      { kind: 'fanout', ref: 'pour over ratio', label: 'pour over ratio' },
    ]);
    // 87% is in none of the data: it is looked up, never with the kept
    // lines, and with no page that has it, left for the person ("Your
    // input needed"), never taken out unseen. A lone count stays; the kept
    // table's 1:16 is the page's own.
    expect(generateText.mock.calls[0][0].prompt).toContain(
      'G1: "Brew it in 4 minutes; 87% of baristas agree, as "pour over ratio" asks."\nneeds: check: 87%',
    );
    expect(generateText.mock.calls[0][0].prompt).not.toContain('KEEP');
    expect(row.after_text).toContain(
      '<p>Brew it in 4 minutes; [figure, source] of baristas agree, as "pour over ratio" asks.</p>',
    );
    expect(row.after_text).toContain('<td>1:16</td>');
    expect(generateObject.mock.calls[0][0].system).toContain('Put the numbers (S1, S2…)');
  });

  it('puts a person or a quote it was not given as a placeholder, and knows the authors (CE-044)', async () => {
    rows.content_authors = [{ name: 'Ada Lovelace', title: null, bio: null }];
    answer(
      '<h1>Pour-over coffee</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p>' +
        '<p>“Pour slowly and you taste every note,” said Marco Rossi.</p>' +
        '<p>Ada Lovelace said the bloom matters.</p>',
    );
    await expect(run()).resolves.toEqual({ rewritten: true });
    const row = writes.find((w) => w.table === 'content_draft_suggestions').value;
    expect(row.after_text).toContain(`<p>${QUOTE_PLACEHOLDER} said ${NAME_PLACEHOLDER}.</p>`);
    expect(row.after_text).toContain('<p>Ada Lovelace said the bloom matters.</p>');
    // What it kept is the page's own, as it was.
    expect(row.after_text).toContain(`<p>${QUOTED}</p>`);
    expect(row.after_text).toContain(
      '<table><tbody><tr><td>Ratio</td><td>1:16</td></tr></tbody></table>',
    );
  });

  it('keeps the page’s length when the Length rule is off', async () => {
    answer('<h1>Pour-over</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p><p>Shorter.</p>');
    await run({ rules: [{ key: 'faq', name: 'FAQ', detail: '' }] });
    const { prompt } = generateObject.mock.calls[0][0];
    expect(prompt).toContain(`Length: about ${textLength(existing.body_html)} characters.`);
  });

  it('fails the run on an answer that isn’t a page in HTML', async () => {
    answer('# Pour-over\n\n[[KEEP 1]]\n\n[[KEEP 2]]');
    await expect(run()).resolves.toEqual({ failed: true });
    expect(writes.find((w) => w.table === 'content_draft_suggestions')).toBeUndefined();
  });

  it('drops the rewrite of a page marked ready during the run', async () => {
    answer('<h1>Pour-over</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p><p>Shorter.</p>');
    finished = null;
    await expect(run()).resolves.toEqual({ skipped: true });
    const insert = writes.find(
      (w) => w.table === 'content_draft_suggestions' && w.kind === 'insert',
    );
    const drop = writes.find((w) => w.table === 'content_draft_suggestions' && w.kind === 'delete');
    expect(drop.filters).toContainEqual(['batch_id', insert.value.batch_id]);
  });

  it('fails the run when the rewrite drops what it had to keep', async () => {
    answer('<h1>Pour-over</h1><p>[[KEEP 2]]</p><p>A new page without the quoted passage.</p>');
    await expect(run()).resolves.toEqual({ failed: true });
    expect(writes.find((w) => w.table === 'content_draft_suggestions')).toBeUndefined();
    expect(draftUpdates()).toEqual([{ agent_state: 'failed', agent_state_at: expect.any(String) }]);
    // The answer was still paid for.
    expect(budget.charge).toHaveBeenCalledTimes(1);
  });

  it('adds nothing over a batch that came in during the run', async () => {
    answer('<h1>Pour-over</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p><p>Shorter.</p>');
    hasOpenSuggestions.mockResolvedValue(true);
    await expect(run()).resolves.toEqual({ skipped: true });
    expect(writes.find((w) => w.table === 'content_draft_suggestions')).toBeUndefined();
  });

  describe('a rewrite past its Length: one more pass cuts it', () => {
    const cutBudget = {
      charge: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
      keep: vi.fn(async () => {}),
    };
    // A Length of 100 (up to 120): a cut pass past 120. The first answer is 199 characters.
    const toLength = (length = 100) => ({
      rules: [{ key: 'length', name: 'Length', detail: `aim: ${length} characters` }],
      sources: { ...input().sources, length },
    });
    const long = `<h1>Pour-over coffee</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p><p>${'Long words. '.repeat(10)}</p>`;
    const short = '<h1>Pour-over coffee</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p><p>Short.</p>';
    const answers = (...htmls) => {
      for (const [i, html] of htmls.entries()) {
        generateObject.mockResolvedValueOnce({
          object: { html, reason: i ? 'cut it' : 'answered each heading first', sources: [] },
          usage: { inputTokens: 900 + i, outputTokens: 700 + i },
        });
      }
    };
    const row = () => writes.find((w) => w.table === 'content_draft_suggestions').value;
    beforeEach(() => {
      cutBudget.charge.mockClear();
      cutBudget.release.mockClear();
      cutBudget.keep.mockClear();
      reserveAiBudget.mockReset().mockResolvedValue(cutBudget);
    });

    it('cuts its own page to the Length on its own hold, keeping every kept line', async () => {
      answers(long, short);
      await expect(run(toLength())).resolves.toEqual({ rewritten: true });
      expect(generateObject).toHaveBeenCalledTimes(2);
      const { prompt } = generateObject.mock.calls[1][0];
      expect(prompt).toContain('Its Length is 100 characters, up to 120. Cut it to about 100.');
      expect(prompt).toContain('every [[KEEP n]] line exactly as it is');
      expect(prompt).toContain('Long words.');
      expect(reserveAiBudget).toHaveBeenCalledWith('org-1', {
        feature: 'content',
        modelId: expect.any(String),
        draftId: DRAFT,
      });
      expect(cutBudget.charge).toHaveBeenCalledWith({ inputTokens: 901, outputTokens: 701 });
      // The cut page, what it kept put back, the first pass's reason.
      expect(row().after_text).toContain('Short.');
      expect(row().after_text).not.toContain('Long words.');
      expect(row().after_text).toContain(QUOTED);
      expect(row().reason).toBe('answered each heading first');
      expect(row().after_chars).toBe(textLength(row().after_text));
    });

    it('rewrites and cuts with the model it was started with, held at its own id', async () => {
      answers(long, short);
      await runDraftWriting({
        draft: existing,
        brand,
        model: `model:${SONNET}`,
        modelId: SONNET,
        input: input({ locked, ...toLength() }),
        budget,
        rewrite: true,
      });
      expect(generateObject).toHaveBeenCalledTimes(2);
      for (const [call] of generateObject.mock.calls) {
        expect(call.model).toBe(`model:${SONNET}`);
        expectClaudeCall(call);
      }
      expect(reserveAiBudget).toHaveBeenCalledWith('org-1', {
        feature: 'content',
        modelId: SONNET,
        draftId: DRAFT,
      });
    });

    it('keeps the first rewrite when the cut is no shorter, drops a kept line, fails or has no budget', async () => {
      answers(long, long);
      await run(toLength());
      expect(row().after_text).toContain('Long words.');

      writes = [];
      answers(long, '<h1>Pour-over coffee</h1><p>[[KEEP 1]]</p><p>Short.</p>');
      await run(toLength());
      expect(row().after_text).toContain('Long words.');

      // Kept lines written into a paragraph: restoreKept couldn't put them back.
      writes = [];
      answers(long, '<h1>Pour-over coffee</h1><p>[[KEEP 1]] [[KEEP 2]] Short.</p>');
      await expect(run(toLength())).resolves.toEqual({ rewritten: true });
      expect(row().after_text).toContain('Long words.');

      writes = [];
      generateObject.mockResolvedValueOnce({
        object: { html: long, reason: 'answered each heading first', sources: [] },
        usage: { inputTokens: 900, outputTokens: 700 },
      });
      generateObject.mockRejectedValueOnce(new Error('provider down'));
      cutBudget.charge.mockClear();
      cutBudget.release.mockClear();
      await expect(run(toLength())).resolves.toEqual({ rewritten: true });
      expect(row().after_text).toContain('Long words.');
      // Nothing billed for a failed call: its hold goes.
      expect(cutBudget.charge).not.toHaveBeenCalled();
      expect(cutBudget.release).toHaveBeenCalled();

      writes = [];
      generateObject.mockReset();
      reserveAiBudget.mockRejectedValueOnce(
        Object.assign(new Error('used up'), { code: 'plan_limit' }),
      );
      answers(long);
      await run(toLength());
      expect(generateObject).toHaveBeenCalledTimes(1);
      expect(row().after_text).toContain('Long words.');
    });

    it('keeps the hold of a cut stopped while it runs, and writes nothing', async () => {
      const { RunStoppedError } = await import('./contentRuns.js');
      answers(long);
      generateObject.mockRejectedValueOnce(new RunStoppedError());
      cutBudget.keep.mockClear();
      await run(toLength());
      expect(cutBudget.keep).toHaveBeenCalledTimes(1);
      expect(
        writes.find((w) => w.table === 'content_draft_suggestions' && w.kind === 'insert'),
      ).toBeUndefined();
    });

    it('cuts a rewrite only a little past its band too (editor test 2026-11-03)', async () => {
      // A Length of 150 (up to 180): 199 is past it, though within 15% of it.
      answers(long, short);
      await run(toLength(150));
      expect(generateObject).toHaveBeenCalledTimes(2);
      expect(generateObject.mock.calls[1][0].prompt).toContain(
        'Its Length is 150 characters, up to 180. Cut it to about 150.',
      );
      expect(row().after_text).toContain('Short.');
    });

    it('cuts nothing within reach of the Length, or with Length off', async () => {
      answers(long);
      await run(toLength(3000));
      answers(long);
      await run();
      expect(generateObject).toHaveBeenCalledTimes(2);
      expect(reserveAiBudget).not.toHaveBeenCalled();
    });
  });
});

describe('the write prompt', () => {
  afterEach(() => vi.unstubAllEnvs());

  it("puts the brand's rules first, before the writer's own (00450)", () => {
    const prompt = (rules) =>
      buildWritePrompt({
        brand: { ...brand, rules },
        draft: draftRow(),
        brief: 'No brief.',
        input: { sources: { length: 3000 }, rules: [], textRules: ['Short sentences.'] },
      });
    const written = prompt(['No topics comparing us with a named competitor.']);
    expect(written).toContain(
      "The brand's rules, which come first:\n- No topics comparing us with a named competitor.",
    );
    expect(written.indexOf("The brand's rules")).toBeLessThan(
      written.indexOf("The writer's own rules:"),
    );
    // None: the prompt is as it was.
    expect(prompt([])).not.toContain("The brand's rules");
    expect(prompt(undefined)).not.toContain("The brand's rules");
  });

  it('names the brand’s site type once Quality’s phase 2 is live (CE-056)', () => {
    const write = (phase) => {
      vi.stubEnv('CONTENT_QUALITY_PHASE', phase);
      return buildWritePrompt({
        brand,
        draft: draftRow(),
        brief: 'No brief.',
        input: { sources: { length: 3000 }, rules: [], textRules: [] },
      });
    };
    expect(write('2')).toContain(
      'Industry: Coffee\nSite type: B2B SaaS (software or services sold to businesses)\nDescription:',
    );
    expect(write('')).toContain('Industry: Coffee\nDescription:');
  });

  it('tells an existing page’s suggestions how long it is now, beside its Length', () => {
    const LENGTH = [{ key: 'length', name: 'Length' }];
    const prompt = (bodyHtml, passages = [{ tag: 'p', text: 'Brew it slowly.' }], rules = LENGTH) =>
      buildWritePrompt({
        brand,
        draft: draftRow({ body_html: bodyHtml }),
        brief: 'No brief.',
        input: { sources: { length: 3000 }, rules, textRules: [] },
        passages,
        lockedKeys: new Set(),
      });
    // 5,353 characters for a Length of 3,000, as the page that went to Webflow.
    expect(prompt(`<p>${'x'.repeat(5353)}</p>`)).toContain(
      'Length: about 3000 characters. The page is about 5353 characters now, over its Length: suggest cuts',
    );
    expect(prompt(`<p>${'x'.repeat(3100)}</p>`)).toContain(
      'The page is about 3100 characters now: keep it about this long.',
    );
    // A new page has no length yet.
    expect(prompt('', null)).toContain('Length: about 3000 characters.\n');
    // Length off keeps the page's length: no cuts asked for it.
    const off = prompt(`<p>${'x'.repeat(5353)}</p>`, undefined, []);
    expect(off).toContain('Length: about 3000 characters.\n');
    expect(off).not.toContain('suggest cuts');
    expect(off).not.toContain('characters now');
  });
});

describe('lengthNow', () => {
  it('reads a page over, under or within its Length’s band (±20%)', () => {
    expect(lengthNow(3601, 3000)).toMatch(/over its Length: suggest cuts/);
    expect(lengthNow(3600, 3000)).toMatch(/keep it about this long/);
    expect(lengthNow(2400, 3000)).toMatch(/keep it about this long/);
    expect(lengthNow(2399, 3000)).toMatch(/under its Length: add what/);
  });
});

describe('the brief rules (2026) in the Content Agent', () => {
  afterEach(() => vi.unstubAllEnvs());
  const planned = {
    goal: 'Sell beans',
    audience: 'Home brewers',
    outline: [
      {
        heading: 'Ratio',
        keyPoints: ['Grams per cup'],
        fanout: null,
        platform: null,
        answer: 'Name the ratio first.',
        format: 'table',
        facts: [{ claim: 'The ratio cafés use', sourceType: 'study', source: null }],
      },
    ],
    keywords: ['pour over'],
    version: 2,
    tldr: 'A 1:16 ratio suits most beans.',
    proof: [{ kind: 'test', what: 'Our cupping notes' }],
  };
  // A plan whose facts name their sources, and whose links' addresses hold a
  // number and a name the agent wasn't given.
  const linked = {
    ...planned,
    outline: [
      {
        ...planned.outline[0],
        facts: [
          {
            claim: 'Our grind sizes',
            sourceType: 'example',
            source: { kind: 'input', ref: 'in-1', label: 'Grind chart' },
          },
          {
            claim: 'The ratio cafés use',
            sourceType: 'study',
            source: {
              kind: 'cited_page',
              ref: 'https://news.example/ratio',
              label: 'https://news.example/ratio',
            },
          },
        ],
      },
    ],
    links: {
      internal: [
        { anchor: 'our tools', url: 'https://acme.example/top-37-tools', section: 'Ratio' },
      ],
      outbound: [
        {
          anchor: 'an interview',
          url: 'https://news.example/interview-with-john-smith',
          section: null,
        },
      ],
    },
  };

  it('has every prompt look a fact up, never leave it in square brackets for the person', () => {
    // A page waited on "[About]", "[OpenAI release notes]" and "[competitor]";
    // another on "[price]" and "[plan limits]" (2026-10-29).
    for (const prompt of [
      writeSystemPrompt(),
      suggestSystemPrompt(),
      rewriteSystemPrompt(),
      AGENT_SYSTEM_PROMPT,
    ]) {
      expect(prompt).toContain(RESEARCH_RULE);
      expect(prompt).not.toMatch(/(?<!Never )write a placeholder in square brackets/i);
    }
    expect(RESEARCH_RULE).toContain(
      'a page, a document, a link, a product, a brand or a competitor',
    );
    expect(RESEARCH_RULE).toContain('"OpenAI\'s release notes"');
  });

  it('asks as before while they are off: the same prompts, the brief as version 1', () => {
    expect(writeSystemPrompt()).toBe(WRITE_SYSTEM_PROMPT);
    expect(rewriteSystemPrompt()).toBe(REWRITE_SYSTEM_PROMPT);
    expect(suggestSystemPrompt()).not.toContain(WRITING_GUARDRAIL);
    // Word for word what version 1's fields give.
    expect(briefText(planned, null)).toBe(
      briefText(
        {
          goal: planned.goal,
          audience: planned.audience,
          keywords: planned.keywords,
          outline: planned.outline.map((s) => ({
            heading: s.heading,
            keyPoints: s.keyPoints,
            fanout: s.fanout,
            platform: s.platform,
          })),
        },
        null,
      ),
    );
    expect(briefText(planned, null)).not.toContain('TL;DR');
  });

  it('with them on, gives each prompt the guardrail and the writer the plan and short headings', () => {
    vi.stubEnv('CONTENT_BRIEF_RULES', 'true');
    for (const prompt of [writeSystemPrompt(), suggestSystemPrompt(), rewriteSystemPrompt()]) {
      expect(prompt).toContain(WRITING_GUARDRAIL);
    }
    expect(writeSystemPrompt()).toContain("Follow the brief's section plans");
    expect(writeSystemPrompt()).toContain('each section heading about 8 to 15 words');
    const brief = briefText(planned, null);
    expect(brief).toContain('Goal: Sell beans');
    expect(brief).toContain("TL;DR (what the page's top must say): A 1:16 ratio suits most beans.");
    expect(brief).toContain(
      '- Ratio — answer first: Name the ratio first.; show as a comparison, the same points for each option in turn; give a fact on: The ratio cafés use (study, look it up with {{find: …}})',
    );
    expect(brief).toContain(
      'Proof to gather (write it only from Your input; else {{ask: …}}): test: Our cupping notes',
    );
  });

  it('writes a new page from the plan, with them on', async () => {
    vi.stubEnv('CONTENT_BRIEF_RULES', 'true');
    await runDraftWriting({
      draft: draftRow({ brief: planned }),
      brand,
      model: 'model:m',
      input: input(),
      budget,
    });
    const call = generateObject.mock.calls[0][0];
    expect(call.system).toContain(WRITING_GUARDRAIL);
    expect(call.prompt).toContain('Section plans:');
  });

  it("names a fact's source by its kind, and leaves the planned links out for a new page", async () => {
    vi.stubEnv('CONTENT_BRIEF_RULES', 'true');
    const brief = briefText(linked, null);
    expect(brief).toContain(
      'give a fact on: Our grind sizes (example, from Your input "Grind chart")',
    );
    expect(brief).toContain(
      "give a fact on: The ratio cafés use (study, look it up with {{find: …}}: https://news.example/ratio may have it, but you don't see its words)",
    );
    expect(brief).toContain(
      'Links planned (only as the links rule allows): "our tools" → https://acme.example/top-37-tools in "Ratio"',
    );
    expect(briefText(linked, null, { links: false })).not.toContain('Links planned');
    // A new page's writer has no links rule: it isn't told of them.
    await runDraftWriting({
      draft: draftRow({ brief: linked }),
      brand,
      model: 'model:m',
      input: input(),
      budget,
    });
    expect(generateObject.mock.calls[0][0].prompt).not.toContain('Links planned');
  });

  it('gives an existing page’s suggestions the guardrail and the links planned', async () => {
    vi.stubEnv('CONTENT_BRIEF_RULES', 'true');
    generateObject.mockResolvedValue({
      object: { suggestions: [] },
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    await runDraftWriting({
      draft: draftRow({
        method: 'optimize',
        source_url: 'https://acme.example/pour-over',
        body_html: '<h1>Pour-over</h1><p>Use good coffee.</p>',
        brief: linked,
      }),
      brand,
      model: 'model:m',
      input: input(),
      budget,
    });
    const call = generateObject.mock.calls[0][0];
    expect(call.system).toContain(WRITING_GUARDRAIL);
    expect(call.prompt).toContain('Links planned');
  });

  it("never lets a planned link's address vouch for a number or a name", async () => {
    vi.stubEnv('CONTENT_BRIEF_RULES', 'true');
    generateObject.mockResolvedValue({
      object: {
        html:
          '<h1>Pour-over</h1><p>Try 37 tools for it.</p>' +
          '<p>John Smith said the bloom matters.</p>',
        reason: 'followed the plan',
      },
      usage: { inputTokens: 900, outputTokens: 700 },
    });
    await expect(
      runDraftWriting({
        draft: draftRow({
          method: 'optimize',
          status: 'in_review',
          body_html: '<h1>Pour-over</h1><p>Use good coffee.</p>',
          brief: linked,
        }),
        brand,
        model: 'model:m',
        input: input(),
        budget,
        rewrite: true,
      }),
    ).resolves.toEqual({ rewritten: true });
    const call = generateObject.mock.calls[0][0];
    expect(call.system).toContain(WRITING_GUARDRAIL);
    // The rewrite is told of the links; its guards never read their addresses.
    expect(call.prompt).toContain('https://acme.example/top-37-tools');
    const row = writes.find((w) => w.table === 'content_draft_suggestions').value;
    // "37" is the link's, never the page's: looked up, found nowhere, left for the person.
    expect(row.after_text).toContain('<p>Try [figure, source] tools for it.</p>');
    // A person it wasn't given is the person's to name: "Your input needed".
    expect(row.after_text).toContain(`<p>${NAME_PLACEHOLDER} said the bloom matters.</p>`);
  });
});

describe('a health brand’s page (owner’s safety rule, 2026-11-03)', () => {
  const vitaroot = {
    ...brand,
    name: 'VitaRoot',
    industry: 'Dietary supplements',
    description: 'Makes magnesium and vitamin D supplements in capsules.',
  };
  const DISCLAIMER =
    'This product is not intended to diagnose, treat, cure or prevent any disease.';
  const OWN = 'VitaRoot Magnesium Glycinate helps you relax after a long day.';
  const SLEEP_FIND = '{{find: what clinical research says about magnesium glycinate and sleep}}';
  const draft = (over = {}) =>
    draftRow({
      title: 'Magnesium glycinate: what to know before you buy',
      body_html: `<h1>Magnesium glycinate: what to know before you buy</h1><p>${OWN}</p><p>${DISCLAIMER}</p>`,
      ...over,
    });
  const run = (over = {}, rewrite = false) =>
    runDraftWriting({
      draft: draft(over),
      brand: vitaroot,
      model: 'model:m',
      input: input(),
      budget,
      rewrite,
    });
  /** What the facts pass was asked to look up, in all its calls. */
  const lookedUp = () => generateText.mock.calls.map(([call]) => call.prompt).join('\n');

  it('writes a new page without a claim it didn’t make, and never looks one up', async () => {
    generateObject.mockResolvedValue({
      object: {
        title: 'Magnesium glycinate: what to know before you buy',
        intro: [
          `${OWN} Magnesium glycinate may help some people sleep.`,
          'A bottle costs {{find: VitaRoot magnesium glycinate bottle price}}.',
        ],
        sections: [
          {
            heading: 'Does magnesium glycinate help you sleep?',
            paragraphs: [`Research says ${SLEEP_FIND}.`],
            bullets: [],
          },
          { heading: 'Is it a medicine?', paragraphs: [DISCLAIMER], bullets: [] },
        ],
        faqHeading: '',
        faq: [],
      },
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    await expect(run()).resolves.toEqual({ written: true });
    expect(generateObject.mock.calls[0][0].system).toContain(
      'never write {{find: …}} for one: none is looked up',
    );
    // The price is looked up; the health effect never is.
    expect(lookedUp()).toContain('find: VitaRoot magnesium glycinate bottle price');
    expect(lookedUp()).not.toContain('clinical research');
    const written = draftUpdates().find((u) => u.body_html).body_html;
    expect(written).not.toContain('may help some people sleep');
    expect(written).not.toContain('Does magnesium glycinate help you sleep?');
    // The brand's own claim and its safety line stay.
    expect(written).toContain(`<p>${OWN}</p>`);
    expect(written).toContain(`<h2>Is it a medicine?</h2><p>${DISCLAIMER}</p>`);
  });

  it('leaves no suggestion that adds a claim or asks for one, and keeps the others', async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          {
            kind: 'insert',
            passage: 2,
            before: '',
            after: `<h2>Does magnesium glycinate help you sleep?</h2><p>Research says ${SLEEP_FIND}.</p>`,
            reason: 'answer the fan-out',
            rules: ['faq'],
          },
          {
            kind: 'insert',
            passage: 2,
            before: '',
            after: '<p>Magnesium glycinate may help some people sleep.</p>',
            reason: 'answer the fan-out',
            rules: ['faq'],
          },
          {
            kind: 'insert',
            passage: 3,
            before: '',
            after:
              '<h2>Who is it for?</h2><p>Adults who want a magnesium supplement. Talk to your doctor before you start any supplement.</p>',
            reason: 'add a section',
            rules: ['faq'],
          },
        ],
      },
      usage: {},
    });
    await expect(run({ method: 'optimize' })).resolves.toEqual({ suggestions: 1 });
    // Nothing to look up once the health effect went.
    expect(lookedUp()).not.toContain('clinical research');
    const batch = writes.find((w) => w.table === 'content_draft_suggestions').value;
    expect(batch.map((row) => row.after_text)).toEqual([
      '<h2>Who is it for?</h2><p>Adults who want a magnesium supplement. Talk to your doctor before you start any supplement.</p>',
    ]);
  });

  it('rewrites a page without a claim it didn’t make, and never looks one up', async () => {
    generateObject.mockResolvedValue({
      object: {
        html:
          `<h1>Magnesium glycinate</h1><p>${OWN} It supports restful sleep.</p>` +
          `<h2>Does it help you sleep?</h2><p>Research says ${SLEEP_FIND}.</p>` +
          `<h2>Is it a medicine?</h2><p>${DISCLAIMER}</p>`,
        reason: 'answered each heading first',
      },
      usage: { inputTokens: 900, outputTokens: 700 },
    });
    await expect(run({ method: 'optimize', status: 'in_review' }, true)).resolves.toEqual({
      rewritten: true,
    });
    expect(generateObject.mock.calls[0][0].system).toContain('never write {{find: …}} for one');
    expect(lookedUp()).not.toContain('clinical research');
    const row = writes.find((w) => w.table === 'content_draft_suggestions').value;
    // The question left with no answer goes with it.
    expect(row.after_text).toBe(
      `<h1>Magnesium glycinate</h1><p>${OWN}</p><h2>Is it a medicine?</h2><p>${DISCLAIMER}</p>`,
    );
  });

  it('leaves another brand’s page to the prompt: its guards don’t read health claims', async () => {
    generateObject.mockResolvedValue({
      object: { ...page, intro: ['A warm cup helps you relax.'] },
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    await expect(
      runDraftWriting({ draft: draftRow(), brand, model: 'model:m', input: input(), budget }),
    ).resolves.toEqual({ written: true });
    expect(generateObject.mock.calls[0][0].system).toContain('- Health: never write');
    expect(draftUpdates().find((u) => u.body_html).body_html).toContain(
      '<p>A warm cup helps you relax.</p>',
    );
  });
});
