import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { htmlBlockElement } from './htmlAllowlist';
import { productBlockHtml } from './productBlock';
import type { ShoppingCheck, ShoppingLinkState } from './shoppingCheck';
import {
  NO_DRAFT_RULES,
  NOT_FOR_AGENT,
  notForAgentMessage,
  fanoutsToUse,
  openRulesForAgent,
  overLengthFor,
  activeRules,
  effectiveRules,
  splitRules,
  textRuleCheck,
  checkRule,
  draftRulesSchema,
  readPage,
  ruleLength,
  wordsForLength,
  lengthWarns,
  lengthConflict,
  ruleSet,
  rulesMet,
  type ActiveRule,
  type RuleContext,
  draftRulesFit,
  ruleSetFits,
  storedBytes,
  overridesForImport,
  setToSave,
  pageTextLength,
  startingRules,
  RULE_LENGTH_MIN,
  RULE_LENGTH_MAX,
  lengthBand,
  NO_REACH,
  NO_RULE_CONTEXT,
  heldMessage,
  keptOutOfReach,
  lengthOutOfReach,
  rewriteAdvice,
  SHOPPING_RULE_KEYS,
  type RuleStatus,
} from './rules';

const ctx: RuleContext = {
  brandDomains: ['acme.example'],
  competitorDomains: ['crema.example'],
  fanouts: [
    'best espresso machine under 500',
    'home espresso grinder',
    'espresso machine reviews 2026',
  ],
};

const rule = (
  key: string,
  pageType: Parameters<typeof ruleSet>[0] = 'feature_page',
  value?: string,
): ActiveRule => {
  const rules = activeRules(
    ruleSet(pageType),
    value === undefined ? NO_DRAFT_RULES : { overrides: { [key]: { value } } },
  );
  const found = rules.find((r) => r.key === key);
  if (!found) throw new Error(`no rule ${key}`);
  return found;
};

const page = (html: string, characters = 0) => readPage(html, characters);
const check = (
  key: string,
  html: string,
  value?: string,
  pageType?: Parameters<typeof ruleSet>[0],
) => checkRule(rule(key, pageType ?? 'feature_page', value), page(html), ctx);

describe('rule sets', () => {
  it('puts the page type’s own rules above the shared groups, with its length', () => {
    expect(
      ruleSet('feature_page')
        .map((r) => r.key)
        .slice(0, 4),
    ).toEqual(['comparisonTable', 'whoFor', 'proofPerSection', 'sentence']);
    expect(ruleSet('blog_post')[0].key).toBe('sentence');
    expect(ruleSet('product_page').find((r) => r.key === 'length')?.value).toBe('1200');
    expect(ruleSet(null).find((r) => r.key === 'length')?.value).toBe('3000');
    expect(
      ruleSet('guide', { keywords: ['espresso', 'grinder'] }).find((r) => r.key === 'keywords')
        ?.value,
    ).toBe('espresso, grinder');
  });

  it('checks the rules against the database’s size in bytes, not characters', () => {
    const rule = (text: string, i: number) => ({ id: `r${i}`, text, on: true });
    const latin = Array.from({ length: 40 }, (_, i) => rule('a'.repeat(300), i));
    const cjk = Array.from({ length: 40 }, (_, i) => rule('日'.repeat(300), i));
    const rules = (textRules: typeof latin) => ({
      set: null,
      source: 'default' as const,
      overrides: {},
      textRules,
    });
    expect(draftRulesFit(rules(latin))).toBe(true);
    expect(draftRulesFit(rules(cjk))).toBe(false);
    expect(ruleSetFits({ overrides: {}, textRules: latin })).toBe(true);
    expect(
      ruleSetFits({
        overrides: Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`k${i}`, { value: 'ü'.repeat(300) }]),
        ),
        textRules: [],
      }),
    ).toBe(false);
    // jsonb writes a space after each ':' and ',': the count errs high, never low.
    expect(storedBytes({ a: [1, 2] })).toBeGreaterThanOrEqual('{"a": [1, 2]}'.length);
  });

  it('writes in the brand’s language by default, US English for English or none', () => {
    const language = (code?: string | null) =>
      ruleSet('guide', { language: code }).find((r) => r.key === 'language')?.value;
    expect(language('tr')).toBe('Turkish');
    expect(language('pt')).toBe('Portuguese');
    expect(language('en')).toBe('English (US)');
    expect(language(null)).toBe('English (US)');
    expect(language('xx')).toBe('English (US)');
  });

  it('applies the draft’s choices', () => {
    const rules = activeRules(ruleSet('category_page'), {
      overrides: { length: { value: '1000' }, faq: { on: false } },
    });
    expect(rules.find((r) => r.key === 'length')).toMatchObject({
      current: '1000',
      changed: true,
      on: true,
    });
    expect(rules.find((r) => r.key === 'faq')).toMatchObject({ on: false, changed: true });
    expect(rules.find((r) => r.key === 'sentence')).toMatchObject({ changed: false });
    expect(ruleLength(rules, 'category_page')).toBe(1000);
    const off = activeRules(ruleSet('category_page'), {
      overrides: { length: { on: false } },
    });
    expect(ruleLength(off, 'category_page')).toBe(800);
    // Kept within what Rebuild outline builds for.
    const tiny = activeRules(ruleSet('category_page'), {
      overrides: { length: { value: '50' } },
    });
    expect(ruleLength(tiny, 'category_page')).toBe(100);
    const huge = activeRules(ruleSet('category_page'), {
      overrides: { length: { value: '600000' } },
    });
    expect(ruleLength(huge, 'category_page')).toBe(50_000);
  });

  it('counts a word with its vowel signs as one, as Readability does (Hindi)', () => {
    // Hindi's vowel signs are marks, not letters: the words split at them before.
    expect(page('<p>यह पहला वाक्य है। यह दूसरा है।</p>').blocks[0].words).toBe(7);
    expect(page("<p>Don't split well-known words.</p>").blocks[0].words).toBe(4);
  });

  it('says a length in characters as about so many words (v1.1 §3.2)', () => {
    // To the nearest ten from 100 words on, as the Brief shows it.
    expect(wordsForLength(4000)).toBe(670);
    expect(wordsForLength(3000)).toBe(500);
    expect(wordsForLength(50_000)).toBe(8330);
    // Below 100 words, as is; never none.
    expect(wordsForLength(300)).toBe(50);
    expect(wordsForLength(1)).toBe(1);
  });

  it('keeps the draft’s choices to their limits', () => {
    expect(
      draftRulesSchema.safeParse({ set: 'blog_post', overrides: { faq: { on: false } } }).success,
    ).toBe(true);
    expect(draftRulesSchema.safeParse({ set: 'nope', overrides: {} }).success).toBe(false);
    expect(
      draftRulesSchema.safeParse({ overrides: { tone: { value: 'x'.repeat(501) } } }).success,
    ).toBe(false);
  });
});

describe('length and structure', () => {
  it('counts sentences over the limit', () => {
    expect(check('sentence', `<p>Short one. ${'Long '.repeat(40)}sentence.</p>`)).toEqual({
      state: 'bad',
      code: 'over',
      count: 1,
    });
    expect(check('sentence', '<p>Short. Also short!</p>')).toEqual({ state: 'ok' });
  });

  it('reads the length from the editor’s count, as a target within 20%', () => {
    // A 3,000 target: 2,400–3,600 meets it.
    expect(checkRule(rule('length'), page('', 2610), ctx)).toEqual({ state: 'ok' });
    expect(checkRule(rule('length'), page('', 3600), ctx)).toEqual({ state: 'ok' });
    expect(checkRule(rule('length'), page('', 2000), ctx)).toEqual({
      state: 'bad',
      code: 'short',
      count: 2000,
      min: 2400,
      max: 3600,
    });
    // A page far over its target is open, for Apply rules with Agent to shorten.
    expect(checkRule(rule('length'), page('', 15921), ctx)).toEqual({
      state: 'bad',
      code: 'long',
      count: 15921,
      min: 2400,
      max: 3600,
    });
  });

  it('wants one H1 per page, and leaves the agent out of it', () => {
    expect(check('oneH1', '<h1>T</h1><h2>A</h2>')).toEqual({ state: 'ok' });
    expect(check('oneH1', '<p>No title yet.</p>')).toEqual({ state: 'ok' });
    expect(check('oneH1', '<h1>T</h1><p>x</p><h1>Again</h1>')).toEqual({
      state: 'bad',
      code: 'found',
      count: 2,
    });
    // An empty H1 line is no title; an HTML block's H1 is the page's.
    expect(check('oneH1', '<h1>T</h1><h1></h1>')).toEqual({ state: 'ok' });
    expect(
      check('oneH1', `<h1>T</h1><div data-html-block="${btoa('<h1>Hero</h1>')}"></div>`),
    ).toEqual({ state: 'bad', code: 'found', count: 2 });
    // The agent changes words, never a heading's level.
    expect(NOT_FOR_AGENT.has('oneH1')).toBe(true);
    expect(ruleSet('blog_post').some((r) => r.key === 'oneH1')).toBe(true);
    // Always on: a draft's or a saved set's "off" doesn't turn it off.
    const [oneH1] = activeRules(
      ruleSet('blog_post').filter((r) => r.key === 'oneH1'),
      { overrides: { oneH1: { on: false } } },
    );
    expect(oneH1.on).toBe(true);
  });

  it('asks the agent only for what it can fix, and names the rest', () => {
    const rules = activeRules(ruleSet('blog_post'), NO_DRAFT_RULES);
    const p = page('<h1>T</h1><p>delve</p><h1>Again</h1>', 30);
    const statuses = rules.map((r) => ({ rule: r, status: checkRule(r, p, ctx) }));
    const all = openRulesForAgent(statuses);
    expect(all.forAgent.some(({ rule }) => rule.key === 'oneH1')).toBe(false);
    expect(all.notForAgent.map(({ rule }) => rule.key)).toEqual(['oneH1']);
    // Asked for one rule only, the rest stay out.
    const one = openRulesForAgent(statuses, ['aiTraces']);
    expect(one.forAgent.map(({ rule }) => rule.key)).toEqual(['aiTraces']);
    expect(one.notForAgent).toEqual([]);
    expect(openRulesForAgent(statuses, ['oneH1']).forAgent).toEqual([]);
    // Held on this page by what it keeps word for word: the person's, apart.
    const held = openRulesForAgent(statuses, undefined, new Set(['aiTraces']));
    expect(held.forAgent.some(({ rule }) => rule.key === 'aiTraces')).toBe(false);
    expect(held.held.map(({ rule }) => rule.key)).toEqual(['aiTraces']);
    expect(held.notForAgent.map(({ rule }) => rule.key)).toEqual(['oneH1']);
    // What to say when they're all that's left: the quoted passages', else the Length's.
    expect(heldMessage(held.held)).toBe('heldLength');
    expect(heldMessage([{ rule: { key: 'sentence' } }])).toBe('heldAll');
  });

  it('tells a Fix run of a page over its Length it doesn’t send (editor test 2026-10-26)', () => {
    const rules = activeRules(ruleSet('blog_post'), {
      overrides: { length: { value: '1000' } },
    });
    const statuses = (characters: number) =>
      rules.map((r) => ({
        rule: r,
        status: checkRule(r, page('<h1>T</h1><p>x</p>', characters), ctx),
      }));
    const over = statuses(1_500);
    const { forAgent, held } = openRulesForAgent(over, undefined, new Set(['length']));
    expect(held.map(({ rule }) => rule.key)).toEqual(['length']);
    expect(overLengthFor(over, forAgent)).toEqual({ count: 1_500, max: 1_200 });
    // Sent as a rule, it says so itself; within its Length, or short: nothing.
    expect(overLengthFor(over, openRulesForAgent(over).forAgent)).toBeUndefined();
    // Asked for some rules only, Length not among them; a hand-off, which sends none.
    expect(overLengthFor(over, openRulesForAgent(over, ['faq']).forAgent)).toEqual({
      count: 1_500,
      max: 1_200,
    });
    expect(overLengthFor(over, [])).toEqual({ count: 1_500, max: 1_200 });
    expect(overLengthFor(statuses(1_150), forAgent)).toBeUndefined();
    expect(overLengthFor(statuses(200), forAgent)).toBeUndefined();
    // A Length of 0 reads every page as long, at most 0: nothing said.
    const zero = activeRules(ruleSet('blog_post'), { overrides: { length: { value: '0' } } }).map(
      (r) => ({ rule: r, status: checkRule(r, page('<h1>T</h1><p>x</p>', 1_500), ctx) }),
    );
    expect(overLengthFor(zero, [])).toBeUndefined();
    // Length off.
    const off = activeRules(ruleSet('blog_post'), { overrides: { length: { on: false } } }).map(
      (r) => ({ rule: r, status: checkRule(r, page('<h1>T</h1><p>x</p>', 1_500), ctx) }),
    );
    expect(overLengthFor(off, [])).toBeUndefined();
  });

  it('reads a rule met without the locked passages as held by them', () => {
    const sentence = activeRules(ruleSet('blog_post'), {
      overrides: { sentence: { value: '20' } },
    }).find((r) => r.key === 'sentence')!;
    const long = 'A sentence that runs well past twenty characters.';
    const all = page(`<h1>T</h1><p>${long}</p><p>Short.</p>`, 60);
    expect(checkRule(sentence, all, NO_RULE_CONTEXT).state).toBe('bad');
    const rest = page('<h1>T</h1><p>Short.</p>', 10);
    expect(checkRule(sentence, rest, NO_RULE_CONTEXT).state).toBe('ok');
  });

  it('wants a short summary under the H1, and a short answer under each H2', () => {
    expect(check('summary', '<h1>T</h1><h2>A</h2>')).toEqual({ state: 'bad', code: 'missing' });
    expect(check('summary', `<h1>T</h1><p>${'word '.repeat(60)}</p>`)).toEqual({
      state: 'bad',
      code: 'words',
      count: 60,
    });
    expect(check('summary', '<h1>T</h1><p>A short answer.</p><h2>A</h2>')).toEqual({ state: 'ok' });

    expect(check('h2Answer', '<h1>T</h1><p>x</p>')).toEqual({ state: 'bad', code: 'noH2' });
    expect(
      check('h2Answer', `<h2>A</h2><p>Short.</p><h2>B</h2><table><tr><td>x</td></tr></table>`),
    ).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 2,
    });
  });
});

describe('fan-outs and keywords', () => {
  it('counts the top fan-outs used as H2s', () => {
    expect(
      check(
        'fanoutH2',
        '<h2>Best espresso machines under $500</h2><h2>Home espresso grinders</h2>',
        '2',
      ),
    ).toEqual({ state: 'ok' });
    // It names the ones still to use, so the agent writes those.
    expect(check('fanoutH2', '<h2>Best espresso machines under $500</h2>')).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 3,
      missing: ['home espresso grinder', 'espresso machine reviews 2026'],
    });
    expect(checkRule(rule('fanoutH2'), page('<h2>x</h2>'), { ...ctx, fanouts: [] })).toEqual({
      state: 'info',
      code: 'noFanouts',
    });
  });

  it('finds the FAQ and its questions, and the fan-outs they use', () => {
    const faq =
      '<h2>FAQ</h2><h3>Which home espresso grinder should I buy?</h3><p>The Baratza.</p>' +
      '<h3>Is it loud?</h3><p>A bit.</p><h2>Next</h2><p>Is this counted?</p>';
    expect(check('faq', faq)).toEqual({ state: 'bad', code: 'partOf', count: 2, of: 5 });
    expect(check('faq', faq, '2')).toEqual({ state: 'ok' });
    expect(check('faq', '<h2>Questions</h2>')).toEqual({ state: 'bad', code: 'missing' });
    expect(check('fanoutFaq', faq)).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 3,
      missing: ['best espresso machine under 500', 'espresso machine reviews 2026'],
    });
    // Fewer fan-outs than questions asked: using each one meets it, and the
    // one still needed is named.
    const two = { ...ctx, fanouts: ['home espresso grinder', 'espresso machine reviews 2026'] };
    expect(checkRule(rule('fanoutFaq'), page(faq), two)).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 2,
      missing: ['espresso machine reviews 2026'],
    });
    const both =
      '<h2>FAQ</h2><h3>Which home espresso grinder should I buy?</h3><p>The Baratza.</p>' +
      '<h3>Where are the espresso machine reviews of 2026?</h3><p>Here.</p>';
    expect(checkRule(rule('fanoutFaq'), page(both), two)).toEqual({ state: 'ok' });
    // Different fan-outs count, not questions: two asking the same one are one.
    const same =
      '<h2>FAQ</h2><h3>Which home espresso grinder should I buy?</h3><p>The Baratza.</p>' +
      '<h3>Is a home espresso grinder worth it?</h3><p>Yes.</p>';
    expect(checkRule(rule('fanoutFaq'), page(same), two)).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 2,
      missing: ['espresso machine reviews 2026'],
    });
    // One question that uses two of them counts both.
    const one =
      '<h2>FAQ</h2><h3>Which home espresso grinder do the espresso machine reviews 2026 pick?</h3><p>The Baratza.</p>';
    expect(checkRule(rule('fanoutFaq'), page(one), two)).toEqual({ state: 'ok' });
    // No FAQ yet: still the fan-outs its questions should use.
    expect(check('fanoutFaq', '<p>x</p>')).toEqual({
      state: 'bad',
      code: 'needsFaq',
      missing: [
        'best espresso machine under 500',
        'home espresso grinder',
        'espresso machine reviews 2026',
      ],
    });
  });

  it('quotes the fan-outs still to use for the agent, as many as fit', () => {
    const status = check('fanoutH2', '<h2>x</h2>');
    expect(fanoutsToUse(status)).toBe(
      '"best espresso machine under 500"; "home espresso grinder"; "espresso machine reviews 2026"',
    );
    expect(fanoutsToUse(status, 40)).toBe('"best espresso machine under 500"');
    // One that doesn't fit doesn't stop a shorter one after it.
    expect(fanoutsToUse(status, 60)).toBe(
      '"best espresso machine under 500"; "home espresso grinder"',
    );
    expect(fanoutsToUse({ state: 'ok' })).toBeNull();
  });

  it('counts the keywords on the page', () => {
    expect(check('keywords', '<p>A pipeline forecast.</p>', 'pipeline forecast, accuracy')).toEqual(
      {
        state: 'bad',
        code: 'partOf',
        count: 1,
        of: 2,
      },
    );
    expect(check('keywords', '<p>x</p>')).toEqual({ state: 'info', code: 'addKeywords' });
  });
});

describe('links and sources', () => {
  const html =
    '<p>See <a href="/guides/milk">milk</a>, <a href="https://www.acme.example/beans">beans</a> and ' +
    '<a href="#top">top</a>.</p>' +
    '<p>Per <a href="https://www.nist.gov/coffee">NIST</a> and <a href="https://crema.example/x">Crema</a>.</p>';

  it('counts internal links, and outbound ones that aren’t a competitor’s', () => {
    expect(check('internalLinks', html, '2')).toEqual({ state: 'ok' });
    expect(check('outboundLinks', html)).toEqual({ state: 'bad', code: 'partOf', count: 1, of: 2 });
    expect(check('citeInline', html)).toEqual({ state: 'ok' });
    expect(check('citeInline', '<p><a href="https://crema.example/x">x</a></p>')).toEqual({
      state: 'bad',
      code: 'missing',
    });
  });

  it('wants a dated data point in the first 100 words', () => {
    expect(check('datedPoint', '<p>In 2026, 62% of buyers asked AI first.</p>')).toEqual({
      state: 'ok',
    });
    expect(check('datedPoint', `<p>${'word '.repeat(120)}In 2026.</p>`)).toEqual({
      state: 'bad',
      code: 'missing',
    });
  });
});

describe('shopping path rules (shopping path, part 6)', () => {
  const item = (n: number, title: string, state: ShoppingLinkState, inPath = true) => ({
    key: `shop.example/products/p${n}`,
    title,
    state,
    inPath,
  });
  const shopping: ShoppingCheck = {
    categories: ['shop.example/collections/hiking-boots'],
    products: [
      item(1, 'Summit', 'ok'),
      item(2, 'Trail', 'sold_out'),
      item(3, 'Ridge', 'ok'),
      item(4, 'Alpine', 'ok'),
    ],
    site: 'https://shop.example/blog/boots',
    merchantCenter: true,
  };
  const shopRule = (key: string, value?: string) => {
    const found = activeRules(
      ruleSet('buying_guide', { shopping: true }),
      value === undefined ? NO_DRAFT_RULES : { overrides: { [key]: { value } } },
    ).find((r) => r.key === key);
    if (!found) throw new Error(`no rule ${key}`);
    return found;
  };
  const grid = (hrefs: string[]) =>
    htmlBlockElement(hrefs.map((h) => `<a class="getcito-product" href="${h}">x</a>`).join(''));
  const html =
    '<h1>Boots</h1><p>Our <a href="https://shop.example/collections/hiking-boots/">hiking boots</a>.</p>' +
    '<p>The <a href="https://www.shop.example/products/p1?utm_source=x">Summit</a>.</p>' +
    grid(['https://shop.example/products/p2', 'https://shop.example/products/p3']);
  const status = (
    key: string,
    read = page(html),
    with_: RuleContext['shopping'] = shopping,
    value?: string,
  ) => checkRule(shopRule(key, value), read, { ...ctx, shopping: with_ });

  it('come only on an online shop’s page that takes a shopping path', () => {
    const keys = (pageType: Parameters<typeof ruleSet>[0], on: boolean) =>
      ruleSet(pageType, { shopping: on })
        .map((r) => r.key)
        .filter((k) => SHOPPING_RULE_KEYS.has(k));
    expect(keys('buying_guide', true)).toEqual([
      'shopCategoryLink',
      'shopProductLinks',
      'shopLinksLive',
    ]);
    expect(keys('buying_guide', false)).toEqual([]);
    expect(keys('product_page', true)).toEqual([]);
    expect(NOT_FOR_AGENT.has('shopLinksLive')).toBe(true);
  });

  it('read every link on the page: the text’s, a heading’s, a table’s and a product grid’s, each once', () => {
    const read = page(
      '<h2><a href="https://shop.example/products/p4">Alpine</a></h2>' +
        '<table><tr><td><a href="https://shop.example/products/p3">Ridge</a></td></tr></table>' +
        '<ul><li><a href="https://shop.example/products/p1">Summit</a></li></ul>' +
        grid(['https://shop.example/products/p1', 'https://shop.example/products/p2']),
    );
    expect(read.links).toEqual([
      'https://shop.example/products/p4',
      'https://shop.example/products/p3',
      'https://shop.example/products/p1',
      'https://shop.example/products/p2',
    ]);
    expect(status('shopProductLinks', read)).toEqual({ state: 'ok' });
    expect(status('shopCategoryLink')).toEqual({ state: 'ok' });
  });

  it('read the product cards with the price each shows, from the editor’s own markup (#1610)', () => {
    const block = productBlockHtml([
      { title: 'Summit', url: 'https://shop.example/products/p1', image: null, price: '$189.00' },
      { title: 'Trail', url: 'https://shop.example/products/p2', image: null, price: null },
    ]);
    const read = page(`<p>Intro</p>${htmlBlockElement(block)}`);
    expect(read.cards).toEqual([
      { href: 'https://shop.example/products/p1', price: '$189.00' },
      { href: 'https://shop.example/products/p2', price: null },
    ]);
    // A link in the text is no card.
    expect(page('<p><a href="https://shop.example/products/p1">Summit</a></p>').cards).toEqual([]);
  });

  it('count only the products that sell towards the number, and name the ones that don’t', () => {
    // Summit and Ridge sell; Trail, in the grid, is sold out: 2 of 3.
    expect(status('shopProductLinks')).toEqual({ state: 'bad', code: 'partOf', count: 2, of: 3 });
    expect(status('shopLinksLive')).toEqual({
      state: 'bad',
      code: 'found',
      count: 1,
      items: [{ title: 'Trail', state: 'sold_out' }],
    });
    // A path of three, one sold out: both rules can be met, by the two that sell.
    const three = { ...shopping, products: shopping.products.slice(0, 3) };
    const two = page(
      '<p><a href="https://shop.example/products/p1">a</a> <a href="https://shop.example/products/p3">b</a></p>',
    );
    expect(status('shopProductLinks', two, three)).toEqual({ state: 'ok' });
    expect(status('shopLinksLive', two, three)).toEqual({ state: 'ok' });
  });

  it('find a link to a product removed from the path that no longer sells', () => {
    const removed = {
      ...shopping,
      products: [...shopping.products, item(9, 'Canyon', 'gone', false)],
    };
    const read = page('<p><a href="/products/p9">Canyon</a></p>');
    expect(status('shopLinksLive', read, removed)).toEqual({
      state: 'bad',
      code: 'found',
      count: 1,
      items: [{ title: 'Canyon', state: 'gone' }],
    });
    // Not one of the path's: it never counts towards the products linked.
    expect(status('shopProductLinks', read, removed, '1')).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 0,
      of: 1,
    });
  });

  it('want the category page, three products or all of a smaller path, none sold out', () => {
    const bare = page('<p>Nothing linked.</p>');
    expect(status('shopCategoryLink', bare)).toEqual({ state: 'bad', code: 'missing' });
    expect(status('shopProductLinks', bare)).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 0,
      of: 3,
    });
    expect(
      status('shopProductLinks', bare, { ...shopping, products: shopping.products.slice(0, 2) }),
    ).toEqual({ state: 'bad', code: 'partOf', count: 0, of: 1 });
    expect(status('shopLinksLive', bare)).toEqual({ state: 'ok' });
  });

  it('wait for the path, say when there is none, and when it can’t be read', () => {
    expect(status('shopProductLinks', page(html), 'reading')).toEqual({
      state: 'info',
      code: 'shoppingReading',
    });
    expect(status('shopLinksLive', page(html), 'failed')).toEqual({
      state: 'info',
      code: 'shoppingFailed',
    });
    expect(status('shopLinksLive', page(html), null)).toEqual({
      state: 'info',
      code: 'noShoppingPath',
    });
    expect(status('shopCategoryLink', page(html), { ...shopping, categories: [] })).toEqual({
      state: 'info',
      code: 'noShoppingPath',
    });
    // Every product sold out: none to link, pick again in Brief.
    const soldOut = { ...shopping, products: [item(2, 'Trail', 'sold_out')] };
    expect(status('shopProductLinks', page(html), soldOut)).toEqual({
      state: 'info',
      code: 'noShoppingPath',
    });
  });

  it('says what to do instead when only a sold-out link is open, and both when the feed’s is too', () => {
    expect(notForAgentMessage([{ rule: { key: 'shopLinksLive' } }])).toBe('notForAgentShopping');
    expect(
      notForAgentMessage([{ rule: { key: 'shopLinksLive' } }, { rule: { key: 'feedMatch' } }]),
    ).toBe('notForAgentFeedShopping');
    expect(
      notForAgentMessage([{ rule: { key: 'shopLinksLive' } }, { rule: { key: 'oneH1' } }]),
    ).toBe('notForAgent');
  });

  it('has a message in the editor for each of its answers', () => {
    const answers = [
      [{ rule: { key: 'oneH1' } }],
      [{ rule: { key: 'feedMatch' } }],
      [{ rule: { key: 'shopLinksLive' } }],
      [{ rule: { key: 'feedMatch' } }, { rule: { key: 'shopLinksLive' } }],
    ].map(notForAgentMessage);
    expect(new Set(answers).size).toBe(4);
    const suggestions: Record<string, unknown> = messages.contentEditor.editor.suggestions;
    for (const key of answers) expect(suggestions[key]).toEqual(expect.any(String));
  });
});

describe('style', () => {
  it('finds AI traces and banned words', () => {
    expect(check('aiTraces', '<p>Let’s delve in. It is important to note this.</p>')).toEqual({
      state: 'bad',
      code: 'found',
      count: 2,
    });
    expect(check('aiTraces', '<p>Plain words.</p>')).toEqual({ state: 'ok' });
    expect(check('bannedWords', '<p>A seamless, robust tool. Leverage it.</p>')).toEqual({
      state: 'bad',
      code: 'found',
      count: 3,
    });
    expect(check('bannedWords', '<p>Seamlessly done.</p>')).toEqual({ state: 'ok' });
  });

  it('leaves tone and language to AI', () => {
    expect(check('tone', '<p>x</p>')).toEqual({ state: 'info', code: 'aiCheck' });
    expect(check('language', '<p>x</p>')).toEqual({ state: 'info', code: 'aiCheck' });
  });
});

describe('page type rules', () => {
  it('checks a feature page', () => {
    expect(check('comparisonTable', '<table><tr><td>x</td></tr></table>')).toEqual({ state: 'ok' });
    expect(check('comparisonTable', '<p>x</p>')).toEqual({ state: 'bad', code: 'missing' });
    expect(check('whoFor', '<p>x</p>')).toEqual({ state: 'bad', code: 'notSet' });
    expect(check('whoFor', '<p>x</p>', 'Sales leaders')).toEqual({
      state: 'info',
      code: 'aiCheck',
    });
    expect(
      check(
        'proofPerSection',
        '<h2>A</h2><p>Used by 400 teams.</p><h2>B</h2><blockquote><p>Love it</p></blockquote><h2>C</h2><p>x</p>',
      ),
    ).toEqual({ state: 'bad', code: 'partOf', count: 2, of: 3 });
  });

  it('checks a solution page’s steps', () => {
    expect(
      check('useCaseSteps', '<ol><li>a</li><li>b</li><li>c</li></ol>', undefined, 'solution_page'),
    ).toEqual({
      state: 'ok',
    });
    expect(check('useCaseSteps', '<ol><li>a</li></ol>', undefined, 'solution_page')).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 3,
    });
  });

  it('checks a product page against its product in the feed, once one is connected (CE-053)', () => {
    const feed = (html: string, catalog: RuleContext['catalog']) =>
      checkRule(rule('feedMatch', 'product_page'), page(html), { ...ctx, catalog });
    const product = (price: number, availability = 'in_stock') => ({
      connected: true,
      product: {
        title: 'Ridge 28',
        url: 'https://acme.example/products/ridge-28',
        via: 'url' as const,
        variants: [{ price, salePrice: null, currency: 'USD', availability, gtin: null }],
      },
    });
    const html = '<p>The Ridge 28 costs $129.</p><p>In stock.</p>';
    expect(feed(html, null)).toEqual({ state: 'info', code: 'needsFeed' });
    expect(feed(html, 'reading')).toEqual({ state: 'info', code: 'feedReading' });
    expect(feed(html, { connected: false, product: null })).toEqual({
      state: 'info',
      code: 'needsFeed',
    });
    expect(feed(html, { connected: true, product: null })).toEqual({
      state: 'info',
      code: 'notInFeed',
    });
    expect(feed('<p>A daypack.</p>', product(129))).toEqual({ state: 'info', code: 'feedNothing' });
    expect(feed(html, product(129))).toEqual({ state: 'ok' });
    expect(feed(html, product(119, 'out_of_stock'))).toEqual({
      state: 'bad',
      code: 'feedDiffers',
      count: 2,
    });
    // The person checks which is right, the page or the feed: not the agent's,
    // and the message says so (the extra H1s' first, when both are open).
    expect(NOT_FOR_AGENT.has('feedMatch')).toBe(true);
    expect(notForAgentMessage([{ rule: { key: 'feedMatch' } }])).toBe('notForAgentFeed');
    expect(notForAgentMessage([{ rule: { key: 'feedMatch' } }, { rule: { key: 'oneH1' } }])).toBe(
      'notForAgent',
    );
  });

  it('checks a product and a category page', () => {
    expect(check('feedMatch', '<p>x</p>', undefined, 'product_page')).toEqual({
      state: 'info',
      code: 'needsFeed',
    });
    expect(
      check(
        'fitQuestions',
        '<h3>Does it fit wide feet?</h3><p>Which size should I order?</p>',
        '2',
        'product_page',
      ),
    ).toEqual({ state: 'ok' });
    expect(
      check(
        'introText',
        `<h1>Shoes</h1><p>${'word '.repeat(40)}</p><h2>All</h2>`,
        undefined,
        'category_page',
      ),
    ).toEqual({ state: 'bad', code: 'current', count: 40 });
  });

  it('asks a product with sizes for fit questions, and one without none (#1494 review)', () => {
    const sized = '<table><tr><th>Sizes</th><td>XS–XL</td></tr></table>';
    expect(check('fitQuestions', sized, '3', 'product_page')).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 0,
      of: 3,
    });
    expect(
      check('fitQuestions', '<p>A burr grinder for espresso.</p>', '3', 'product_page'),
    ).toEqual({ state: 'info', code: 'noSizes' });
  });

  it('reads a buying FAQ under its heading in the page’s language (#1494 review)', () => {
    const faq = (heading: string, language: string) =>
      checkRule(
        rule('buyingFaq', 'category_page', '2'),
        page(`<h2>${heading}</h2><h3>Q1?</h3><p>A.</p><h3>Q2?</h3><p>B.</p>`),
        { ...ctx, language },
      );
    for (const [heading, language] of [
      ['Häufig gestellte Fragen', 'de'],
      ['Questions fréquentes', 'fr'],
      ['Preguntas frecuentes', 'es'],
      ['SIKÇA SORULAN SORULAR', 'tr'],
    ]) {
      expect(faq(heading, language)).toEqual({ state: 'ok' });
    }
    // A language whose heading isn't read: its FAQ isn't said to be missing.
    expect(faq('Vanliga frågor', 'sv')).toEqual({ state: 'info', code: 'englishOnly' });
    expect(faq('Materials', 'en')).toEqual({ state: 'bad', code: 'missing' });
  });

  it('checks a destination page’s summary', () => {
    expect(
      check(
        'bestTime',
        '<h1>Lisbon</h1><p>The best time to visit is May.</p>',
        undefined,
        'destination_page',
      ),
    ).toEqual({ state: 'ok' });
  });
});

describe('the formats www.getcito.com offers', () => {
  it('gives each new page type its own rules and length', () => {
    const own = (type: Parameters<typeof ruleSet>[0]) =>
      ruleSet(type)
        .filter((r) => r.group === 'type')
        .map((r) => r.key);
    expect(own('guide')).toEqual(['howToSteps']);
    expect(own('definition')).toEqual(['definitionFirst', 'examplesSection']);
    expect(own('alternatives')).toEqual(['sideBySide', 'fairness']);
    expect(own('collection_page')).toEqual(['introText', 'buyingFaq']);
    expect(own('sizing_guide')).toEqual(['sizeChart', 'measureSteps', 'fitQuestions']);
    const length = (type: Parameters<typeof ruleSet>[0]) =>
      ruleSet(type).find((r) => r.key === 'length')?.value;
    expect([length('definition'), length('sizing_guide'), length('collection_page')]).toEqual([
      '1500',
      '1000',
      '800',
    ]);
  });

  it('checks a definition in the first sentence, short, and an examples section', () => {
    const define = (html: string) => check('definitionFirst', html, undefined, 'definition');
    expect(define('<h1>Cold brew</h1><p>Cold brew is coffee steeped in cold water.</p>')).toEqual({
      state: 'ok',
    });
    expect(define('<h1>Cold brew</h1><p>Many people love it in summer.</p>')).toEqual({
      state: 'bad',
      code: 'missing',
    });
    // "is" somewhere in the paragraph isn't a definition: a pronoun's, or past the first words.
    expect(define('<h1>Cold brew</h1><p>Many people say it is great.</p>')).toEqual({
      state: 'bad',
      code: 'missing',
    });
    expect(
      define(
        '<h1>Cold brew</h1><p>On hot summer days in the city many cafés sell what is cold brew.</p>',
      ),
    ).toEqual({ state: 'bad', code: 'missing' });
    expect(
      define('<h1>Cold brew</h1><p>Cold brew. Summer drinkers say it is the best way.</p>'),
    ).toEqual({ state: 'bad', code: 'missing' });
    expect(
      define('<h1>CRM</h1><p>Customer relationship management (CRM) refers to tools that…</p>'),
    ).toEqual({ state: 'ok' });
    // Punctuation beside the verb doesn't hide it.
    expect(define('<h1>Cold brew</h1><p>Cold brew is, simply, coffee steeped cold.</p>')).toEqual({
      state: 'ok',
    });
    // Fit questions too: a Turkish product page isn't scored on English words (CE-052).
    expect(
      checkRule(
        rule('fitQuestions', 'product_page'),
        page('<h1>Yürüyüş çantası</h1><h2>Hangi beden bana uyar?</h2><p>Ölçü tablosuna bakın.</p>'),
        { ...ctx, language: 'tr' },
      ),
    ).toEqual({ state: 'info', code: 'englishOnly' });
    // Read in English words only: another language's page isn't counted.
    expect(
      checkRule(
        rule('definitionFirst', 'definition'),
        page('<h1>Soğuk demleme</h1><p>Soğuk demleme, soğuk suyla demlenen kahvedir.</p>'),
        { ...ctx, language: 'tr' },
      ),
    ).toEqual({ state: 'info', code: 'englishOnly' });
    expect(
      checkRule(
        rule('definitionFirst', 'definition'),
        page('<h1>Cold brew</h1><p>Cold brew is coffee steeped in cold water.</p>'),
        { ...ctx, language: 'en' },
      ),
    ).toEqual({ state: 'ok' });
    expect(define(`<h1>Cold brew</h1><p>Cold brew is ${'very '.repeat(60)}cold.</p>`)).toEqual({
      state: 'bad',
      code: 'words',
      count: 64,
    });
    expect(
      check('examplesSection', '<h2>Examples of cold brew</h2>', undefined, 'definition'),
    ).toEqual({ state: 'ok' });
  });

  it('checks a how-to guide’s and a sizing guide’s steps, and a size chart', () => {
    const steps = '<ol><li>a</li><li>b</li><li>c</li></ol>';
    expect(
      check('howToSteps', `<h1>How to make cold brew</h1>${steps}`, undefined, 'guide'),
    ).toEqual({ state: 'ok' });
    expect(
      check(
        'howToSteps',
        '<h1>Cold brew in 5 easy steps</h1><ol><li>a</li></ol>',
        undefined,
        'guide',
      ),
    ).toEqual({ state: 'bad', code: 'partOf', count: 1, of: 3 });
    // A guide that isn't a how-to has no steps to count.
    expect(
      check('howToSteps', '<h1>The Azores in winter</h1><p>Mild.</p>', undefined, 'guide'),
    ).toEqual({ state: 'info', code: 'notHowTo' });
    expect(check('measureSteps', '<ol><li>a</li></ol>', undefined, 'sizing_guide')).toEqual({
      state: 'bad',
      code: 'partOf',
      count: 1,
      of: 3,
    });
    expect(
      check('sizeChart', '<table><tr><td>M</td></tr></table>', undefined, 'sizing_guide'),
    ).toEqual({ state: 'ok' });
    expect(check('sizeChart', '<p>M fits most</p>', undefined, 'sizing_guide')).toEqual({
      state: 'bad',
      code: 'missing',
    });
  });
});

describe('rulesMet', () => {
  it('counts the rules on that the page can say', () => {
    const rules = activeRules(ruleSet('blog_post'), {
      overrides: { sentence: { on: false } },
    });
    const p = page('<h1>T</h1><p>Short summary.</p>', 10);
    const statuses = rules.map((r) => ({ rule: r, status: checkRule(r, p, ctx) }));
    const { met, total } = rulesMet(statuses);
    // 17 shared rules: sentence off; tone, language and keywords (none set) can't say.
    expect(total).toBe(13);
    expect(met).toBeGreaterThan(0);
    expect(met).toBeLessThan(total);
  });
});

describe('lengthWarns', () => {
  const statuses = (html: string, characters: number, on = true, value?: string) =>
    activeRules(ruleSet('blog_post'), {
      overrides: { length: { on, ...(value ? { value } : {}) } },
    }).map((r) => ({ rule: r, status: checkRule(r, page(html, characters), ctx) }));

  it('warns exactly when the Length rule reads short or long, as the Rules tab does', () => {
    // A 3,000 target passes 2,400–3,600: a page a little over it is fine.
    expect(lengthWarns(statuses('<h1>T</h1>', 3_300, true, '3000'))).toBe(false);
    expect(lengthWarns(statuses('<h1>T</h1>', 2_000, true, '3000'))).toBe(true);
    expect(lengthWarns(statuses('<h1>T</h1>', 3_700, true, '3000'))).toBe(true);
  });

  it('stays quiet with the Length rule off, even on an empty page', () => {
    expect(lengthWarns(statuses('', 0, false))).toBe(false);
  });
});

describe('lengthConflict', () => {
  const statuses = (
    overrides: Record<string, { on?: boolean; value?: string }>,
    fanouts = ctx.fanouts,
  ) =>
    activeRules(ruleSet('blog_post'), { overrides }).map((r) => ({
      rule: r,
      status: checkRule(r, page('<h1>T</h1>', 100), { ...ctx, fanouts }),
    }));

  it('says when the sections, questions and summary asked for can’t fit in Length (C)', () => {
    // 3 fan-out H2s (of 4 asked, 3 there are) × 200 + 5 FAQ questions × 150 + a summary, 100.
    expect(lengthConflict(statuses({ length: { value: '1000' } }), 3)).toEqual({
      need: 1_450,
      max: 1_200,
    });
    expect(lengthConflict(statuses({ length: { value: '1500' } }), 3)).toBeNull();
    expect(lengthConflict(statuses({}), 3)).toBeNull();
  });

  it('counts only the rules on and still open, and asks nothing of fan-outs there aren’t', () => {
    // FAQ off: the 3 fan-out questions still need a FAQ.
    expect(
      lengthConflict(statuses({ length: { value: '800' }, faq: { on: false } }), 3)?.need,
    ).toBe(600 + 450 + 100);
    // Two fan-outs: two fan-out H2s and two fan-out questions at most.
    expect(
      lengthConflict(
        statuses({ length: { value: '500' }, faq: { on: false } }, ctx.fanouts.slice(0, 2)),
        2,
      )?.need,
    ).toBe(400 + 300 + 100);
    // No fan-outs: no fan-out H2s or fan-out questions to fit.
    expect(lengthConflict(statuses({ length: { value: '600' } }, []), 0)?.need).toBe(750 + 100);
    expect(
      lengthConflict(statuses({ length: { value: '50' }, faq: { on: false } }, []), 0)?.need,
    ).toBe(100);
    // Length off asks for no length.
    expect(lengthConflict(statuses({ length: { on: false, value: '500' } }), 3)).toBeNull();
    // A page that meets them all shows they fit.
    const met = statuses({ length: { value: '1000' } }).map((s) =>
      ['fanoutH2', 'faq', 'fanoutFaq', 'summary'].includes(s.rule.key)
        ? { ...s, status: { state: 'ok' as const } }
        : s,
    );
    expect(lengthConflict(met, 3)).toBeNull();
  });
});

describe('rewriteAdvice', () => {
  const statuses = (
    length: number | null,
    open: string[] = [],
    lengthValue = '8000',
  ): { rule: ActiveRule; status: RuleStatus }[] =>
    activeRules(ruleSet('blog_post'), { overrides: { length: { value: lengthValue } } }).map(
      (rule) => {
        if (rule.key === 'length' && length !== null) {
          const band = lengthBand(Number(rule.current));
          const ok = length >= band.min && length <= band.max;
          return {
            rule,
            status: ok
              ? { state: 'ok' as const }
              : {
                  state: 'bad' as const,
                  code: length > band.max ? ('long' as const) : ('short' as const),
                  count: length,
                  min: band.min,
                  max: band.max,
                },
          };
        }
        return {
          rule,
          status: open.includes(rule.key)
            ? { state: 'bad' as const, code: 'missing' as const }
            : { state: 'ok' as const },
        };
      },
    );

  it('recommends a rewrite for a page more than 30% off its Length', () => {
    // The user's page: 19,203 characters for 8,000.
    expect(rewriteAdvice(statuses(19_203))).toEqual({
      reason: 'length',
      count: 19_203,
      target: 8_000,
      percent: 140,
    });
    // 30% off, no more, is for small edits.
    expect(rewriteAdvice(statuses(10_400))).toBeNull();
    // An empty page has nothing to rewrite; one past 60,000 can't be sent whole.
    expect(rewriteAdvice(statuses(0, ['faq', 'summary', 'h2Answer', 'keywords']))).toBeNull();
    expect(rewriteAdvice(statuses(60_001))).toBeNull();
  });

  it("doesn't recommend shortening a page a rewrite can't bring under its Length", () => {
    const page = statuses(6_877, [], '4000');
    // The least a rewrite comes to (kept + headings + least answers) past the band's top (4,800).
    const floor = { kept: 3_799, floor: 5_100, last: null };
    expect(rewriteAdvice(page, floor)).toBeNull();
    expect(lengthOutOfReach(page, floor)).toEqual({
      count: 6_877,
      target: 4_000,
      kept: 3_799,
      why: 'floor',
      least: 5_100,
      suggested: 5_500,
    });
    // Little kept: a rewrite still gets there.
    expect(rewriteAdvice(page, { kept: 1_000, floor: 1_800, last: null })).toMatchObject({
      reason: 'length',
    });
    // Many rules open: still a rewrite, for them, the Length out of reach not among them.
    expect(
      rewriteAdvice(statuses(6_877, ['faq', 'summary', 'h2Answer'], '4000'), floor),
    ).toBeNull();
    expect(
      rewriteAdvice(statuses(6_877, ['faq', 'summary', 'h2Answer', 'keywords'], '4000'), floor),
    ).toMatchObject({ reason: 'open' });
    // Under its Length, what is kept doesn't stop it.
    expect(lengthOutOfReach(statuses(2_000, [], '4000'), floor)).toBeNull();
  });

  it('doesn’t offer a rewrite again for a Length the last one missed, and only then', () => {
    const page = statuses(6_877, [], '4000');
    // The user's test page (2026-10-25): 78% kept, so in reach by its kept blocks
    // alone, but the last rewrite, written to 4,000, came to 5,468.
    const missed = { chars: 5_468, target: 4_000, kept: 3_125 };
    const run = { kept: 3_125, floor: 4_300, last: missed };
    expect(rewriteAdvice(page, run)).toBeNull();
    expect(lengthOutOfReach(page, run)).toMatchObject({
      why: 'reached',
      least: 5_468,
      suggested: 5_500,
    });
    // Asked for a little less since (within its band): it didn't reach the longer one either.
    expect(lengthOutOfReach(statuses(6_877, [], '3500'), run)).toMatchObject({ why: 'reached' });
    // Asked for much less: what it came to for 4,000 says nothing; the estimate decides.
    expect(lengthOutOfReach(statuses(6_877, [], '3000'), run)).toMatchObject({
      why: 'floor',
      least: 4_300,
    });
    // A near miss of 10,000 says nothing of 3,000 either.
    const near = { ...run, floor: 1_800, last: { chars: 12_400, target: 10_000, kept: 3_125 } };
    expect(lengthOutOfReach(statuses(6_877, [], '3000'), near)).toBeNull();
    // A rewrite that met a longer Length says nothing of a shorter one.
    const met = { ...run, last: { chars: 9_800, target: 10_000, kept: 3_125 } };
    expect(lengthOutOfReach(page, met)).toBeNull();
    expect(rewriteAdvice(page, { ...met, kept: 1_000, floor: 1_800 })).toMatchObject({
      reason: 'length',
    });
    // Written with Length off: it was asked for none.
    expect(lengthOutOfReach(page, { ...run, last: { ...missed, target: null } })).toBeNull();
    // A passage unlocked since: a rewrite may go shorter now.
    expect(lengthOutOfReach(page, { ...run, kept: 2_900 })).toBeNull();
    // More locked since: what it came to then doesn't say it gets there now.
    expect(
      lengthOutOfReach(page, {
        kept: 4_500,
        floor: 5_200,
        last: { chars: 4_500, target: 4_000, kept: 1_000 },
      }),
    ).toMatchObject({ why: 'floor', least: 5_200 });
    // The last one got within the band: in reach, whatever the estimate says.
    expect(
      lengthOutOfReach(page, { ...run, floor: 5_000, last: { ...missed, chars: 4_700 } }),
    ).toBeNull();
    // Past both: the more of the two, so one Raise is enough.
    expect(lengthOutOfReach(page, { ...run, floor: 6_200 })).toMatchObject({
      why: 'floor',
      least: 6_200,
      suggested: 6_500,
    });
    // Never a Length past the page as it is.
    expect(lengthOutOfReach(statuses(4_900, [], '4000'), { ...run, floor: 5_100 })?.suggested).toBe(
      5_000,
    );
    // Rewritten with its cited passages too (it kept less): still missing says keeping them misses too…
    const citedToo = { ...run, last: { chars: 5_200, target: 4_000, kept: 0 } };
    expect(lengthOutOfReach(page, citedToo)).toMatchObject({ why: 'reached', least: 5_200 });
    // …but coming within the band doesn't say keeping them does.
    expect(
      lengthOutOfReach(page, {
        ...citedToo,
        floor: 5_000,
        last: { ...citedToo.last, chars: 4_500 },
      }),
    ).toMatchObject({ why: 'floor', least: 5_000 });
  });

  it('rewrites again from a page that took the last rewrite, missed or not (editor test 2026-11-03)', () => {
    // A rewrite for 4,000 came to 5,468 and was accepted: the page is that long now.
    const run = { kept: 3_125, floor: 4_300, last: { chars: 5_468, target: 4_000, kept: 3_125 } };
    expect(lengthOutOfReach(statuses(5_468, [], '4000'), run)).toBeNull();
    // A little edited since, or shorter: still rewritten from there.
    expect(lengthOutOfReach(statuses(5_600, [], '4000'), run)).toBeNull();
    expect(lengthOutOfReach(statuses(5_000, [], '4000'), run)).toBeNull();
    // 30% off or more: a rewrite is recommended again.
    expect(rewriteAdvice(statuses(5_468, [], '4000'), run)).toMatchObject({ reason: 'length' });
    // From a page still well past what it came to (it was rejected): another won't get further.
    expect(lengthOutOfReach(statuses(5_800, [], '4000'), run)).toMatchObject({ why: 'reached' });
    // The estimate still holds a page whose kept blocks and headings are past the Length.
    expect(lengthOutOfReach(statuses(5_468, [], '4000'), { ...run, floor: 5_100 })).toMatchObject({
      why: 'floor',
    });
  });

  it('names what a rewrite keeps as why it missed only when that alone puts the Length out of reach', () => {
    const page = statuses(6_877, [], '4000');
    const missed = { chars: 5_468, target: 4_000, kept: 3_125 };
    // The rewrite missed, but its kept blocks and headings alone fit: not their doing.
    expect(keptOutOfReach(page, { kept: 3_125, floor: 4_300, last: missed })).toBe(false);
    expect(keptOutOfReach(page, { kept: 3_799, floor: 5_100, last: missed })).toBe(true);
  });

  it('recommends it for 4 rules or more the agent can fix', () => {
    // A rule held by what the page keeps isn't one a rewrite fixes.
    expect(
      rewriteAdvice(
        statuses(null, ['faq', 'summary', 'h2Answer', 'sentence']),
        NO_REACH,
        new Set(['sentence']),
      ),
    ).toBeNull();
    expect(rewriteAdvice(statuses(null, ['faq', 'summary', 'h2Answer']))).toBeNull();
    expect(rewriteAdvice(statuses(null, ['faq', 'summary', 'h2Answer', 'keywords']))).toEqual({
      reason: 'open',
      count: 4,
    });
    // A rule it can't fix doesn't count.
    expect(rewriteAdvice(statuses(null, ['faq', 'summary', 'h2Answer', 'oneH1']))).toBeNull();
  });
});

describe('My rules and text rules', () => {
  const mine = {
    overrides: { sentence: { value: '120' } },
    textRules: [{ id: 'm1', text: 'Mention free shipping', on: true }],
  };

  it('starts an untouched draft from the workspace’s My rules', () => {
    expect(effectiveRules(NO_DRAFT_RULES, mine)).toEqual({ set: null, source: 'mine', ...mine });
    expect(effectiveRules(NO_DRAFT_RULES, undefined)).toEqual(NO_DRAFT_RULES);
  });

  it('aims a page brought in to optimize at its own length, over the set’s (F)', () => {
    const imported = { ...NO_DRAFT_RULES, importLength: 18_000 };
    const withLength = {
      ...mine,
      overrides: { ...mine.overrides, length: { on: true, value: '2000' } },
    };
    // My rules apply, but not their length: that's for a new page.
    expect(effectiveRules(imported, withLength).overrides).toEqual({
      sentence: { value: '120' },
      length: { on: true },
    });
    const [length] = activeRules(
      ruleSet('blog_post', { length: imported.importLength }).filter((r) => r.key === 'length'),
      effectiveRules(imported, withLength),
    );
    expect(length.current).toBe('18000');
    // Kept through a save.
    expect(draftRulesSchema.parse(imported).importLength).toBe(18_000);
    // Without one, the type's length, as before.
    expect(ruleSet('blog_post').find((r) => r.key === 'length')!.value).toBe('3000');
  });

  it('keeps the page’s own length when My rules are picked or saved (F)', () => {
    const withLength = { length: { on: true, value: '2000' }, sentence: { value: '120' } };
    // Picked from the set menu: as the untouched draft showed it.
    expect(overridesForImport(withLength, 18_000)).toEqual({
      length: { on: true },
      sentence: { value: '120' },
    });
    expect(overridesForImport(withLength, undefined)).toBe(withLength);
    // Saved as My rules: the workspace's Length value stays…
    const imported = {
      ...NO_DRAFT_RULES,
      overrides: { length: { on: true }, faq: { on: false } },
      importLength: 18_000,
    };
    expect(setToSave(imported, { overrides: withLength, textRules: [] })).toEqual({
      overrides: { length: { on: true, value: '2000' }, faq: { on: false } },
      textRules: [],
    });
    // …a value the person gave is theirs, and a set without one gets none.
    const typed = { ...imported, overrides: { length: { value: '15000' } } };
    expect(setToSave(typed, { overrides: withLength, textRules: [] }).overrides).toEqual({
      length: { value: '15000' },
    });
    expect(setToSave(imported, undefined).overrides).toEqual(imported.overrides);
  });

  it('starts only a page brought in to optimize at its own length (F)', () => {
    expect(pageTextLength('<h1>Pricing</h1><p>Plans &amp; prices</p>')).toBe(22);
    expect(pageTextLength('<p>a<script>x()</script>  b</p><style>p{}</style>')).toBe(3);
    // Tags left open are read in time near the page's size.
    expect(pageTextLength('<p>a</p><script>b')).toBe('a b'.length);
    for (const tag of ['<p', '<script', '<style ', '<', '</div']) {
      const html = `<p>Lead</p>${tag.repeat(Math.ceil(100_000 / tag.length))}`;
      const started = performance.now();
      expect(pageTextLength(html)).toBeGreaterThan(4);
      expect(performance.now() - started).toBeLessThan(2000);
    }
    const page = `<h1>Pricing</h1><p>${'word '.repeat(40)}</p>`;
    expect(startingRules('optimize', page)).toEqual({ ...NO_DRAFT_RULES, importLength: 207 });
    // Within the range the Length rule takes.
    expect(startingRules('optimize', '<p>Short</p>').importLength).toBe(RULE_LENGTH_MIN);
    expect(startingRules('optimize', `<p>${'x'.repeat(60_000)}</p>`).importLength).toBe(
      RULE_LENGTH_MAX,
    );
    expect(startingRules('optimize', undefined)).toBe(NO_DRAFT_RULES);
    expect(startingRules('optimize', '<p> </p>')).toBe(NO_DRAFT_RULES);
    expect(startingRules('create', page)).toBe(NO_DRAFT_RULES);
  });

  it('keeps a draft’s own choices, and a reset draft on the default', () => {
    const own = { ...NO_DRAFT_RULES, overrides: { faq: { on: false } } };
    expect(effectiveRules(own, mine)).toEqual(own);
    const reset = { ...NO_DRAFT_RULES, source: 'default' as const };
    expect(effectiveRules(reset, mine)).toEqual(reset);
  });

  it('reads rules saved before text rules with none', () => {
    expect(draftRulesSchema.parse({ set: 'guide', overrides: {} })).toEqual({
      set: 'guide',
      source: null,
      overrides: {},
      textRules: [],
    });
  });

  it('splits pasted rules into lines, bullets and numbering off', () => {
    expect(
      splitRules('- Mention free shipping\n\n2) Use 3 images\n• Keep it short  \n1. '),
    ).toEqual(['Mention free shipping', 'Use 3 images', 'Keep it short']);
    expect(splitRules('x'.repeat(400))[0]).toHaveLength(300);
  });

  it('checks a rule with a number as a number, the rest by AI', () => {
    expect(textRuleCheck('Use at least 3 images')).toBe('numberCheck');
    expect(textRuleCheck('Mention free shipping')).toBe('aiCheck');
  });
});
