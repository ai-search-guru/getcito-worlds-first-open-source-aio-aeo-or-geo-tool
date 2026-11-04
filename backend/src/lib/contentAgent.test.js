import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fix open rules with agent (Content Editor CE-018): the Content Agent's
 * suggestions on the open rules, kept only where the editor can apply them,
 * never on a locked passage, and metered from the AI usage budget.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';

let rows;
let writes;
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
/** The functions called, with what they were sent. */
const rpc = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    rpc: (...args) => rpc(...args),
    from: (table) => {
      const result = () => ({ data: rows[table] ?? null, error: null });
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        in: () => chain,
        gt: () => chain,
        order: () => chain,
        range: () => chain,
        then: (resolve) => resolve(result()),
        limit: async () => result(),
        insert: async (value) => (writes.push({ table, value }), { error: null }),
        maybeSingle: async () => result(),
        single: async () => result(),
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
vi.mock('./aiProvider.js', () => ({
  resolveModel: vi.fn((id) => `model:${id}`),
  webSearchTools: () => ({ web_search: { id: 'anthropic.web_search_20250305' } }),
}));
vi.mock('./planGuard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reserveAiBudget: (...args) => reserveAiBudget(...args),
}));
vi.mock('./logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const stopIfStopped = vi.fn();
/** A run's start, take-back and finish, when a test stands in for them. */
const runs = vi.hoisted(() => ({ startRun: null, dropRun: null, finishRun: null }));
vi.mock('./contentRuns.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    stopIfStopped: (...args) => stopIfStopped(...args),
    startRun: (...args) => (runs.startRun ?? real.startRun)(...args),
    dropRun: (...args) => (runs.dropRun ?? real.dropRun)(...args),
    finishRun: (...args) => (runs.finishRun ?? real.finishRun)(...args),
  };
});
const readLinkTargets = vi.fn();
vi.mock('./contentLinks.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readLinkTargets: (...args) => readLinkTargets(...args),
}));

const {
  asksMoreThanOne,
  buildFixPrompt,
  cleanInsertHtml,
  draftPassages,
  addsAttribution,
  attributableSources,
  attributedNames,
  dropsName,
  placeholderAttributions,
  placeholderAttributionsInHtml,
  bannedWordsOf,
  dropsPlaceholder,
  emptyWhy,
  fixDraftRules,
  fixRulesInput,
  keepSuggestions,
  growsPastLimit,
  htmlLines,
  HEADING_LIMITS,
  inlineText,
  MAX_PROMPT_PASSAGE_CHARS,
  passageKey,
  promptPassages,
  splitReplace,
} = await import('./contentAgent.js');
const { linkKey, NO_LINK_TARGETS } = await import('./contentLinks.js');
const { knownNumbers, numberSources } = await import('./contentSources.js');
const { NAME_PLACEHOLDER, QUOTE_PLACEHOLDER, guardPeople, knownPeople } =
  await import('./contentPeople.js');
const { PlanLimitError } = await import('./planGuard.js');
const { logger } = await import('./logger.js');
// The real hold: self-hosted here, so it reserves nothing and writes each charge.
const realGuard = await vi.importActual('./planGuard.js');

const BODY =
  '<h1>How to brew pour-over coffee</h1><p>Pour-over coffee tastes better than other methods.</p>' +
  '<ul><li><p>A dripper and a filter</p></li></ul><p>Use good coffee and hot water.</p>';

const input = (over = {}) => ({
  rules: [
    { key: 'dated', name: 'A dated data point', detail: 'missing' },
    { key: 'faq', name: 'FAQ with 5 questions', detail: 'missing' },
  ],
  textRules: ['Say “we” for the brand'],
  locked: [passageKey('Pour-over coffee tastes better than other methods.')],
  ...over,
});

const suggestion = (over = {}) => ({
  kind: 'replace',
  passage: 4,
  before: 'good coffee and hot water',
  after: 'a 1:16 ratio of freshly ground coffee to hot water ([source, year])',
  reason: 'add a dated data point (rule)',
  rules: ['dated', 'made-up'],
  // Its words from the cited page, S2; its 1:16 is the fan-out's own (CE-033).
  sources: ['S2'],
  marks: [{ words: 'freshly ground coffee', source: 'S2' }],
  ...over,
});

/** The sources an editor keeps, numbered as the agent reads them: a fan-out (S1), a cited page (S2). */
const SOURCES = {
  promptIds: [],
  fanouts: [{ query: 'Pour over ratio 1:16', platforms: ['chatgpt'] }],
  pages: [{ url: 'https://sca.example/brew', kind: 'publication' }],
  queries: [],
  headings: [],
  length: 3000,
};
const sourcing = { numbered: numberSources(SOURCES) };

beforeEach(() => {
  stopIfStopped.mockReset().mockResolvedValue(undefined);
  writes = [];
  // A function's rows, by its name (content_suggestion_decisions, 00367).
  rpc.mockReset().mockImplementation(async (name) => ({ data: rows[name] ?? [], error: null }));
  rows = {
    content_drafts: {
      id: DRAFT,
      brand_id: BRAND,
      title: 'How to brew pour-over coffee',
      body_html: BODY,
      page_type: 'guide',
      action_id: 'act-1',
      status: 'draft',
    },
    brands: { name: 'Acme Coffee', organization_id: 'org-1', language: 'en' },
  };
  generateObject.mockReset();
  generateText.mockReset().mockImplementation(notFound);
  reserveAiBudget.mockReset().mockImplementation(realGuard.reserveAiBudget);
  readLinkTargets.mockReset().mockResolvedValue(NO_LINK_TARGETS);
  // The model as a server without an Anthropic key picks it, whatever the shell has.
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('CONTENT_WRITE_MODEL', '');
  // The facts pass searches on Anthropic only (contentResearch.js searchesCapped).
  vi.stubEnv('CONTENT_READ_MODEL', 'anthropic/claude-haiku-5-5');
});
afterEach(() => vi.unstubAllEnvs());

describe('the page as the agent reads it', () => {
  it('reads headings and paragraphs in order, as the editor does', () => {
    expect(draftPassages(BODY)).toEqual([
      { tag: 'h1', text: 'How to brew pour-over coffee' },
      { tag: 'p', text: 'Pour-over coffee tastes better than other methods.' },
      { tag: 'p', text: 'A dripper and a filter' },
      { tag: 'p', text: 'Use good coffee and hot water.' },
    ]);
  });

  it('compares passages by their words, as the editor does', () => {
    expect(passageKey('Pour-over’s 94 °C — “Fresh”.')).toBe('pour overs 94 c fresh');
  });

  it('marks locked passages and lists the rules for the model', () => {
    const passages = draftPassages(BODY);
    const prompt = buildFixPrompt({
      brand: { name: 'Acme Coffee', language: 'en' },
      draft: rows.content_drafts,
      passages,
      lockedKeys: new Set(input().locked),
      input: input(),
    });
    expect(prompt).toContain('[2] (p, LOCKED) Pour-over coffee tastes better than other methods.');
    expect(prompt).toContain('[4] (p) Use good coffee and hot water.');
    expect(prompt).toContain('- dated: A dated data point — missing');
    expect(prompt).toContain('- Say “we” for the brand');
    expect(prompt).toContain('Write in English.');
    expect(prompt).toContain('Page type: How-to guide: numbered steps');
    expect(prompt).not.toContain('The page goes on');
  });

  it("puts the brand's rules before the writer's own in every change (00450)", () => {
    const prompt = buildFixPrompt({
      brand: {
        name: 'Acme Coffee',
        language: 'en',
        rules: ['Cite official sources for health claims.'],
      },
      draft: rows.content_drafts,
      passages: draftPassages(BODY),
      lockedKeys: new Set(),
      input: input(),
    });
    expect(prompt).toContain(
      "The brand's rules, to follow in every change, before the writer's own:\n- Cite official sources for health claims.",
    );
    expect(prompt.indexOf("The brand's rules")).toBeLessThan(
      prompt.indexOf("The writer's own rules"),
    );
  });

  describe('with Quality’s phase 2 live', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('names the brand’s site type after its industry (CE-056)', () => {
      vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
      const prompt = buildFixPrompt({
        brand: { name: 'Acme Coffee', industry: 'Food & Beverage', language: 'en' },
        draft: rows.content_drafts,
        passages: draftPassages(BODY),
        lockedKeys: new Set(),
        input: input(),
      });
      expect(prompt).toContain(
        'Industry: Food & Beverage\nSite type: E-commerce (an online shop selling products)\nDescription:',
      );
    });
  });

  it('tells it of a page over its Length it isn’t asked to shorten (editor test 2026-10-26)', () => {
    const prompt = (overLength) =>
      buildFixPrompt({
        brand: { name: 'Acme Coffee', language: 'en' },
        draft: rows.content_drafts,
        passages: draftPassages(BODY),
        lockedKeys: new Set(),
        input: { ...input(), overLength },
      });
    expect(prompt({ count: 17_683, max: 16_798 })).toContain(
      "- faq: FAQ with 5 questions — missing\nThe page is already 17,683 characters, past the most its Length allows (16,798). The Length isn't among the rules here, so don't cut the page for it.",
    );
    // Within its Length, or none sent: nothing said.
    expect(prompt({ count: 9_000, max: 16_798 })).not.toContain('its Length allows');
    expect(prompt(undefined)).not.toContain('its Length allows');
    expect(
      fixRulesInput.parse({ ...input(), overLength: { count: 17_683, max: 16_798 } }),
    ).toMatchObject({
      overLength: { count: 17_683, max: 16_798 },
    });
    // A value out of range is dropped, never a reason to refuse the run.
    for (const overLength of [{ count: -1, max: 16_798 }, { count: 17_683, max: 0 }, 'long']) {
      const parsed = fixRulesInput.parse({ ...input(), overLength });
      expect(parsed.overLength).toBeUndefined();
      expect(parsed.rules).toHaveLength(2);
    }
    // With the Length among the rules, the line isn't said: it says it isn't.
    expect(
      buildFixPrompt({
        brand: { name: 'Acme Coffee', language: 'en' },
        draft: rows.content_drafts,
        passages: draftPassages(BODY),
        lockedKeys: new Set(),
        input: {
          ...input({
            rules: [{ key: 'length', name: 'Length', detail: 'aim 13,998 · 17,683' }],
          }),
          overLength: { count: 17_683, max: 16_798 },
        },
      }),
    ).not.toContain('its Length allows');
  });

  it('sends a long page only up to its cap, and no passage too long to change', () => {
    const long = { tag: 'p', text: 'x'.repeat(5_001) };
    const passage = { tag: 'p', text: 'y'.repeat(4_000) };
    const many = Array.from({ length: 20 }, () => passage);
    const sent = promptPassages([long, ...many]);
    expect(sent.more).toBe(true);
    expect(sent.passages).toHaveLength(MAX_PROMPT_PASSAGE_CHARS / 4_000);
    expect(sent.passages).not.toContain(long);
    expect(promptPassages(draftPassages(BODY))).toEqual({
      passages: draftPassages(BODY),
      more: false,
    });
    const prompt = buildFixPrompt({
      brand: { name: 'Acme Coffee', language: 'en' },
      draft: rows.content_drafts,
      ...sent,
      lockedKeys: new Set(),
      input: input(),
    });
    expect(prompt).toContain('(The page goes on; suggest changes only to the passages above.)');
  });
});

describe('keepSuggestions', () => {
  const passages = draftPassages(BODY);
  const locked = new Set(input().locked);
  const ruleKeys = new Set(['dated', 'faq']);

  it('keeps a replace whose words are in its passage, with the rules sent and its sources', () => {
    // A source number the model wrote into its reason ("(S2)") isn't shown on the card.
    const cited = suggestion({ reason: 'add a dated data point (rule) (S2)' });
    expect(keepSuggestions([cited], passages, locked, ruleKeys, null, sourcing)).toEqual([
      {
        kind: 'replace',
        block_text: 'Use good coffee and hot water.',
        before_text: 'good coffee and hot water',
        after_text: 'a 1:16 ratio of freshly ground coffee to hot water ([source, year])',
        reason: 'add a dated data point (rule)',
        rule_keys: ['dated'],
        sources: [
          {
            kind: 'cited_page',
            ref: 'https://sca.example/brew',
            label: 'https://sca.example/brew',
          },
          { kind: 'fanout', ref: 'pour over ratio 1:16', label: 'Pour over ratio 1:16' },
        ],
        // 16 is marked to the fan-out whose words have it, unasked.
        source_marks: [
          { start: 4, end: 6, source: 1 },
          { start: 16, end: 37, source: 0 },
        ],
      },
    ]);
  });

  it('keeps no claim given to a source, nor a change that drops a name (editor test 2026-10-25)', () => {
    const listed = [
      {
        tag: 'p',
        text: 'GetCito, Profound and LLM Pulse track ChatGPT, Gemini and Claude.',
      },
    ];
    const change = (after, rules = ['dated']) =>
      suggestion({
        passage: 1,
        before: 'GetCito, Profound and LLM Pulse track ChatGPT, Gemini and Claude',
        after,
        rules,
        sources: [],
        marks: [],
      });
    const kept = (s) =>
      keepSuggestions([s], listed, new Set(), new Set(['dated', 'bannedWords']), null, sourcing);
    // An AI Overview's claim given to Zapier, and Claude dropped: neither kept.
    expect(
      kept(
        change(
          'According to Zapier, GetCito, Profound and LLM Pulse track ChatGPT, Gemini and Claude',
        ),
      ),
    ).toEqual([]);
    expect(kept(change('GetCito, Profound and LLM Pulse track ChatGPT and Gemini'))).toEqual([]);
    // Every name kept, no source made up: kept.
    expect(
      kept(change('GetCito, Profound and LLM Pulse each track ChatGPT, Gemini and Claude')),
    ).toHaveLength(1);
    // A banned word taken out may go.
    expect(
      kept(change('GetCito, Profound and LLM Pulse track ChatGPT and Gemini', ['bannedWords'])),
    ).toHaveLength(1);
    // An insert that gives a claim to a source it wasn't given isn't kept either.
    expect(
      kept(
        suggestion({
          kind: 'insert',
          passage: 1,
          before: '',
          after: '<p>According to Zapier, these tools cover every engine.</p>',
          rules: ['dated'],
          sources: [],
          marks: [],
        }),
      ),
    ).toEqual([]);
  });

  it('reads attributions in English, German and Turkish, and the names past a sentence’s first word', () => {
    expect(addsAttribution('Teams forecast.', 'According to Gartner, teams forecast.')).toBe(true);
    expect(addsAttribution('Teams forecast.', 'Gartner found that teams forecast.')).toBe(true);
    expect(addsAttribution('Teams forecast.', 'Laut Gartner prognostizieren Teams.')).toBe(true);
    expect(addsAttribution('Teams forecast.', 'Teams prognostizieren, laut Gartner.')).toBe(true);
    expect(addsAttribution('Ekipler tahmin eder.', "Gartner'a göre ekipler tahmin eder.")).toBe(
      true,
    );
    // One the passage had already: none added.
    expect(
      addsAttribution('According to Gartner, teams forecast.', 'According to Gartner, teams plan.'),
    ).toBe(false);
    // "The report says" names no one.
    expect(addsAttribution('Teams forecast.', 'The report says teams forecast.')).toBe(false);
    // One the agent was given (an expert from Your input, a brand the page names) may be.
    expect(
      addsAttribution(
        'Teams forecast.',
        'Ada Lovelace says teams forecast.',
        knownPeople('Ada Lovelace, head of data'),
      ),
    ).toBe(false);
    // "As Zapier says": the name is Zapier, known when the page gives claims to it.
    expect(
      addsAttribution('Teams forecast.', 'As Zapier says, teams forecast.', knownPeople('Zapier')),
    ).toBe(false);
    // More ways to give a claim to a source.
    expect(addsAttribution('', 'According to the Zapier report, teams forecast.')).toBe(true);
    expect(addsAttribution('', 'According to a 2025 Gartner survey, teams forecast.')).toBe(true);
    expect(addsAttribution('', "Gartner's research shows that teams forecast.")).toBe(true);
    // A tool's report shows things too: "shows" only before "that" or a figure (#1544 review).
    expect(addsAttribution('', 'The Search Console report shows clicks and impressions.')).toBe(
      false,
    );
    expect(addsAttribution('', "GA4's Acquisition report shows where visitors come from.")).toBe(
      false,
    );
    expect(addsAttribution('', 'The Gartner report shows 40% of teams forecast.')).toBe(true);
  });

  // A replace of the whole passage: its words before and after.
  const drops = (before, words, rules, blocks) => dropsName(before, before, words, rules, blocks);

  it('reads a dropped name only in a list: any capitalised word may be a noun, an acronym or a month', () => {
    expect(
      drops('GetCito tracks ChatGPT, Gemini and Claude.', 'GetCito tracks ChatGPT and Gemini.'),
    ).toBe(true);
    expect(drops('Teams use GetCito daily.', 'Teams use it daily.')).toBe(false);
    expect(drops('Most AI search tools track it.', 'Most answer engines track it.')).toBe(false);
    expect(drops('Funktionen für Marketing Teams im März.', 'Werkzeuge für Marketing-Teams.')).toBe(
      false,
    );
    // Taken out for a banned word: it may.
    expect(
      drops('Track ChatGPT, Gemini and Claude.', 'Track ChatGPT and Gemini.', ['bannedWords']),
    ).toBe(false);
  });

  it('keeps a change that keeps every name, worded or cased another way', () => {
    // An item read by its last word, in any case.
    expect(
      drops('Ask ChatGPT, Gemini or Claude for one.', 'When you ask ChatGPT, Gemini or Claude…'),
    ).toBe(false);
    // A possessive or a case ending moved.
    expect(
      drops(
        'Compare ChatGPT, Gemini and Claude’s answers.',
        'Compare the answers from ChatGPT, Gemini and Claude.',
      ),
    ).toBe(false);
    expect(drops("ChatGPT, Gemini ve Claude'u izler.", "ChatGPT, Gemini ve Claude'da izler.")).toBe(
      false,
    );
    // A list ending its sentence, and a change going on after its last name.
    expect(
      drops(
        'It works with Shopify, WooCommerce and Magento.',
        'It works with Shopify, WooCommerce and Magento in five minutes.',
      ),
    ).toBe(false);
    // A list turned into bullets: the names are in the blocks added.
    expect(
      drops(
        'Track ChatGPT, Gemini and Claude.',
        'Track these engines:',
        [],
        'ChatGPT Gemini Claude',
      ),
    ).toBe(false);
  });

  it('reads a name dropped through a short replace, in the passage as changed', () => {
    const passage = 'GetCito tracks ChatGPT, Gemini and Claude.';
    expect(dropsName(passage, 'Gemini and Claude', 'Gemini')).toBe(true);
    expect(dropsName(passage, 'Gemini and Claude', 'Gemini and Claude too')).toBe(false);
    // Items the replace doesn't touch stay as they are.
    expect(dropsName(passage, 'GetCito tracks', 'It tracks')).toBe(false);
  });

  it('ends a name at its sentence: the next sentence’s first word isn’t part of it', () => {
    expect(
      attributedNames('Teams forecast weekly, according to Gartner. The plan is monthly.'),
    ).toEqual(['Gartner']);
    expect(attributedNames('Built on Node.js, according to the U.S Census.')).toEqual([
      'U.S Census',
    ]);
    const known = knownPeople('According to Gartner, teams forecast.');
    expect(
      addsAttribution(
        'Teams forecast weekly.',
        'Teams forecast weekly, according to Gartner. Most plan monthly.',
        known,
      ),
    ).toBe(false);
    expect(
      placeholderAttributions('Teams forecast, according to Zapier. The plan is monthly.', known),
    ).toBe('Teams forecast, according to [source]. The plan is monthly.');
    expect(
      drops(
        'GetCito tracks ChatGPT, Gemini and Claude. Each answer counts.',
        'GetCito tracks ChatGPT, Gemini and Claude, so you see each answer.',
      ),
    ).toBe(false);
  });

  it('reads no attribution in "per" before a noun, "claims" or "states" as nouns, or a comparison with "göre"', () => {
    // "states" after a number or "all" is the noun, before "that" too.
    expect(addsAttribution('', 'We ship to all 50 US states that allow wine delivery.')).toBe(
      false,
    );
    expect(addsAttribution('', 'We ship to all US states that allow it.')).toBe(false);
    expect(addsAttribution('', 'Gartner states that teams forecast.')).toBe(true);
    expect(addsAttribution('', 'Kontaktieren Sie uns per E-Mail.')).toBe(false);
    expect(addsAttribution('', 'Pricing is per SKU, or per API call.')).toBe(false);
    expect(addsAttribution('', 'It ships to all 50 US states.')).toBe(false);
    expect(addsAttribution('', 'Warranty claims are handled in a day.')).toBe(false);
    expect(addsAttribution('', "Gemini, ChatGPT'ye göre daha hızlı.")).toBe(false);
    // "en" after "göre" is the source's claim: "according to ChatGPT, the best one is Gemini".
    expect(addsAttribution('', "ChatGPT'ye göre en iyisi Gemini.")).toBe(true);
    expect(addsAttribution('', "Gartner'a göre en hızlı büyüyen pazar Hindistan.")).toBe(true);
    // The attributions themselves still are.
    expect(addsAttribution('', 'Per Gartner, teams forecast.')).toBe(true);
    expect(addsAttribution('', "Per Gartner's survey, teams forecast.")).toBe(true);
    expect(addsAttribution('', 'Teams forecast weekly, per Gartner.')).toBe(true);
    expect(addsAttribution('', 'Gartner claims that teams forecast.')).toBe(true);
    expect(addsAttribution('', "Gartner'a göre ekipler tahmin eder.")).toBe(true);
  });

  it('knows a source named with a role or an adverb before it, and its end of two words', () => {
    const known = knownPeople('Jane Doe', 'According to Gartner, teams forecast.');
    expect(addsAttribution('', 'Acme CEO Jane Doe says that teams forecast.', known)).toBe(false);
    expect(addsAttribution('', 'CEO Jane Doe says teams forecast.', known)).toBe(false);
    expect(addsAttribution('', 'Recently Gartner said that teams forecast.', known)).toBe(false);
    expect(placeholderAttributions('CEO Jane Doe says teams forecast.', known)).toBe(
      'CEO Jane Doe says teams forecast.',
    );
  });

  it('puts only the name as a placeholder: the word a sentence starts with stays', () => {
    const known = knownPeople('According to Gartner, teams forecast.');
    expect(placeholderAttributions('As Zapier says, teams forecast.', known)).toBe(
      'As [source] says, teams forecast.',
    );
    expect(placeholderAttributions('While Zapier says that teams forecast, …', known)).toBe(
      'While [source] says that teams forecast, …',
    );
    expect(placeholderAttributions('According to the U.S. Census Bureau, most do.', known)).toBe(
      'According to the [source], most do.',
    );
    expect(attributedNames('According to the U.S. Census Bureau, most do.')).toEqual([
      'U.S. Census Bureau',
    ]);
  });

  it('reads "per" as an attribution on an English page only', () => {
    const german = attributableSources('<p>Wir planen.</p>', [], [], 'de');
    expect(addsAttribution('', 'Per E-Mail, Telefon oder Chat erreichen Sie uns.', german)).toBe(
      false,
    );
    expect(addsAttribution('', 'Sie erreichen uns telefonisch, per E-Mail.', german)).toBe(false);
    expect(placeholderAttributions('Kontaktieren Sie uns telefonisch, per E-Mail.', german)).toBe(
      'Kontaktieren Sie uns telefonisch, per E-Mail.',
    );
    // "laut" is German's.
    expect(addsAttribution('', 'Laut Gartner planen Teams.', german)).toBe(true);
    const english = attributableSources('<p>Teams plan.</p>', [], [], 'en');
    expect(addsAttribution('', 'Per Gartner, teams plan.', english)).toBe(true);
    // An acronym may be a source too ("Per IDC, …"): "Per SKU, …" reads as one.
    expect(addsAttribution('', 'Per SKU, you pay once.', english)).toBe(true);
  });

  it('reads a rewrite’s HTML line by line: a linked name, an entity', () => {
    const known = knownPeople('According to Gartner, teams forecast.');
    expect(
      placeholderAttributionsInHtml(
        '<p>According to <a href="https://zapier.com/blog">Zapier</a>, teams forecast.</p>',
        known,
      ),
      // The link goes too: it would still give the claim to its page.
    ).toBe('<p>According to [source], teams forecast.</p>');
    expect(placeholderAttributionsInHtml('<p>According to AT&amp;T, most do.</p>', known)).toBe(
      '<p>According to [source], most do.</p>',
    );
    // A line break ends a line: the next one's first word isn't the name's.
    expect(
      placeholderAttributionsInHtml('<p>According to Zapier<br>The plan is monthly.</p>', known),
    ).toBe('<p>According to [source]<br>The plan is monthly.</p>');
    // A known one, and a page with none: the HTML as it was.
    const html = '<h2>Plans</h2><p>According to <strong>Gartner</strong>, teams plan.</p>';
    expect(placeholderAttributionsInHtml(html, known)).toBe(html);
  });

  it('reads more wordings: "As X notes", "a report by X", "data from X shows", Turkish and German', () => {
    for (const text of [
      'As Zapier notes, teams forecast.',
      'As Zapier puts it, teams forecast.',
      'According to a 2025 report by Gartner, teams forecast.',
      'A survey from Statista finds teams forecast.',
      'Data from Statista shows that teams forecast.',
      'Data from Statista shows 60% of teams forecast.',
      "Gartner'ın raporuna göre ekipler tahmin eder.",
      'Laut einer aktuellen Studie von Gartner planen Teams.',
    ]) {
      expect(addsAttribution('', text), text).toBe(true);
    }
    // What a product does, an event or a thing to get isn't an attribution.
    for (const text of [
      'Data from Shopify syncs every hour.',
      'Data from GA4 shows where visitors come from.',
      'As Google adds AI Overviews to more queries, clicks fall.',
      'Visibility shifts as ChatGPT adds shopping results.',
      'Download the 2025 report from Gartner.',
      'Keyword research from Ahrefs helps you plan.',
      'Laut der Anleitung des Herstellers geht es so.',
    ]) {
      expect(addsAttribution('', text), text).toBe(false);
    }
    expect(
      placeholderAttributions('As Zapier notes, teams forecast.', knownPeople('Gartner')),
    ).toBe('As [source] notes, teams forecast.');
  });

  it('reads two names as a list when one is shaped as a brand’s, and "&"', () => {
    expect(drops('Track ChatGPT and Claude.', 'Track ChatGPT.')).toBe(true);
    expect(drops('Sync Shopify & WooCommerce stores.', 'Sync Shopify stores.')).toBe(true);
    expect(drops('GetCito, Profound & Peec AI track it.', 'GetCito and Profound track it.')).toBe(
      true,
    );
    // Two nouns, two terms: not a list.
    expect(drops('For Sales and Marketing teams.', 'For marketing teams.')).toBe(false);
    expect(drops('Combine SEO and AEO.', 'Combine SEO.')).toBe(false);
    expect(drops('For B2B and B2C shops.', 'For B2B shops.')).toBe(false);
  });

  it('lets a change for a banned word drop only the item that is one', () => {
    const rules = [{ key: 'bannedWords', name: 'Banned words', detail: 'Aim: seamless, Claude' }];
    expect(bannedWordsOf(rules)).toEqual(['seamless', 'Claude']);
    expect(bannedWordsOf([])).toEqual([]);
    // As the editor sends it, with the count after; never the count alone.
    expect(
      bannedWordsOf([
        { key: 'bannedWords', name: 'x', detail: 'aim: seamless, leverage · now: 2 found' },
      ]),
    ).toEqual(['seamless', 'leverage']);
    expect(bannedWordsOf([{ key: 'bannedWords', name: 'x', detail: 'now: 3 found' }])).toEqual([]);
    const banned = bannedWordsOf(rules);
    const passage = 'Track ChatGPT, Gemini and Claude.';
    expect(
      dropsName(passage, passage, 'Track ChatGPT and Gemini.', ['bannedWords'], '', banned),
    ).toBe(false);
    expect(
      dropsName(passage, passage, 'Track ChatGPT and Claude.', ['bannedWords'], '', banned),
    ).toBe(true);
    // The banned word goes; the name in the same item stays.
    const shops = 'Leverage Shopify, WooCommerce and Magento.';
    const leverage = ['leverage'];
    expect(
      dropsName(shops, shops, 'Use WooCommerce and Magento.', ['bannedWords'], '', leverage),
    ).toBe(true);
    expect(
      dropsName(
        shops,
        shops,
        'Use Shopify, WooCommerce and Magento.',
        ['bannedWords'],
        '',
        leverage,
      ),
    ).toBe(false);
  });

  it('reads a long run of capitals quickly', () => {
    const started = Date.now();
    addsAttribution('', `According to ${'A'.repeat(20000)} says that.`);
    const list = `${'B'.repeat(20000)}, C and D`;
    dropsName(list, list, 'C and D');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('reads a long run of spaces quickly: no lookbehind is tried at each of them', () => {
    // A character past Latin-1 (’, ı) in each: V8 skips no position then.
    const reads = (run) => [
      () => attributableSources(`<p>Ürün${run}açıklamasına göre</p>`, [], []),
      () => placeholderAttributions(`In a’s${run}b report from Gartner, most do.`),
      () => addsAttribution('', `x${run}Gartner raporuna göre en hızlı.`),
      () => attributedNames(`Dem’${run}Bericht zufolge.`),
      () => attributedNames(`Most’${run}US states that allow it.`),
    ];
    // Compiled once, apart from the timing.
    reads(' ').forEach((read) => read());
    for (const space of [' ', '\u00a0', '\n']) {
      for (const read of reads(space.repeat(30_000))) {
        const started = Date.now();
        read();
        expect(Date.now() - started).toBeLessThan(150);
      }
    }
  });

  it('reads a claim with a short aside after "a report by X" (review, #1544)', () => {
    expect(
      attributedNames('A 2025 report by Gartner, published in May, found that 40% of teams plan.'),
    ).toEqual(['Gartner']);
    expect(
      attributedNames(
        'A recent study from Stanford, which surveyed 500 teams, shows that most plan.',
      ),
    ).toEqual(['Stanford']);
    // Still never a product's sentence, nor an aside past its bound.
    expect(
      attributedNames('The Performance report from Google Search Console shows clicks.'),
    ).toEqual([]);
    expect(
      attributedNames(`A report by Gartner, ${'and so on '.repeat(10)}, found that most plan.`),
    ).toEqual([]);
  });

  it('reads a long run of initials quickly: each dot is read one way', () => {
    const initials = 'U.S.'.repeat(10_000);
    const started = Date.now();
    addsAttribution('', `According to ${initials} says that.`);
    dropsName(`${initials}, C and D`, `${initials}, C and D`, 'C and D');
    placeholderAttributions(`Per ${initials}'s survey, most do.`);
    expect(Date.now() - started).toBeLessThan(500);
    // Dotted names read as before.
    expect(attributedNames('Built on Node.js, according to the U.S Census.')).toEqual([
      'U.S Census',
    ]);
    expect(attributedNames('According to the U.S. Census Bureau, most do.')).toEqual([
      'U.S. Census Bureau',
    ]);
    expect(attributedNames('According to J.D. Power, most do.')).toEqual(['J.D. Power']);
    expect(attributedNames('Teams forecast, per the U.N.')).toEqual(['U.N.']);
    expect(attributedNames("U.S.'e göre enflasyon düştü.")).toEqual(['U.S.']);
  });

  it('knows a source by its possessive, and never by its last word alone', () => {
    const known = knownPeople('According to Gartner, teams forecast.', 'Our research team');
    expect(
      addsAttribution('', "According to Gartner's latest survey, teams forecast.", known),
    ).toBe(false);
    expect(addsAttribution('', 'According to Forrester Research, teams forecast.', known)).toBe(
      true,
    );
    expect(addsAttribution('', 'As Gartner says, teams forecast.', known)).toBe(false);
  });

  it('puts a claim given to a source it wasn’t given as a placeholder, and reads the page’s own', () => {
    const known = attributableSources(
      '<p>According to Gartner, teams forecast weekly.</p><p>Zapier, Make and n8n run it.</p>',
      [{ kind: 'input', ref: 'i1', label: 'Ada Lovelace, head of data', detail: '' }],
      ['Grace Hopper'],
    );
    expect(
      placeholderAttributions('According to Gartner, most do. According to Zapier, all do.', known),
    ).toBe('According to Gartner, most do. According to [source], all do.');
    // Listed by the page, not given claims by it: Zapier isn't one to give a claim to.
    expect(addsAttribution('', 'Zapier says teams forecast.', known)).toBe(true);
    expect(addsAttribution('', 'Ada Lovelace says teams forecast.', known)).toBe(false);
    expect(addsAttribution('', 'Grace Hopper says teams forecast.', known)).toBe(false);
  });

  it('keeps no number without a source (CE-033)', () => {
    // A figure in none of the data: not kept, even marked to a source.
    const invented = { after: '87% of baristas use freshly ground coffee' };
    expect(
      keepSuggestions([suggestion(invented)], passages, locked, ruleKeys, null, sourcing),
    ).toEqual([]);
    expect(
      keepSuggestions(
        [suggestion({ ...invented, marks: [{ words: '87% of baristas', source: 'S2' }] })],
        passages,
        locked,
        ruleKeys,
        null,
        sourcing,
      ),
    ).toEqual([]);
    // One the rules ask for (the keywords rule's "2026") needs no source.
    const [asked] = keepSuggestions(
      [suggestion({ after: 'the best pour-over gear for 2026', marks: [] })],
      passages,
      locked,
      ruleKeys,
      null,
      { ...sourcing, known: knownNumbers('aim: best pour-over gear 2026') },
    );
    expect(asked).toMatchObject({ after_text: 'the best pour-over gear for 2026' });
    // A source number written into the words is taken out.
    const [plain] = keepSuggestions(
      [suggestion({ after: 'freshly ground coffee (S2) and hot water', marks: [] })],
      passages,
      locked,
      ruleKeys,
      null,
      sourcing,
    );
    expect(plain.after_text).toBe('freshly ground coffee and hot water');
    // A number the page has already, or a count, needs none.
    const [kept] = keepSuggestions(
      [
        suggestion({
          passage: 2,
          before: 'tastes better',
          after: 'tastes better, in 3 ways',
          sources: [],
          marks: [],
        }),
      ],
      draftPassages('<h1>Pour-over in 2026</h1><p>Pour-over coffee tastes better.</p>'),
      new Set(),
      ruleKeys,
    );
    expect(kept).toMatchObject({ after_text: 'tastes better, in 3 ways' });
    expect(kept).not.toHaveProperty('sources');
    expect(kept).not.toHaveProperty('source_marks');
  });

  it('drops one on a locked passage, words not in the passage, or no passage', () => {
    expect(
      keepSuggestions(
        [
          suggestion({ passage: 2, before: 'tastes better', after: 'is brighter' }),
          suggestion({ before: 'cold water' }),
          suggestion({ passage: 9 }),
          suggestion({ after: 'good coffee and hot water' }),
        ],
        passages,
        locked,
        ruleKeys,
      ),
    ).toEqual([]);
  });

  it('keeps an insert after a locked passage, its HTML cleaned', () => {
    const [kept] = keepSuggestions(
      [
        suggestion({
          kind: 'insert',
          passage: 2,
          before: '',
          after:
            '<h2 class="x">FAQ</h2><p onclick="y()">How long? <a href="z">3 min</a></p><script>bad()</script>',
          reason: 'add FAQ block (rule)',
          rules: ['faq'],
        }),
      ],
      passages,
      locked,
      ruleKeys,
    );
    expect(kept).toMatchObject({
      kind: 'insert',
      block_text: 'Pour-over coffee tastes better than other methods.',
      before_text: '',
      after_text: '<h2>FAQ</h2><p>How long? 3 min</p>',
      rule_keys: ['faq'],
    });
  });

  it('keeps each change once', () => {
    expect(
      keepSuggestions([suggestion(), suggestion()], passages, locked, ruleKeys, null, sourcing),
    ).toHaveLength(1);
  });
});

/**
 * An answer written into a heading's replace was glued onto the heading's
 * line ("What is LLM SEO? LLM SEO optimizes…", "Frequently Asked
 * QuestionsWhat is an AEO tracker?…"): it now goes after the heading.
 */
describe('blocks, names and languages as the review read them (#1520)', () => {
  const listed = [{ tag: 'p', text: 'Track ChatGPT, Gemini and Claude.' }];
  const keep = (s, over = {}) =>
    keepSuggestions([s], listed, new Set(), new Set(['dated']), null, { ...sourcing, ...over });
  const insert = (after) =>
    suggestion({ kind: 'insert', passage: 1, before: '', after, sources: [], marks: [] });

  it('reads compact blocks with a space between them, as it reads the page', () => {
    // A list turned into bullets, written compact: every name is still there.
    const bullets = suggestion({
      passage: 1,
      before: 'Track ChatGPT, Gemini and Claude.',
      after: 'Track these engines:<ul><li>ChatGPT</li><li>Gemini</li><li>Claude</li></ul>',
      sources: [],
      marks: [],
    });
    expect(keep(bullets).map((row) => row.kind)).toEqual(['replace', 'insert']);
    // A page that cites Gartner: a block after the one citing it isn't read into its name.
    const cites = attributableSources('<p>According to Gartner, teams forecast.</p>', [], []);
    expect(
      keep(
        insert('<p>Teams plan weekly, according to Gartner.</p><p>Most teams plan monthly.</p>'),
        {
          attributable: cites,
        },
      ),
    ).toHaveLength(1);
    // A heading before the claim doesn't hide it.
    expect(
      keep(insert('<h2>Forecasting basics</h2><p>According to Zapier, teams forecast.</p>'), {
        attributable: cites,
      }),
    ).toEqual([]);
  });

  it('reads a name of eight words at most, so a long run of capitals reads fast', () => {
    const run = Array.from(
      { length: 3000 },
      (_, i) => `Word${String.fromCharCode(65 + (i % 26))}`,
    ).join(' ');
    const started = Date.now();
    attributedNames(`${run} says teams forecast.`);
    dropsName(`${run}, Alpha and Beta.`, `${run}, Alpha and Beta.`, `${run} and Alpha.`);
    expect(Date.now() - started).toBeLessThan(500);
    expect(attributedNames('Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota says so.')).toEqual([
      'Beta Gamma Delta Epsilon Zeta Eta Theta Iota',
    ]);
  });

  it('never skips a name’s last word: "Grammarly" is a name', () => {
    const known = knownPeople('According to Grammarly, teams write faster.');
    expect(addsAttribution('', 'According to Grammarly, most teams do.', known)).toBe(false);
    expect(placeholderAttributions('According to Grammarly, most teams do.', knownPeople(''))).toBe(
      'According to [source], most teams do.',
    );
  });

  it('reads a change line by line: a linked name whole, a heading apart from the line after it', () => {
    expect(
      htmlLines('<h2>Forecasting Basics</h2><p>Per <a href="#">Gartner</a>’s survey, most do.</p>'),
    ).toEqual(['Forecasting Basics', 'Per Gartner’s survey, most do.']);
    const cites = attributableSources(
      '<p><a href="https://gartner.example">Gartner</a>’s report shows that teams forecast.</p>',
      [],
      [],
    );
    // The page's linked source is read, and a Title Case heading doesn't run into it.
    expect(
      keep(insert('<h2>Forecasting Basics</h2><p>Gartner says most teams forecast.</p>'), {
        attributable: cites,
      }),
    ).toHaveLength(1);
  });

  it('never reads a name past a sentence’s word or a lone "CEO"', () => {
    const none = knownPeople('');
    for (const text of [
      'Who says B2B content has to be boring?',
      'Most said they use ChatGPT weekly.',
      'Our CEO said that we ship weekly.',
    ]) {
      expect(placeholderAttributions(text, none), text).toBe(text);
    }
  });

  it('reads "states" and "claims" as nouns after a count, and reads years before a source', () => {
    for (const text of [
      'We ship to all 50 US states that allow wine delivery.',
      'It works in most US states that allow it.',
      'We ship to the 48 contiguous US states that allow it.',
      'It covers all 50 New England states that allow it.',
    ]) {
      expect(addsAttribution('', text), text).toBe(false);
    }
    for (const text of [
      'By 2026 Gartner estimates that most teams will forecast weekly.',
      'In 2025 Gartner found that most teams forecast weekly.',
      'In Q3 2025 IDC estimated that most teams forecast weekly.',
    ]) {
      expect(addsAttribution('', text), text).toBe(true);
    }
  });
});

describe('attributions as the review of #1537 read them', () => {
  const none = knownPeople('');
  const reads = (texts, expected) => {
    for (const text of texts) expect(addsAttribution('', text), text).toBe(expected);
  };

  it('reads no product sentence as a claim: a comma after "from X", a tool’s report that "shows"', () => {
    reads(
      [
        'Send a survey from Typeform, Jotform or Google Forms.',
        'Download the 2025 report from Gartner, then share it with your team.',
        'The Performance report from Google Search Console shows clicks and impressions.',
        'Who says B2B content has to be boring?',
        'In this report from Google Search Console, you can see clicks.',
        'In the Performance report from Google Search Console, clicks are listed.',
        'Built in a study from Figma, the kit has 40 parts.',
      ],
      false,
    );
    // An acronym is a name, even one a sentence could start with ("ama").
    reads(
      ['According to AMA, most marketers plan weekly.', 'AMA says that most plan weekly.'],
      true,
    );
    // Turkish sentence words are the attributions' only: the people guard still reads a person.
    expect(guardPeople('Son Heung-min said the team won.', none).text).toContain(NAME_PLACEHOLDER);
    reads(
      [
        'In a 2025 report by Gartner, most teams forecast weekly.',
        'According to a survey from Statista, most teams forecast weekly.',
        'A survey from Statista shows that most teams forecast weekly.',
        'A report from Gartner shows 40 teams forecast weekly.',
        'A survey from Statista finds most teams forecast weekly.',
      ],
      true,
    );
  });

  it('knows the brand’s own name: its report or data says what it says', () => {
    const known = attributableSources('<p>Acme tracks AI answers.</p>', [], [], 'en', ['Acme']);
    expect(addsAttribution('', 'Acme’s data shows that most pages gain citations.', known)).toBe(
      false,
    );
    expect(
      addsAttribution('', 'A weekly report from Acme shows that your top pages gain.', known),
    ).toBe(false);
    expect(addsAttribution('', 'Gartner’s data shows that most pages gain.', known)).toBe(true);
  });

  it('keeps the possessive out of the placeholder, never a name’s own apostrophe', () => {
    expect(placeholderAttributions("According to O'Day, most do.", none)).toBe(
      'According to [source], most do.',
    );
    expect(placeholderAttributions("According to Gartner's latest survey, most do.", none)).toBe(
      "According to [source]'s latest survey, most do.",
    );
    expect(placeholderAttributions('Gartner’s research shows that teams forecast.', none)).toBe(
      '[source]’s research shows that teams forecast.',
    );
  });

  it('reads Turkish reports with or without the ending, a word before the noun, a name of more words', () => {
    reads(
      [
        "Gartner'ın 2025 raporuna göre pazar büyüyor.",
        "Gartner'ın son raporuna göre pazar büyüyor.",
        'Pazar, Gartner raporuna göre büyüyor.',
        'TÜİK verilerine göre enflasyon düştü.',
        'HubSpot verilerine göre e-posta açılma oranı düştü.',
      ],
      true,
    );
    // Without the ending, a sentence's first noun isn't a name.
    reads(
      [
        'Son raporuna göre pazar büyüyor.',
        'Ürün açıklamasına göre kahve makinesi on bardak yapar.',
        'Sipariş verilerine göre en çok satan model bu.',
        'Haziran verilerine göre satışlar arttı.',
      ],
      false,
    );
    // The brand's own: "Panelinizdeki GetCito verilerine göre" reads GetCito, known.
    const known = attributableSources('<p>GetCito</p>', [], [], 'tr', ['GetCito']);
    expect(addsAttribution('', 'Panelinizdeki GetCito verilerine göre trafik arttı.', known)).toBe(
      false,
    );
    expect(placeholderAttributions("Google Analytics'e göre trafik arttı.", none)).toBe(
      "[source]'e göre trafik arttı.",
    );
    expect(placeholderAttributions("Ancak Google Analytics'e göre trafik arttı.", none)).toBe(
      "Ancak [source]'e göre trafik arttı.",
    );
  });

  it('reads German "zufolge" and "nach Angaben von", never the maker’s own words', () => {
    reads(
      ['Gartner zufolge wächst der Markt.', 'Nach Angaben von Gartner wächst der Markt.'],
      true,
    );
    reads(
      [
        'Berichten zufolge wächst der Markt.',
        'Den Angaben zufolge wächst der Markt.',
        'Laut Hersteller hält der Akku zehn Stunden.',
        'Laut Herstellerangaben hält der Akku zehn Stunden.',
        'Laut Datenblatt wiegt es zwei Kilo.',
        'Laut Datenblättern wiegt es zwei Kilo.',
        'Nach Angaben des Herstellers hält der Akku zehn Stunden.',
        // A noun German capitalises, after an article or as a plural.
        'Dem Bericht zufolge wächst der Markt.',
        'Einer Studie zufolge wächst der Markt.',
        'Herstellerangaben zufolge hält der Akku zehn Stunden.',
        'Kundenbewertungen zufolge ist er leise.',
        'Unseren Messungen zufolge ist er leise.',
        'Insidern zufolge wächst der Markt.',
        'Neuesten Zahlen zufolge wächst der Markt.',
      ],
      false,
    );
    reads(['Laut Gartner wächst der Markt.', 'IDC zufolge wächst der Markt.'], true);
  });
});

describe('the review of #1537, round 2 (low follow-ups)', () => {
  it('ends a line at a line break inside a bold or a link too', () => {
    expect(
      htmlLines(
        '<p><strong>Forecasting basics<br>According to Zapier, teams forecast.</strong></p>',
      ),
    ).toEqual(['Forecasting basics', 'According to Zapier, teams forecast.']);
    expect(
      htmlLines(
        '<p><em>Teams plan weekly, according to Gartner.<br>Most teams plan monthly.</em></p>',
      ),
    ).toEqual(['Teams plan weekly, according to Gartner.', 'Most teams plan monthly.']);
    expect(htmlLines('<p><strong>ChatGPT<br>Gemini<br>Claude</strong></p>')).toEqual([
      'ChatGPT',
      'Gemini',
      'Claude',
    ]);
    // A claim a bold's line break hid is read; one on a page that cites the source isn't new.
    const cites = attributableSources('<p>According to Gartner, teams forecast.</p>', [], []);
    expect(
      keepSuggestions(
        [
          suggestion({
            kind: 'insert',
            passage: 1,
            before: '',
            after:
              '<p><strong>Forecasting basics<br>According to Zapier, teams forecast.</strong></p>',
            sources: [],
            marks: [],
          }),
        ],
        [{ tag: 'p', text: 'Track ChatGPT, Gemini and Claude.' }],
        new Set(),
        new Set(['dated']),
        null,
        { ...sourcing, attributable: cites },
      ),
    ).toEqual([]);
  });

  it('reads "states" and "claims" as nouns after a count at a sentence’s start, and a claim after small words', () => {
    for (const text of [
      'Most US states that allow it ship wine.',
      'Every FDA states that list it are fine.',
    ]) {
      expect(addsAttribution('', text), text).toBe(false);
      expect(placeholderAttributions(text, knownPeople('')), text).toBe(text);
    }
    for (const text of [
      'In some cases Gartner states that most teams forecast weekly.',
      'For many years Gartner claims that most teams forecast weekly.',
    ]) {
      expect(addsAttribution('', text), text).toBe(true);
    }
  });
});

describe('no invented people or quotes (CE-044)', () => {
  const passages = draftPassages(BODY);
  const ruleKeys = new Set(['dated', 'faq']);
  const people = knownPeople(
    ...passages.map((p) => p.text),
    'Ada Lovelace',
    '“Brew it slow and taste it twice,” Ada Lovelace says.',
  );

  it('keeps a person and a quote it was given, and puts others as placeholders', () => {
    const kept = keepSuggestions(
      [
        suggestion({
          before: 'good coffee and hot water',
          after: 'good coffee and hot water, as Ada Lovelace says',
          sources: [],
          marks: [],
        }),
        suggestion({
          kind: 'insert',
          passage: 3,
          before: '',
          after:
            '<p>“We doubled our sales in a single quarter with it,” said Marco Rossi.</p>' +
            '<p>“Brew it slow and taste it twice,” Ada Lovelace says.</p>',
          sources: [],
          marks: [],
        }),
      ],
      passages,
      new Set(),
      ruleKeys,
      null,
      { ...sourcing, people },
    );
    expect(kept.map((row) => row.after_text)).toEqual([
      'good coffee and hot water, as Ada Lovelace says',
      `<p>${QUOTE_PLACEHOLDER} said ${NAME_PLACEHOLDER}.</p>` +
        '<p>“Brew it slow and taste it twice,” Ada Lovelace says.</p>',
    ]);
  });

  it('takes an invented testimonial out before its blockquote is cleaned away', () => {
    const [kept] = keepSuggestions(
      [
        suggestion({
          kind: 'insert',
          passage: 3,
          before: '',
          after:
            '<blockquote><p>We doubled our pipeline in a month.</p><cite>Jane Doe</cite></blockquote>',
          sources: [],
          marks: [],
        }),
      ],
      passages,
      new Set(),
      ruleKeys,
      null,
      { ...sourcing, people },
    );
    expect(kept.after_text).toBe(`<p>${QUOTE_PLACEHOLDER}</p>`);
  });
});

describe('attributions as the review of #1544 read them', () => {
  const none = knownPeople('');
  const reads = (texts, expected) => {
    for (const text of texts) expect(addsAttribution('', text), text).toBe(expected);
  };

  it('reads no tool’s report when the reader is spoken to after the comma', () => {
    reads(
      [
        'In the report from Google Search Console, you can see clicks.',
        'In a report from Google Analytics, filter by channel.',
        'In a report from Google Analytics, your top pages are listed.',
      ],
      false,
    );
    // A claim's "In …," still is, and "according to" whoever it speaks to;
    // a verb's word that is a noun there is no instruction.
    reads(
      [
        'In a 2025 report by Gartner, most teams forecast weekly.',
        'According to a survey from Statista, your customers want speed.',
        'In a 2025 study from Stanford, open rates fell 8%.',
        'In a report by the WTO, export volumes rose 3%.',
        'In a report by Gartner, use cases for AI tripled.',
        'In a report by Gartner, go-to-market costs rose 30%.',
        'In a report by Gartner, add-on sales grew 12%.',
        'In a report by Gartner, download numbers doubled.',
      ],
      true,
    );
    reads(['In a report from Google Analytics, open the Acquisition tab.'], false);
  });

  it('reads no report’s acronym, or a list’s first noun, as a Turkish source', () => {
    reads(
      [
        'SEO raporuna göre sıralama yükseldi.',
        'PDF raporuna göre teslimat iki gün.',
        'Aylık SEO raporuna göre sıralama yükseldi.',
        'Bu PDF raporuna göre teslimat iki gün.',
        'KPI raporuna göre satışlar arttı.',
        '1) Ürün açıklamasına göre ölçüler değişti.',
      ],
      false,
    );
    reads(
      ['TÜİK raporuna göre enflasyon düştü.', 'Bu yıl Gartner raporuna göre pazar büyüyor.'],
      true,
    );
  });

  it('reads no maker’s or page’s German words, in a compound or after an adjective', () => {
    reads(
      [
        'Laut Angaben des Herstellers hält der Akku zehn Stunden.',
        'Laut Produktdatenblatt wiegt es zwei Kilo.',
        'Laut Packungsbeilage zweimal täglich.',
        'Laut Kundenbewertungen ist er leise.',
        'Einer neuen Studie zufolge wächst der Markt.',
        'Einer repräsentativen Umfrage zufolge wächst der Markt.',
      ],
      false,
    );
    reads(
      [
        'Laut Gartner wächst der Markt.',
        'Gartner zufolge wächst der Markt.',
        // The giver of the figures, by "von", "des" or "der".
        'Laut Angaben von Statista wuchs der Markt.',
        'Laut Angaben des Statistischen Bundesamtes stiegen die Preise.',
        'Laut Bewertungsportal Trustpilot ist er beliebt.',
        // A verb's ending before the name is no adjective's.
        'Die Ausgaben sollen Gartner zufolge steigen.',
        'Die Kosten liegen Gartner zufolge höher.',
        'Weltweit nutzen Statista zufolge viele Teams KI.',
        'Die Preise werden IDC zufolge steigen.',
        'Das gilt immer Gartner zufolge.',
      ],
      true,
    );
  });

  it('reads no count of names ("most of the US states") as a source', () => {
    reads(['In most of the US states that allow it, the fee is lower.'], false);
    reads(['Gartner states that most teams forecast.'], true);
  });

  it('puts thousands of sources on one line, and skips what a line has no trigger for, quickly', () => {
    const time = (read) => {
      const started = Date.now();
      read();
      return Date.now() - started;
    };
    // A character past Latin-1 (Ü) in each: V8 skips no position then.
    // 20,000 sources rebuilt per edit took 3 s (main, 2026-10-26); read once, under 100 ms.
    const line = 'According to Gartner, most do. '.repeat(20_000);
    placeholderAttributionsInHtml('<p>According to Gartner, most do.</p>');
    let html;
    expect(
      time(() => (html = placeholderAttributionsInHtml(`<p>Ürün <b>x</b> ${line}</p>`))),
    ).toBeLessThan(400);
    expect(html).toBe(`<p>Ürün <b>x</b> ${'According to [source], most do. '.repeat(20_000)}</p>`);
    // A long line of capitalised words, none of the name-first patterns' words
    // in it: they aren't tried at each capital (160 ms on main, 4 ms now).
    const caps = `Ürün ${'Acme Beta Corp Delta '.repeat(20_000)}.`;
    attributedNames('Ürün Acme.');
    expect(time(() => attributedNames(caps))).toBeLessThan(60);
  });

  it('puts a name that is itself possessive whole, and keeps an owner’s ending', () => {
    expect(placeholderAttributions("According to McDonald's, sales rose.", none)).toBe(
      'According to [source], sales rose.',
    );
    expect(placeholderAttributions("According to Gartner's latest survey, most do.", none)).toBe(
      "According to [source]'s latest survey, most do.",
    );
    expect(placeholderAttributions("According to Gartner's 2025 survey, most do.", none)).toBe(
      "According to [source]'s 2025 survey, most do.",
    );
  });
});

describe('a replace on a heading', () => {
  const page = draftPassages(
    '<h2>What is LLM SEO</h2><p>It is new.</p><h2>FAQ</h2><p>Ask us.</p><p>Use good coffee.</p>',
  );
  const keep = (over) =>
    keepSuggestions(
      [suggestion({ passage: 1, before: 'What is LLM SEO', rules: ['faq'], ...over })],
      page,
      new Set(),
      new Set(['faq']),
    );

  it('keeps the question in the heading and inserts its answer after it', () => {
    expect(
      keep({ after: 'What is LLM SEO? LLM SEO optimizes pages for large language models.' }),
    ).toEqual([
      expect.objectContaining({
        kind: 'replace',
        block_text: 'What is LLM SEO',
        before_text: 'What is LLM SEO',
        after_text: 'What is LLM SEO?',
      }),
      expect.objectContaining({
        kind: 'insert',
        block_text: 'What is LLM SEO',
        after_text: '<p>LLM SEO optimizes pages for large language models.</p>',
        rule_keys: ['faq'],
      }),
    ]);
  });

  it('turns a heading sent with its blocks into the heading and an insert', () => {
    const kept = keepSuggestions(
      [
        suggestion({
          passage: 3,
          before: 'FAQ',
          after:
            '<h2>Frequently Asked Questions</h2><h3>What is an AEO tracker?</h3><p>An AEO tracker monitors AI answers.</p>',
        }),
      ],
      page,
      new Set(),
      new Set(),
    );
    expect(kept.map((k) => [k.kind, k.after_text])).toEqual([
      ['replace', 'Frequently Asked Questions'],
      ['insert', '<h3>What is an AEO tracker?</h3><p>An AEO tracker monitors AI answers.</p>'],
    ]);
  });

  it('leaves only the insert when the heading keeps its words', () => {
    expect(
      keep({ after: '<h2>What is LLM SEO</h2><p>LLM SEO optimizes pages.</p>' }).map((k) => k.kind),
    ).toEqual(['insert']);
  });

  it('keeps a split suggestion whole, or not at all, at the cap', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      suggestion({ kind: 'insert', passage: 2, before: '', after: `<p>Note ${i}.</p>` }),
    );
    const answer = suggestion({
      after: 'What is LLM SEO? LLM SEO optimizes pages for large language models.',
    });
    const kept = keepSuggestions(
      [...many, { ...answer, passage: 1, before: 'What is LLM SEO' }],
      page,
      new Set(),
      new Set(),
    );
    expect(kept).toHaveLength(7);
    expect(kept.every((k) => k.kind === 'insert')).toBe(true);
  });

  it('drops one that would still make the heading over its length', () => {
    expect(keep({ after: 'What is LLM SEO '.repeat(10) })).toEqual([]);
  });

  it('drops one that adds a second question to a heading, and keeps a question reworded', () => {
    const faq = draftPassages(
      '<h2>FAQ</h2><h3>What is AEO?</h3><p>Answer engine optimization.</p>',
    );
    const run = (after) =>
      keepSuggestions(
        [suggestion({ passage: 2, before: 'What is AEO?', after, rules: ['fanoutFaq'] })],
        faq,
        new Set(),
        new Set(['fanoutFaq']),
      );
    // A fan-out's question added to the one there, short, past the limit or answered.
    expect(run('What is AEO? What is an AEO tracker?')).toEqual([]);
    expect(
      run(
        'What is AEO? What is an AEO tracker? An AEO tracker is a tool that reads many AI engines for you.',
      ),
    ).toEqual([]);
    expect(
      run(`What is AEO? How does ${'an AEO tracker read many engines and '.repeat(3)}work?`),
    ).toEqual([]);
    // The question reworded into the fan-out's words.
    expect(run('What is an AEO tracker?')).toEqual([
      expect.objectContaining({ kind: 'replace', after_text: 'What is an AEO tracker?' }),
    ]);
    // A heading that already asks two may still change.
    expect(asksMoreThanOne({ tag: 'h3', text: 'Why AEO? Why now?' }, 'now', 'today')).toBe(false);
    expect(asksMoreThanOne({ tag: 'p', text: 'Why?' }, 'Why?', 'Why? How?')).toBe(false);
  });

  it('holds an H1 to 70 characters and other headings to 90, unless they get shorter', () => {
    expect(HEADING_LIMITS).toEqual({ h1: 70, other: 90 });
    const h1 = { tag: 'h1', text: 'Guide' };
    const h2 = { tag: 'h2', text: 'Guide' };
    expect(growsPastLimit(h1, 'Guide', 'x'.repeat(70))).toBe(false);
    expect(growsPastLimit(h1, 'Guide', 'x'.repeat(71))).toBe(true);
    expect(growsPastLimit(h2, 'Guide', 'x'.repeat(90))).toBe(false);
    expect(growsPastLimit(h2, 'Guide', 'x'.repeat(91))).toBe(true);
    // An imported heading already over its limit may still be shortened.
    const long = { tag: 'h2', text: 'y'.repeat(120) };
    expect(growsPastLimit(long, 'y'.repeat(20), 'z'.repeat(10))).toBe(false);
    expect(growsPastLimit(long, 'y'.repeat(20), 'z'.repeat(30))).toBe(true);
    // A paragraph has no limit here.
    expect(growsPastLimit({ tag: 'p', text: 'a' }, 'a', 'b'.repeat(500))).toBe(false);
  });

  it('keeps a heading with a second clause, and a paragraph replace as it was', () => {
    expect(splitReplace('AEO or SEO? Which matters more in 2026', 'h2')).toMatchObject({
      words: 'AEO or SEO? Which matters more in 2026',
      blocks: '',
    });
    // A short second part is the heading's, not an answer.
    expect(splitReplace("Is AEO worth it? Here's what the data says.", 'h2').blocks).toBe('');
    expect(splitReplace('What is AEO? The complete guide.', 'h1').blocks).toBe('');
    expect(
      splitReplace(
        'AEO とは？ AEO は AI アシスタントの回答に引用されるための最適化の方法です。説明します。',
        'h2',
      ),
    ).toMatchObject({
      words: 'AEO とは？',
      blocks: '<p>AEO は AI アシスタントの回答に引用されるための最適化の方法です。説明します。</p>',
    });
    // A non-breaking space stays one, as the passage keeps it.
    expect(splitReplace('Pour\u00a0slowly', 'p').words).toBe('Pour\u00a0slowly');
    expect(splitReplace('Use 15 g of coffee. Then pour.', 'p')).toMatchObject({
      words: 'Use 15 g of coffee. Then pour.',
      blocks: '',
    });
  });

  it('puts the answer first under the heading when blocks come with it', () => {
    expect(
      splitReplace(
        'What is LLM SEO? LLM SEO optimizes pages for large language models.<ul><li>a</li></ul>',
        'h2',
      ),
    ).toMatchObject({
      words: 'What is LLM SEO?',
      blocks: '<p>LLM SEO optimizes pages for large language models.</p><ul><li>a</li></ul>',
    });
    expect(
      splitReplace(
        '<h2>What is LLM SEO? LLM SEO optimizes pages for large language models.</h2><p>More.</p>',
        'h2',
      ),
    ).toMatchObject({
      words: 'What is LLM SEO?',
      blocks: '<p>LLM SEO optimizes pages for large language models.</p><p>More.</p>',
    });
  });

  it('keeps a subtitle that fits, and splits after a full-width ？ with no space', () => {
    const subtitle = 'What is AEO? The Complete Guide to Answer Engine Optimization';
    expect(splitReplace(subtitle, 'h1')).toMatchObject({ words: subtitle, blocks: '' });
    expect(
      splitReplace(
        'AEOとは？AEOはAIアシスタントの回答に引用されるための最適化の方法です。詳しく順番に説明します。',
        'h2',
      ),
    ).toMatchObject({
      words: 'AEOとは？',
      blocks:
        '<p>AEOはAIアシスタントの回答に引用されるための最適化の方法です。詳しく順番に説明します。</p>',
    });
    // "?" inside a word is no question's end.
    expect(splitReplace('What?No. A long enough sentence that ends here.', 'h2').blocks).toBe('');
    // Past the heading's limit the rest goes under it, a full stop or not.
    const long = `What is LLM SEO? ${'LLM SEO optimizes pages for large language models '.repeat(2)}`;
    expect(splitReplace(long, 'h2').words).toBe('What is LLM SEO?');
    // A second question is no answer, with its own answer or not: it stays,
    // for keepSuggestions to drop.
    const two = `What is LLM SEO? How does ${'LLM SEO read many engines and '.repeat(3)}work?`;
    expect(splitReplace(two, 'h2')).toMatchObject({ words: two, blocks: '' });
    const answered =
      'What is AEO? What is an AEO tracker? An AEO tracker is a tool that reads many AI engines for you.';
    expect(splitReplace(answered, 'h3')).toMatchObject({ words: answered, blocks: '' });
    // An answer that ends on a question still goes under the heading.
    const why = `What is LLM SEO? ${'LLM SEO optimizes pages for large language models. '.repeat(2)}Why care?`;
    expect(splitReplace(why, 'h2').words).toBe('What is LLM SEO?');
  });

  it('moves blocks sent with a paragraph replace after it', () => {
    expect(splitReplace('<p>Use 15 g.</p><ul><li>a scale</li></ul>', 'p')).toMatchObject({
      words: 'Use 15 g.',
      blocks: '<ul><li>a scale</li></ul>',
    });
  });
});

/**
 * Content Agent rule gaps, A: links only to the brand's pages and the draft's
 * sources it was given, a replace's beside its words, an insert's in its HTML.
 */
describe('links to the pages and sources given', () => {
  const page = draftPassages(
    '<h2>Pricing</h2><p>See our plans for teams.</p><p>Studies show it works.</p>',
  );
  const links = new Map(
    ['https://acme.example/pricing', 'https://research.example/study'].map((url) => [
      linkKey(url),
      url,
    ]),
  );
  const keep = (over, ruleKeys = ['internalLinks']) =>
    keepSuggestions(
      [suggestion({ passage: 2, before: 'See our plans for teams.', rules: ruleKeys, ...over })],
      page,
      new Set(),
      new Set(ruleKeys),
      links,
    );

  it('keeps a replace’s link to a listed page, by its words, with the page’s URL', () => {
    const [kept] = keep({
      after:
        'See <a href="https://www.acme.example/pricing/?utm_source=x">our plans</a> for teams.',
    });
    expect(kept).toMatchObject({
      kind: 'replace',
      after_text: 'See our plans for teams.',
      after_links: [{ start: 4, end: 13, href: 'https://acme.example/pricing' }],
      rule_keys: ['internalLinks'],
    });
  });

  it('puts a name it was not given as a placeholder, its link moved with the words (CE-044)', () => {
    const [kept] = keep({
      after:
        'Marco Rossi said <a href="https://www.acme.example/pricing/">our plans</a> fit teams.',
    });
    const words = `${NAME_PLACEHOLDER} said our plans fit teams.`;
    expect(kept.after_text).toBe(words);
    const start = words.indexOf('our plans');
    expect(kept.after_links).toEqual([
      { start, end: start + 'our plans'.length, href: 'https://acme.example/pricing' },
    ]);
  });

  it('unwraps a link to anything not listed, and drops what then changes nothing', () => {
    expect(
      keep({ after: 'See <a href="https://made-up.example/x">our plans</a> for teams.' }),
    ).toMatchObject([]);
    const [kept] = keep({ after: 'See <a href="https://made-up.example/x">our team plans</a>.' });
    expect(kept.after_text).toBe('See our team plans.');
    expect(kept).not.toHaveProperty('after_links');
  });

  it('keeps an insert’s link to a listed source, never one in a heading', () => {
    const [kept] = keepSuggestions(
      [
        suggestion({
          kind: 'insert',
          passage: 3,
          before: '',
          after:
            '<h3><a href="https://research.example/study">Study</a></h3><p>A <a href="https://research.example/study" target="_blank" onclick="x()">recent study</a> found it.</p>',
          rules: ['citeInline'],
          sources: ['S1'],
          marks: [{ words: 'recent study', source: 'S1' }],
        }),
      ],
      page,
      new Set(),
      new Set(['citeInline']),
      links,
      { numbered: numberSources({ pages: [{ url: 'https://research.example/study' }] }) },
    );
    expect(kept.after_text).toBe(
      '<h3>Study</h3><p>A <a href="https://research.example/study">recent study</a> found it.</p>',
    );
    // Its mark is by the insert's text: "Study" then the paragraph.
    expect(kept.source_marks).toEqual([{ start: 7, end: 19, source: 0 }]);
  });

  it('keeps at most 20 links on a replace, as the table allows', () => {
    const many = Array.from(
      { length: 22 },
      (_, i) => `<a href="https://acme.example/pricing">plan ${String.fromCharCode(97 + i)}</a>`,
    ).join(' ');
    const [kept] = keep({ after: `See ${many} for teams.` });
    expect(kept.after_links).toHaveLength(20);
  });

  it('keeps no link without targets, as before', () => {
    const [kept] = keepSuggestions(
      [
        suggestion({
          kind: 'insert',
          passage: 3,
          before: '',
          after: '<p>A <a href="https://research.example/study">study</a>.</p>',
        }),
      ],
      page,
      new Set(),
      new Set(),
    );
    expect(kept.after_text).toBe('<p>A study.</p>');
  });

  it('reads inline words and their links, spaces collapsed', () => {
    expect(inlineText('Read <a href="u"> the  guide </a><br>now')).toEqual({
      text: 'Read the guide now',
      links: [{ start: 5, end: 14, href: 'u' }],
    });
  });

  it('gives the model the targets for the link rules asked, and keeps the links', async () => {
    readLinkTargets.mockResolvedValue({
      own: [{ url: 'https://acme.example/brew-guide', title: 'Brew guide' }],
      sources: [{ url: 'https://research.example/study', title: 'Coffee study' }],
    });
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion({
            after:
              'Use good coffee (see <a href="https://acme.example/brew-guide">our brew guide</a>).',
            rules: ['internalLinks'],
          }),
        ],
      },
      usage: {},
    });
    const result = await fixDraftRules({
      draftId: DRAFT,
      brandId: BRAND,
      input: input({ rules: [{ key: 'internalLinks', name: 'Internal links', detail: '0 of 3' }] }),
    });

    expect(readLinkTargets).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: BRAND, draftId: DRAFT }),
    );
    const { prompt, system } = generateObject.mock.calls[0][0];
    expect(prompt).toContain(
      "Pages on the brand's site you may link to (internal links):\n- Brew guide — https://acme.example/brew-guide",
    );
    // Only the rule asked for: no outbound list.
    expect(prompt).not.toContain('Sources you may link to');
    expect(system).toContain('Never invent a URL');
    // The fan-outs a rule names, in their words (B).
    expect(system).toContain('fanoutH2 wants an H2, fanoutFaq a question');
    expect(system).toContain('One question per heading: never add a question to a heading.');
    expect(result.count).toBe(1);
    const batch = writes.find((w) => w.table === 'content_draft_suggestions');
    expect(batch.value[0]).toMatchObject({
      after_text: 'Use good coffee (see our brew guide).',
      after_links: [{ start: 21, end: 35, href: 'https://acme.example/brew-guide' }],
    });
  });
});

describe('cleanInsertHtml', () => {
  it('makes an agent’s H1 an H2: the page has its title', () => {
    expect(cleanInsertHtml('<h1 class="x">New title</h1><p>Text</p>')).toBe(
      '<h2>New title</h2><p>Text</p>',
    );
  });

  it('keeps simple blocks without attributes and unwraps the rest', () => {
    expect(
      cleanInsertHtml('<div><h3 style="x">Q</h3><ol><li><em>a</em></li></ol><img src=x></div>'),
    ).toBe('<h3>Q</h3><ol><li><em>a</em></li></ol>');
  });
});

describe('fixDraftRules', () => {
  it('keeps small the changes for rules people at the brand mostly reject, and says so on the run (learning B6)', async () => {
    rows.content_suggestion_decisions = [
      // One of this run's rules, mostly rejected.
      { rule_key: 'faq', accepted: 1, rejected: 7, drafts: 3 },
      // More rejected, more than five, but not rules here: none takes its place.
      ...Array.from({ length: 6 }, (_, i) => ({
        rule_key: `other${i}`,
        accepted: 0,
        rejected: 9 + i,
        drafts: 2,
      })),
      // A rule here people take.
      { rule_key: 'dated', accepted: 6, rejected: 1, drafts: 4 },
    ];
    const run = {
      id: 'r1',
      steps: [
        { key: 'read_rules', count: 2 },
        { key: 'gather_sources', count: 0 },
        { key: 'write_changes', count: null },
      ],
      signal: new AbortController().signal,
    };
    runs.startRun = async () => run;
    generateObject.mockResolvedValue({
      object: { suggestions: [] },
      usage: { inputTokens: 900, outputTokens: 20 },
    });
    try {
      await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() });
    } finally {
      runs.startRun = null;
      delete rows.content_suggestion_decisions;
    }
    const prompt = generateObject.mock.calls[0][0].prompt;
    expect(prompt).toContain(
      'People at this brand reject most of the changes suggested for these rules: faq (7 of 8 rejected).',
    );
    expect(prompt).not.toMatch(/other\d \(/);
    expect(run.steps[0]).toMatchObject({ key: 'read_rules', careful: ['faq'] });
  });

  it('tells the agent how the live page does now, and names it on the run (learning B5)', async () => {
    rows.content_drafts = { ...rows.content_drafts, source_url: 'https://acme.example/guide' };
    rows.content_page_impact = {
      citations: { cur: 12, prev: 20 },
      aiVisits: { cur: 35, prev: 40 },
      promptCounts: { cur: 4, prev: 6, lost: 1 },
      prompts: [{ text: 'pour over vs french press', cur: 0, prev: 4 }],
    };
    const run = {
      id: 'r1',
      steps: [
        { key: 'read_rules', count: 2 },
        { key: 'gather_sources', count: 0 },
        { key: 'write_changes', count: null },
      ],
      signal: new AbortController().signal,
    };
    runs.startRun = async () => run;
    generateObject.mockResolvedValue({
      object: { suggestions: [] },
      usage: { inputTokens: 900, outputTokens: 20 },
    });
    try {
      await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() });
    } finally {
      runs.startRun = null;
      delete rows.content_page_impact;
    }
    expect(generateObject.mock.calls[0][0].prompt).toContain(
      'How the live page does now (last 30 days, against the 30 before): tracked AI answers cited it 12 times (20 before)',
    );
    expect(run.steps[1]).toMatchObject({
      key: 'gather_sources',
      live: { days: 30, citations: 12, before: 20, lost: 1 },
    });
    // The brand's own page, at the address it optimizes, over the tab's 30 days.
    expect(rpc).toHaveBeenCalledWith('content_page_impact', {
      p_brand_id: BRAND,
      p_page: 'https://acme.example/guide',
      p_days: 30,
    });
  });

  it('reads the live page where it was published, as the Live page tab does', async () => {
    // Published at another address, then back to Draft: the tab reads that one.
    rows.content_drafts = {
      ...rows.content_drafts,
      source_url: 'https://acme.example/guide',
      published_url: 'https://acme.example/brew-guide',
    };
    generateObject.mockResolvedValue({
      object: { suggestions: [] },
      usage: { inputTokens: 900, outputTokens: 20 },
    });
    await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() });
    expect(rpc).toHaveBeenCalledWith(
      'content_page_impact',
      expect.objectContaining({ p_page: 'https://acme.example/brew-guide' }),
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'content_page_impact',
      expect.objectContaining({ p_page: 'https://acme.example/guide' }),
    );
  });

  it('names a live page on the run only when AI answers cited it, and still tells the agent of its visits', async () => {
    rows.content_drafts = { ...rows.content_drafts, source_url: 'https://acme.example/guide' };
    rows.content_page_impact = {
      citations: { cur: 0, prev: 0 },
      aiVisits: { cur: 35, prev: 40 },
      promptCounts: { cur: 0, prev: 0, lost: 0 },
      prompts: [],
    };
    const run = {
      id: 'r1',
      steps: [
        { key: 'read_rules', count: 2 },
        { key: 'gather_sources', count: 0 },
        { key: 'write_changes', count: null },
      ],
      signal: new AbortController().signal,
    };
    runs.startRun = async () => run;
    generateObject.mockResolvedValue({
      object: { suggestions: [] },
      usage: { inputTokens: 900, outputTokens: 20 },
    });
    try {
      await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() });
    } finally {
      runs.startRun = null;
      delete rows.content_page_impact;
    }
    expect(generateObject.mock.calls[0][0].prompt).toContain(
      'tracked AI answers cited it 0 times (0 before), for 0 prompts, and it had 35 AI visits (40 before).',
    );
    expect(run.steps[1]).not.toHaveProperty('live');
  });

  it('tells nothing of a live page for a new page', async () => {
    generateObject.mockResolvedValue({
      object: { suggestions: [] },
      usage: { inputTokens: 900, outputTokens: 20 },
    });
    await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() });
    expect(generateObject.mock.calls[0][0].prompt).not.toContain('How the live page does now');
  });

  it('runs on when the live page cannot be read, telling nothing of it', async () => {
    rows.content_drafts = { ...rows.content_drafts, source_url: 'https://acme.example/guide' };
    rpc.mockImplementation(async (name) =>
      name === 'content_page_impact'
        ? { data: null, error: { message: 'canceling statement due to statement timeout' } }
        : { data: rows[name] ?? [], error: null },
    );
    const run = {
      id: 'r1',
      steps: [
        { key: 'read_rules', count: 2 },
        { key: 'gather_sources', count: 0 },
        { key: 'write_changes', count: null },
      ],
      signal: new AbortController().signal,
    };
    runs.startRun = async () => run;
    generateObject.mockResolvedValue({
      object: { suggestions: [suggestion()] },
      usage: { inputTokens: 900, outputTokens: 200 },
    });
    vi.mocked(logger.warn).mockClear();
    try {
      await fixDraftRules({
        draftId: DRAFT,
        brandId: BRAND,
        input: input({ sources: SOURCES }),
      });
    } finally {
      runs.startRun = null;
    }
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(generateObject.mock.calls[0][0].prompt).not.toContain('How the live page does now');
    expect(run.steps[1]).not.toHaveProperty('live');
    expect(writes.find((w) => w.table === 'content_draft_suggestions')).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: DRAFT }),
      '[content-agent] live page not read',
    );
  });

  it("knows the shopping path's prices and names, a product's number only beside its name, and links its pages", async () => {
    rows.content_drafts = {
      ...rows.content_drafts,
      shopping_path: {
        version: 1,
        builtAt: '2026-10-27T10:00:00.000Z',
        pageType: 'guide',
        categories: [],
        products: [
          {
            id: 'k1',
            title: 'Ruth Miller Kettle 600',
            url: 'https://shop.example/products/k1',
            price: 49,
            salePrice: null,
            currency: 'USD',
            availability: 'in_stock',
            image: null,
            issues: [],
            score: 9,
          },
        ],
        leftOut: [],
        locked: [],
        removed: [],
        added: [],
      },
    };
    rows.brand_domains = [{ domain: 'shop.example' }];
    rows.catalog_variants = [
      { id: 'v1', product_id: 'k1', availability: 'in stock', price: 49, currency: 'USD' },
    ];
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion({
            after:
              'good coffee and the <a href="https://shop.example/products/k1">Ruth Miller Kettle 600</a> at $49',
            sources: [],
            marks: [],
          }),
          // The name's number alone: a number with no source, left for the person.
          suggestion({
            passage: 3,
            before: 'A dripper',
            after: 'A 600 ml dripper',
            sources: [],
            marks: [],
          }),
          // A name the path has, next to a role.
          suggestion({
            passage: 2,
            before: 'tastes better than other methods',
            after: 'tastes better, says designer Ruth Miller',
            sources: [],
            marks: [],
          }),
        ],
      },
      usage: { inputTokens: 900, outputTokens: 200 },
    });
    const result = await fixDraftRules({
      draftId: DRAFT,
      brandId: BRAND,
      input: input({ locked: [] }),
    });
    expect(generateObject.mock.calls[0][0].prompt).toContain(
      '- Ruth Miller Kettle 600 — https://shop.example/products/k1',
    );
    expect(result.count).toBe(3);
    const batch = writes.find((w) => w.table === 'content_draft_suggestions');
    expect(batch.value.map((r) => r.after_text)).toEqual([
      'good coffee and the Ruth Miller Kettle 600 at $49',
      'A [figure, source] ml dripper',
      'tastes better, says designer Ruth Miller',
    ]);
    expect(batch.value[0].after_links).toEqual([
      { start: 20, end: 42, href: 'https://shop.example/products/k1' },
    ]);
  });

  it('reads attributions in the page’s language: its Language rule, or My rules’ when it has none', async () => {
    // ", per E-Mail." gives a claim to a source on an English page, never on a German one.
    const perEmail = suggestion({
      after: 'good coffee and hot water; order by phone, per E-Mail',
      sources: [],
      marks: [],
    });
    const fix = async () => {
      generateObject.mockResolvedValue({
        object: { suggestions: [perEmail] },
        usage: { inputTokens: 900, outputTokens: 200 },
      });
      return (await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() })).count;
    };
    expect(await fix()).toBe(0);
    rows.content_drafts.rules = { overrides: { language: { value: 'German' } } };
    expect(await fix()).toBe(1);
    // No rules of its own: the workspace's My rules for its page type.
    rows.content_drafts.rules = null;
    rows.content_rule_sets = { overrides: { language: { value: 'German' } } };
    expect(await fix()).toBe(1);
  });

  it('gives a claim to the brand’s own data: its name is known', async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion({
            after: 'good coffee and hot water, as Acme Coffee’s data shows that brews improve',
            sources: [],
            marks: [],
          }),
        ],
      },
      usage: { inputTokens: 900, outputTokens: 200 },
    });
    const { count } = await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() });
    expect(count).toBe(1);
  });

  it('writes its suggestions with Claude Sonnet with an Anthropic key, charged at its price', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    generateObject.mockResolvedValue({
      object: { suggestions: [suggestion()] },
      usage: { inputTokens: 900, outputTokens: 200 },
    });
    await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input({ sources: SOURCES }) });

    const sonnet = 'anthropic/claude-sonnet-5-5';
    expect(reserveAiBudget).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ feature: 'content', modelId: sonnet }),
    );
    const call = generateObject.mock.calls[0][0];
    expect(call.model).toBe(`model:${sonnet}`);
    expect(call.maxOutputTokens).toBe(32_000);
    expect(call.providerOptions).toEqual({ anthropic: { structuredOutputMode: 'outputFormat' } });
    for (const key of ['temperature', 'topP', 'topK']) expect(call).not.toHaveProperty(key);
    // At most 8 suggestions, told in words: Claude takes no maxItems.
    expect(call.schema.jsonSchema.properties.suggestions).toMatchObject({
      description: '(at most 8 items)',
    });
    expect(call.schema.jsonSchema.properties.suggestions).not.toHaveProperty('maxItems');
    // $2 / $10 per million: 900 in and 200 out.
    const usage = writes.find((w) => w.table === 'prompt_improve_usage');
    expect(usage.value).toMatchObject({ model: sonnet, input_tokens: 900, output_tokens: 200 });
    expect(usage.value.cost_usd).toBeCloseTo(0.0038, 6);
  });

  it('charges the budget, asks the model and keeps one batch for review', async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion(),
          suggestion({ passage: 2, before: 'tastes better', after: 'is brighter' }),
        ],
      },
      usage: { inputTokens: 900, outputTokens: 200 },
    });

    const result = await fixDraftRules({
      draftId: DRAFT,
      brandId: BRAND,
      input: input({ sources: SOURCES }),
    });

    expect(reserveAiBudget).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ feature: 'content', modelId: expect.any(String) }),
    );
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.stringMatching(/^model:/),
        // An answer goes after a heading, never into it.
        system: expect.stringContaining(
          'Never write an answer, a sentence or a FAQ into a heading',
        ),
        // The data it writes from, numbered (CE-033).
        prompt: expect.stringContaining(
          'S1 Fan-out (a search AI ran while answering): "Pour over ratio 1:16" (chatgpt)\nS2 Cited page (AI answers cite it today; answer better, never copy): https://sca.example/brew (publication)',
        ),
      }),
    );
    expect(generateObject.mock.calls[0][0].system).toContain(
      "you don't see what a cited page says",
    );
    expect(result).toEqual({ count: 1, batchId: expect.any(String) });
    const usage = writes.find((w) => w.table === 'prompt_improve_usage');
    expect(usage.value).toMatchObject({
      organization_id: 'org-1',
      content_draft_id: DRAFT,
      feature: 'content',
    });
    const batch = writes.find((w) => w.table === 'content_draft_suggestions');
    expect(batch.value).toEqual([
      expect.objectContaining({
        draft_id: DRAFT,
        batch_id: result.batchId,
        action_id: 'act-1',
        position: 0,
        kind: 'replace',
        sources: [
          expect.objectContaining({ kind: 'cited_page', ref: 'https://sca.example/brew' }),
          expect.objectContaining({ kind: 'fanout', ref: 'pour over ratio 1:16' }),
        ],
        source_marks: [
          { start: 4, end: 6, source: 1 },
          { start: 16, end: 37, source: 0 },
        ],
      }),
    ]);
  });

  it('looks a fact up instead of leaving a placeholder, and links it where it was found', async () => {
    const STANDARD = 'https://sca.example/water-standard';
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion({
            after: 'freshly ground coffee and water at {{find: SCA brewing water temperature}}',
            sources: [],
            marks: [],
          }),
          // A figure it wrote with no source, that no page has: left for the person, never dropped unseen.
          suggestion({
            passage: 3,
            before: 'A dripper and a filter',
            after: 'A dripper and a filter, 40% cheaper',
            sources: [],
            marks: [],
          }),
        ],
      },
      usage: { inputTokens: 900, outputTokens: 200 },
    });
    generateText.mockImplementationOnce(async (call) => ({
      ...(await notFound(call)),
      text: JSON.stringify({
        facts: [
          {
            id: 'G1',
            text: 'freshly ground coffee and water at 90.5–96.1 °C',
            source: STANDARD,
            words: '90.5–96.1 °C',
          },
        ],
      }),
      sources: [{ sourceType: 'url', url: STANDARD, title: 'Water standard' }],
      providerMetadata: { anthropic: { usage: { server_tool_use: { web_search_requests: 1 } } } },
    }));

    const result = await fixDraftRules({
      draftId: DRAFT,
      brandId: BRAND,
      input: input({ sources: SOURCES }),
    });

    // Looked up on the read model, with its search, on its own hold.
    const call = generateText.mock.calls[0][0];
    expect(call.prompt).toContain('needs: find: SCA brewing water temperature');
    expect(call.prompt).toContain('needs: check: 40%');
    expect(reserveAiBudget).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ feature: 'quality', holdUsd: expect.any(Number) }),
    );
    expect(result).toEqual({ count: 2, batchId: expect.any(String) });
    const [row, second] = writes.find((w) => w.table === 'content_draft_suggestions').value;
    expect(second.after_text).toBe('A dripper and a filter, [figure, source] cheaper');
    expect(row).toMatchObject({
      kind: 'replace',
      after_text: 'freshly ground coffee and water at 90.5–96.1 °C',
      after_links: [{ start: 35, end: 47, href: STANDARD }],
    });
    expect(row.after_text).not.toMatch(/[[{]/);
  });

  it("knows the workspace's authors, and puts any other person as a placeholder (CE-044)", async () => {
    rows.content_authors = [{ name: 'Ada Lovelace', title: 'Head of Content', bio: null }];
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion({
            after: 'good coffee and hot water, says Ada Lovelace',
            sources: [],
            marks: [],
          }),
          suggestion({
            passage: 3,
            before: 'A dripper and a filter',
            after: 'A dripper and a filter, as Marco Rossi said',
            sources: [],
            marks: [],
          }),
        ],
      },
      usage: { inputTokens: 900, outputTokens: 200 },
    });
    await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input({ sources: SOURCES }) });
    const batch = writes.find((w) => w.table === 'content_draft_suggestions');
    expect(batch.value.map((row) => row.after_text)).toEqual([
      'good coffee and hot water, says Ada Lovelace',
      `A dripper and a filter, as ${NAME_PLACEHOLDER} said`,
    ]);
  });

  it('numbers the brand’s prompts among those kept, first', async () => {
    rows.prompts = [{ id: 'p1', text: 'What ratio for pour-over?' }];
    generateObject.mockResolvedValue({ object: { suggestions: [] }, usage: {} });
    await fixDraftRules({
      draftId: DRAFT,
      brandId: BRAND,
      input: input({ sources: { ...SOURCES, promptIds: ['p1', 'p-other-brand'] } }),
    });
    expect(generateObject.mock.calls[0][0].prompt).toContain(
      'S1 Prompt (a question tracked in AI answers): "What ratio for pour-over?"\nS2 Fan-out',
    );
  });

  it("writes from Brief › Your input in Quality's second phase, numbered last (CE-048)", async () => {
    rows.content_draft_inputs = {
      experience: null,
      data: [
        {
          name: 'Survey',
          rows: [
            ['Teams', 'Share'],
            ['1,250', '42%'],
          ],
        },
      ],
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
        suggestions: [
          suggestion({
            after: 'good coffee and hot water: 1,250 teams brew this way',
            sources: ['S3'],
            marks: [],
          }),
          suggestion({
            passage: 3,
            before: 'A dripper and a filter',
            after:
              'A dripper and a filter. “We cut our forecast misses in half,” says Ada Lovelace',
            sources: ['S4'],
            marks: [],
          }),
        ],
      },
      usage: { inputTokens: 900, outputTokens: 200 },
    });
    const before = process.env.CONTENT_QUALITY_PHASE;
    process.env.CONTENT_QUALITY_PHASE = '2';
    try {
      await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input({ sources: SOURCES }) });
    } finally {
      if (before === undefined) delete process.env.CONTENT_QUALITY_PHASE;
      else process.env.CONTENT_QUALITY_PHASE = before;
    }
    const prompt = generateObject.mock.calls[0][0].prompt;
    expect(prompt).toContain(
      `S3 Your input (the person's own, given for this page): "Survey" (Their own data, a table: Teams | Share; 1,250 | 42%)`,
    );
    expect(prompt).toContain('S4 Your input');
    expect(prompt).toContain('quote an expert word for word');
    // Its number and its expert are the person's own: kept, each with its source.
    const batch = writes.find((w) => w.table === 'content_draft_suggestions');
    expect(batch.value.map((row) => [row.after_text, row.sources])).toEqual([
      [
        'good coffee and hot water: 1,250 teams brew this way',
        [{ kind: 'input', ref: 'data:1', label: 'Survey' }],
      ],
      [
        'A dripper and a filter. “We cut our forecast misses in half,” says Ada Lovelace',
        [{ kind: 'input', ref: 'quote:1', label: 'Ada Lovelace, Head of Research, Acme' }],
      ],
    ]);
  });

  it("reads no input before Quality's second phase", async () => {
    rows.content_draft_inputs = { experience: 'We tested it for six weeks.' };
    generateObject.mockResolvedValue({ object: { suggestions: [] }, usage: {} });
    await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input({ sources: SOURCES }) });
    expect(generateObject.mock.calls[0][0].prompt).not.toContain('Your input');
  });

  it('keeps nothing once stopped, and says so (CE-027)', async () => {
    const { RunStoppedError } = await import('./contentRuns.js');
    stopIfStopped.mockRejectedValueOnce(new RunStoppedError());
    generateObject.mockResolvedValue({
      object: { suggestions: [suggestion()] },
      usage: { inputTokens: 900, outputTokens: 200 },
    });
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input({ sources: SOURCES }) }),
    ).rejects.toMatchObject({ status: 409, code: 'stopped' });
    expect(writes.find((w) => w.table === 'content_draft_suggestions')).toBeUndefined();
    // The call it made is still charged: the provider billed it.
    expect(writes.find((w) => w.table === 'prompt_improve_usage')).toBeDefined();
  });

  it('says why a run left nothing: none proposed, all in quoted passages, or dropped', () => {
    const passages = [
      { tag: 'p', text: 'A quoted passage.' },
      { tag: 'p', text: 'A free one.' },
    ];
    const locked = new Set([passageKey('A quoted passage.')]);
    expect(emptyWhy([], passages, locked)).toBe('none');
    expect(emptyWhy([{ kind: 'replace', passage: 1 }], passages, locked)).toBe('locked');
    expect(
      emptyWhy(
        [
          { kind: 'replace', passage: 1 },
          { kind: 'replace', passage: 2 },
        ],
        passages,
        locked,
      ),
    ).toBe('dropped');
    expect(emptyWhy([{ kind: 'insert', passage: 1 }], passages, locked)).toBe('dropped');
  });

  it('keeps nothing when the agent found nothing it could change', async () => {
    generateObject.mockResolvedValue({ object: { suggestions: [] }, usage: {} });
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ count: 0, batchId: null, why: 'none' });
    expect(writes.some((w) => w.table === 'content_draft_suggestions')).toBe(false);
  });

  it('refuses another brand’s draft or an empty page before charging anything', async () => {
    await expect(
      fixDraftRules({
        draftId: DRAFT,
        brandId: '44444444-4444-4444-4444-444444444444',
        input: input(),
      }),
    ).rejects.toMatchObject({ status: 404 });
    rows.content_drafts.body_html = '<p> </p>';
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 422, code: 'empty' });
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('runs one fix at a time on a draft: another under way is 409 running', async () => {
    rows.content_agent_runs = [{ id: 'run-1' }];
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 409, code: 'running' });
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('waits while Start or a rewrite holds the draft, which a stopped server no longer does', async () => {
    rows.content_drafts.agent_state = 'writing';
    rows.content_drafts.agent_state_at = new Date().toISOString();
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 409, code: 'writing' });
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();

    // Left 'writing' long ago: no run holds it.
    rows.content_drafts.agent_state_at = new Date(Date.now() - 11 * 60_000).toISOString();
    generateObject.mockResolvedValue({
      object: { suggestions: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ count: 0, batchId: null, why: 'none' });
  });

  it('refuses a published draft, or one whose latest batch is still open, before charging', async () => {
    rows.content_drafts.status = 'published';
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 409, code: 'published' });

    rows.content_drafts.status = 'ready';
    // Newest first: the latest batch b2 has an open row.
    rows.content_draft_suggestions = [
      { batch_id: 'b2', status: 'accepted' },
      { batch_id: 'b2', status: 'open' },
      { batch_id: 'b1', status: 'open' },
    ];
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 409, code: 'open_suggestions' });
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();

    // An older batch left open doesn't count: the editor shows the latest.
    rows.content_draft_suggestions = [
      { batch_id: 'b2', status: 'rejected' },
      { batch_id: 'b1', status: 'open' },
    ];
    generateObject.mockResolvedValue({ object: { suggestions: [] }, usage: {} });
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ count: 0, batchId: null, why: 'none' });
  });

  it('stops at the budget', async () => {
    reserveAiBudget.mockRejectedValue(new PlanLimitError('AI usage is spent', 'starter'));
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('lets the hold on the budget go when the model fails', async () => {
    const held = { charge: vi.fn(), release: vi.fn() };
    reserveAiBudget.mockResolvedValueOnce(held);
    generateObject.mockRejectedValueOnce(new Error('timeout'));
    await expect(fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() })).rejects.toThrow(
      'timeout',
    );
    expect(held.charge).not.toHaveBeenCalled();
    expect(held.release).toHaveBeenCalled();
  });

  it('charges an answer that missed the schema, as the provider billed it', async () => {
    const held = { charge: vi.fn(), release: vi.fn() };
    reserveAiBudget.mockResolvedValueOnce(held);
    const billed = { inputTokens: 900, outputTokens: 4000 };
    generateObject.mockRejectedValueOnce(
      Object.assign(new NoObjectGeneratedError('no object'), { usage: billed }),
    );
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toBeInstanceOf(NoObjectGeneratedError);
    expect(held.charge).toHaveBeenCalledTimes(1);
    expect(held.charge).toHaveBeenCalledWith(billed);
    expect(held.release).toHaveBeenCalled();
  });
});

describe('Quality’s hand-off (CE-051)', () => {
  const handoff = (over = {}) =>
    input({
      rules: [
        {
          key: 'trust:claimsSourced',
          name: 'Every figure or claim has a source in its paragraph',
          // The editor's words: no fact the agent may write.
          detail: 'Brew at 94 degrees for 4 minutes.',
        },
      ],
      locked: [],
      ...over,
    });

  it('runs as a hand-off, and keeps the editor’s details from the facts it may write', async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion({
            before: 'good coffee and hot water',
            after: 'good coffee and water at 94 degrees',
            rules: ['trust:claimsSourced'],
            sources: [],
            marks: [],
          }),
        ],
      },
      usage: { inputTokens: 900, outputTokens: 200 },
    });
    await fixDraftRules({
      draftId: DRAFT,
      brandId: BRAND,
      input: handoff(),
      handoff: { origin: 'person' },
    });
    // 94 was only in the editor's detail: a number with no source, looked up,
    // found nowhere, so the person's to fill.
    expect(writes.find((w) => w.table === 'content_draft_suggestions').value[0].after_text).toBe(
      'good coffee and water at [figure, source] degrees',
    );
    // A Fix open rules run takes the details as given.
    writes = [];
    await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: handoff() });
    expect(writes.find((w) => w.table === 'content_draft_suggestions').value[0].after_text).toBe(
      'good coffee and water at 94 degrees',
    );
  });

  it('runs as it was for the checks people at the brand mostly reject: Apply rules with Agent only (learning B6)', async () => {
    rows.content_suggestion_decisions = [
      { rule_key: 'trust:claimsSourced', accepted: 0, rejected: 9, drafts: 3 },
    ];
    const run = () => ({
      id: 'r1',
      steps: [
        { key: 'read_rules', count: 1 },
        { key: 'gather_sources', count: 0 },
        { key: 'write_changes', count: null },
      ],
      signal: new AbortController().signal,
    });
    const handedOff = run();
    const fixed = run();
    generateObject.mockResolvedValue({
      object: { suggestions: [] },
      usage: { inputTokens: 900, outputTokens: 20 },
    });
    try {
      runs.startRun = async () => handedOff;
      await fixDraftRules({
        draftId: DRAFT,
        brandId: BRAND,
        input: handoff(),
        handoff: { origin: 'person' },
      });
      // The same rules in Apply rules with Agent are kept small.
      runs.startRun = async () => fixed;
      await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: handoff() });
    } finally {
      runs.startRun = null;
      delete rows.content_suggestion_decisions;
    }
    expect(generateObject.mock.calls[0][0].prompt).not.toContain('People at this brand reject');
    expect(handedOff.steps[0]).not.toHaveProperty('careful');
    expect(generateObject.mock.calls[1][0].prompt).toContain(
      'People at this brand reject most of the changes suggested for these rules: trust:claimsSourced (9 of 9 rejected).',
    );
    expect(fixed.steps[0]).toMatchObject({ careful: ['trust:claimsSourced'] });
  });

  it('runs as it was on a live page: Apply rules with Agent only is told how it does (learning B5)', async () => {
    rows.content_drafts = { ...rows.content_drafts, source_url: 'https://acme.example/guide' };
    rows.content_page_impact = {
      citations: { cur: 12, prev: 20 },
      aiVisits: { cur: 35, prev: 40 },
      promptCounts: { cur: 4, prev: 6, lost: 1 },
      prompts: [{ text: 'pour over vs french press', cur: 0, prev: 4 }],
    };
    const run = () => ({
      id: 'r1',
      steps: [
        { key: 'read_rules', count: 1 },
        { key: 'gather_sources', count: 0 },
        { key: 'write_changes', count: null },
      ],
      signal: new AbortController().signal,
    });
    const handedOff = run();
    const fixed = run();
    generateObject.mockResolvedValue({
      object: { suggestions: [] },
      usage: { inputTokens: 900, outputTokens: 20 },
    });
    try {
      runs.startRun = async () => handedOff;
      await fixDraftRules({
        draftId: DRAFT,
        brandId: BRAND,
        input: handoff(),
        handoff: { origin: 'person' },
      });
      // The hand-off doesn't even read it.
      expect(rpc).not.toHaveBeenCalledWith('content_page_impact', expect.anything());
      // The same page in Apply rules with Agent is told how it does.
      runs.startRun = async () => fixed;
      await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: handoff() });
    } finally {
      runs.startRun = null;
      delete rows.content_page_impact;
    }
    expect(generateObject.mock.calls[0][0].prompt).not.toContain('How the live page does now');
    expect(handedOff.steps[1]).not.toHaveProperty('live');
    expect(generateObject.mock.calls[1][0].prompt).toContain('How the live page does now');
    expect(fixed.steps[1]).toMatchObject({ live: { citations: 12, before: 20, lost: 1 } });
  });

  it('runs an automatic one only on a draft its brand hands off', async () => {
    await expect(
      fixDraftRules({
        draftId: DRAFT,
        brandId: BRAND,
        input: handoff(),
        handoff: { origin: 'auto' },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'not_due' });
    expect(generateObject).not.toHaveBeenCalled();
  });

  describe('an automatic one', () => {
    beforeEach(() => {
      rows.content_drafts = { ...rows.content_drafts, quality_handoff: true };
      rows.brands = { ...rows.brands, content_quality_handoff: true };
      runs.startRun = vi.fn(async () => ({
        id: 'run-9',
        steps: [],
        signal: new AbortController().signal,
      }));
      runs.dropRun = vi.fn(async () => {});
      runs.finishRun = vi.fn(async () => {});
    });
    afterEach(() => {
      runs.startRun = runs.dropRun = runs.finishRun = null;
    });

    it('doesn’t run once the brand turned it off, though the draft was made while it was on', async () => {
      rows.brands = { ...rows.brands, content_quality_handoff: false };
      await expect(
        fixDraftRules({
          draftId: DRAFT,
          brandId: BRAND,
          input: handoff(),
          handoff: { origin: 'auto' },
        }),
      ).rejects.toMatchObject({ status: 409, code: 'not_due' });
      expect(runs.startRun).not.toHaveBeenCalled();
    });

    it('claims its one run, and gives it back when the AI budget stops it before it begins', async () => {
      reserveAiBudget.mockRejectedValue(new PlanLimitError('used up', 429));
      await expect(
        fixDraftRules({
          draftId: DRAFT,
          brandId: BRAND,
          input: handoff(),
          handoff: { origin: 'auto' },
        }),
      ).rejects.toBeInstanceOf(PlanLimitError);
      expect(runs.startRun).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'handoff', origin: 'auto', strict: true }),
      );
      expect(runs.dropRun).toHaveBeenCalled();
      expect(runs.finishRun).not.toHaveBeenCalled();
    });

    it('keeps a person’s run, the budget spent, as failed', async () => {
      reserveAiBudget.mockRejectedValue(new PlanLimitError('used up', 429));
      await expect(
        fixDraftRules({
          draftId: DRAFT,
          brandId: BRAND,
          input: handoff(),
          handoff: { origin: 'person' },
        }),
      ).rejects.toBeInstanceOf(PlanLimitError);
      expect(runs.startRun).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'handoff', origin: 'person', strict: false }),
      );
      expect(runs.dropRun).not.toHaveBeenCalled();
      expect(runs.finishRun).toHaveBeenCalledWith(expect.anything(), 'failed');
    });
  });

  it('links the draft’s sources for its source checks, and writes the brand’s approved facts', async () => {
    rows.brand_facts = [{ quote: 'Pro costs $49 per month' }];
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion({
            before: 'good coffee and hot water',
            after: 'good coffee and hot water, from $49 per month',
            rules: ['trust:brandFacts'],
            sources: [],
            marks: [],
          }),
        ],
      },
      usage: { inputTokens: 900, outputTokens: 200 },
    });
    await fixDraftRules({
      draftId: DRAFT,
      brandId: BRAND,
      input: handoff({
        rules: [
          { key: 'trust:brandFacts', name: 'Match the brand’s approved facts', detail: '' },
          { key: 'trust:claimsSourced', name: 'Every figure has a source', detail: '' },
        ],
      }),
      handoff: { origin: 'person' },
    });
    expect(readLinkTargets.mock.calls[0][0].ruleKeys).toEqual(
      new Set(['trust:brandFacts', 'trust:claimsSourced', 'outboundLinks', 'citeInline']),
    );
    expect(writes.find((w) => w.table === 'content_draft_suggestions').value[0].after_text).toBe(
      'good coffee and hot water, from $49 per month',
    );
  });

  it('leaves a placeholder to the person: a change that fills or drops one isn’t kept', () => {
    const page = 'Brew it for [time, source] at home.';
    expect(dropsPlaceholder(page, 'for [time, source] at home', 'for 4 minutes at home')).toBe(
      true,
    );
    expect(dropsPlaceholder(page, 'Brew it', 'Steep it')).toBe(false);
    // A "before" that cuts into the brackets fills it all the same.
    expect(dropsPlaceholder('Buy [product name] today.', 'product name', 'GetCito Pro')).toBe(true);
    expect(dropsPlaceholder('See note [1].', 'See note', 'See the note')).toBe(false);
    const passages = draftPassages('<p>Brew it for [time, source] at home, then pour.</p>');
    const fill = suggestion({
      passage: 1,
      before: 'Brew it for [time, source] at home',
      after: 'Brew it for a while at home',
      rules: ['readability:longSentences'],
      sources: [],
      marks: [],
    });
    const rules = new Set(['readability:longSentences']);
    expect(
      keepSuggestions([fill], passages, new Set(), rules, null, { keepPlaceholders: true }),
    ).toEqual([]);
    expect(keepSuggestions([fill], passages, new Set(), rules)).toHaveLength(1);
  });

  it('counts each placeholder, so filling one of two alike isn’t kept either', () => {
    const page = 'Teams save [figure, source] and cut costs by [figure, source].';
    expect(dropsPlaceholder(page, 'Teams save [figure, source]', 'Teams save 30%')).toBe(true);
    expect(dropsPlaceholder(page, 'Teams save', 'Most teams save')).toBe(false);
    // In a heading only the agent's forms are placeholders: a title's own brackets aren't.
    expect(
      dropsPlaceholder(
        'Best CRM tools [2026 Update]',
        'Best CRM tools [2026 Update]',
        'Best CRM tools in 2026',
        'h1',
      ),
    ).toBe(false);
    expect(
      dropsPlaceholder('Save [figure, source] a week', 'Save [figure, source]', 'Save hours', 'h2'),
    ).toBe(true);

    // Read in what is kept: a placeholder moved into the blocks after the passage stays.
    const passages = draftPassages(
      '<p>Teams save [figure, source] and cut costs by [figure, source], every month.</p>',
    );
    const rules = new Set(['trust:claimsSourced']);
    const filled = suggestion({
      passage: 1,
      before: 'Teams save [figure, source] and cut costs',
      after: 'Teams save 30% and cut costs',
      rules: ['trust:claimsSourced'],
      sources: [],
      marks: [],
    });
    expect(
      keepSuggestions([filled], passages, new Set(), rules, null, { keepPlaceholders: true }),
    ).toEqual([]);
    const moved = suggestion({
      passage: 1,
      before: 'Teams save [figure, source] and cut costs by [figure, source], every month.',
      after:
        'Teams save [figure, source] every month.<p>They cut costs by [figure, source] too.</p>',
      rules: ['trust:claimsSourced'],
      sources: [],
      marks: [],
    });
    expect(
      keepSuggestions([moved], passages, new Set(), rules, null, { keepPlaceholders: true }),
    ).toHaveLength(2);
  });

  it('tells the model to leave the placeholders on a hand-off only', () => {
    const args = {
      brand: { name: 'Acme' },
      draft: { title: 'T', page_type: null },
      passages: draftPassages('<p>Brew it for [time, source].</p>'),
      lockedKeys: new Set(),
      input: { rules: [], textRules: [] },
    };
    expect(buildFixPrompt({ ...args, handoff: true })).toContain(
      'Leave every [placeholder] exactly as it is',
    );
    expect(buildFixPrompt(args)).not.toContain('Leave every [placeholder]');
  });
});
