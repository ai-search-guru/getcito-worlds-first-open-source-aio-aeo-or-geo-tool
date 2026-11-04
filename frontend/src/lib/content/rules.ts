import { z } from 'zod';
import { LANGUAGES } from '@/config/promptOptions';
import { classifyDomain, normalizeDomain } from '@/lib/citations/classify';
import { PAGE_TYPES, type DraftMethod, type PageType } from '@/lib/content/drafts';
import { lengthTarget } from '@/lib/content/editor';
import { feedCheck, type CatalogMatch } from '@/lib/content/feedMatch';
import { decodeHtmlBlock } from '@/lib/content/htmlAllowlist';
import { parseHtml } from '@/lib/content/dom';
import { pageOffer } from '@/lib/content/pageSchema';
import { countWords, languageCode } from '@/lib/content/readability';
import { wordsOf } from '@/lib/content/sources';
import {
  shoppingLinks,
  type PageCard,
  type ShoppingCheck,
  type ShoppingLinkState,
} from '@/lib/content/shoppingCheck';
import { PRODUCTS_FOR } from '@/lib/content/shoppingPath';

/**
 * The editor's Rules tab (Content Editor CE-009, spec §10): the rules a page
 * of its type is written to — the type's own, then the shared groups — each
 * on or off, with a value the person can change for the draft, and its
 * status read from the page as written. Rules only AI can judge (tone,
 * fairness…) say so and don't count; the agent (CE-018) checks them.
 */

export const RULE_GROUPS = ['type', 'structure', 'fanouts', 'links', 'style'] as const;
export type RuleGroup = (typeof RULE_GROUPS)[number];

export type RuleKind = 'number' | 'text' | 'list' | 'switch';
export type RuleUnit =
  | 'characters'
  | 'wordsMax'
  | 'wordsMin'
  | 'fanouts'
  | 'questions'
  | 'links'
  | 'perSection'
  | 'steps';

export interface RuleDef {
  key: string;
  group: RuleGroup;
  kind: RuleKind;
  /** The default: a number, a text, a comma list; '' for a switch. */
  value: string;
  unit?: RuleUnit;
  /** How it is checked: from the page as written, by AI, or against the product feed. */
  check: 'page' | 'ai' | 'feed';
  /** Always on, without a switch: a rule the editor itself keeps. */
  fixed?: true;
}

const SHARED_RULES: RuleDef[] = [
  {
    key: 'sentence',
    group: 'structure',
    kind: 'number',
    value: '150',
    unit: 'characters',
    check: 'page',
  },
  {
    key: 'length',
    group: 'structure',
    kind: 'number',
    value: '',
    unit: 'characters',
    check: 'page',
  },
  // The editor keeps it too: a second H1 becomes an H2 (_oneH1.ts).
  { key: 'oneH1', group: 'structure', kind: 'switch', value: '', check: 'page', fixed: true },
  {
    key: 'summary',
    group: 'structure',
    kind: 'number',
    value: '50',
    unit: 'wordsMax',
    check: 'page',
  },
  {
    key: 'h2Answer',
    group: 'structure',
    kind: 'number',
    value: '60',
    unit: 'wordsMax',
    check: 'page',
  },
  { key: 'fanoutH2', group: 'fanouts', kind: 'number', value: '4', unit: 'fanouts', check: 'page' },
  { key: 'faq', group: 'fanouts', kind: 'number', value: '5', unit: 'questions', check: 'page' },
  {
    key: 'fanoutFaq',
    group: 'fanouts',
    kind: 'number',
    value: '3',
    unit: 'questions',
    check: 'page',
  },
  { key: 'keywords', group: 'fanouts', kind: 'list', value: '', check: 'page' },
  {
    key: 'internalLinks',
    group: 'links',
    kind: 'number',
    value: '3',
    unit: 'links',
    check: 'page',
  },
  {
    key: 'outboundLinks',
    group: 'links',
    kind: 'number',
    value: '2',
    unit: 'links',
    check: 'page',
  },
  { key: 'datedPoint', group: 'links', kind: 'switch', value: '', check: 'page' },
  { key: 'citeInline', group: 'links', kind: 'switch', value: '', check: 'page' },
  { key: 'aiTraces', group: 'style', kind: 'switch', value: '', check: 'page' },
  {
    key: 'bannedWords',
    group: 'style',
    kind: 'list',
    value: 'seamless, leverage, robust',
    check: 'page',
  },
  { key: 'tone', group: 'style', kind: 'text', value: 'Clear, confident, no hype', check: 'ai' },
  { key: 'language', group: 'style', kind: 'text', value: 'English (US)', check: 'ai' },
];

/** Each page type's own rules, above the shared ones (spec §10); a blog post has none. */
const TYPE_RULES: Partial<Record<PageType, RuleDef[]>> = {
  feature_page: [
    { key: 'comparisonTable', group: 'type', kind: 'switch', value: '', check: 'page' },
    { key: 'whoFor', group: 'type', kind: 'text', value: '', check: 'ai' },
    {
      key: 'proofPerSection',
      group: 'type',
      kind: 'number',
      value: '1',
      unit: 'perSection',
      check: 'page',
    },
  ],
  solution_page: [
    { key: 'industryNamed', group: 'type', kind: 'switch', value: '', check: 'ai' },
    {
      key: 'useCaseSteps',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'steps',
      check: 'page',
    },
  ],
  comparison: [
    { key: 'sideBySide', group: 'type', kind: 'switch', value: '', check: 'page' },
    { key: 'fairness', group: 'type', kind: 'switch', value: '', check: 'ai' },
  ],
  product_page: [
    { key: 'specsTable', group: 'type', kind: 'switch', value: '', check: 'page' },
    { key: 'feedMatch', group: 'type', kind: 'switch', value: '', check: 'feed' },
    {
      key: 'fitQuestions',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'questions',
      check: 'page',
    },
    { key: 'first40Words', group: 'type', kind: 'switch', value: '', check: 'ai' },
  ],
  category_page: [
    {
      key: 'introText',
      group: 'type',
      kind: 'number',
      value: '120',
      unit: 'wordsMin',
      check: 'page',
    },
    {
      key: 'buyingFaq',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'questions',
      check: 'page',
    },
  ],
  destination_page: [
    { key: 'currentPrices', group: 'type', kind: 'switch', value: '', check: 'ai' },
    { key: 'bestTime', group: 'type', kind: 'switch', value: '', check: 'page' },
  ],
  guide: [
    {
      key: 'howToSteps',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'steps',
      check: 'page',
    },
  ],
  definition: [
    {
      key: 'definitionFirst',
      group: 'type',
      kind: 'number',
      value: '60',
      unit: 'wordsMax',
      check: 'page',
    },
    { key: 'examplesSection', group: 'type', kind: 'switch', value: '', check: 'page' },
  ],
  alternatives: [
    { key: 'sideBySide', group: 'type', kind: 'switch', value: '', check: 'page' },
    { key: 'fairness', group: 'type', kind: 'switch', value: '', check: 'ai' },
  ],
  collection_page: [
    {
      key: 'introText',
      group: 'type',
      kind: 'number',
      value: '120',
      unit: 'wordsMin',
      check: 'page',
    },
    {
      key: 'buyingFaq',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'questions',
      check: 'page',
    },
  ],
  sizing_guide: [
    { key: 'sizeChart', group: 'type', kind: 'switch', value: '', check: 'page' },
    {
      key: 'measureSteps',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'steps',
      check: 'page',
    },
    {
      key: 'fitQuestions',
      group: 'type',
      kind: 'number',
      value: '3',
      unit: 'questions',
      check: 'page',
    },
  ],
};

/**
 * The Language rule's value for the brand's language (brands.language, as
 * the brief and the agent write in): its name, US English for English or
 * none.
 */
export function languageRuleValue(code: string | null | undefined): string {
  const label = code && code !== 'en' ? LANGUAGES.find((l) => l.code === code)?.label : undefined;
  return label ? label.replace(/\s*\([^)]*\)$/, '') : 'English (US)';
}

/**
 * A shopping path's rules (shopping path, part 6), on an online shop's page
 * that takes one: it links its category page, enough of its products, and
 * none that no longer sells.
 */
const SHOPPING_RULES: RuleDef[] = [
  { key: 'shopCategoryLink', group: 'links', kind: 'switch', value: '', check: 'page' },
  {
    key: 'shopProductLinks',
    group: 'links',
    kind: 'number',
    value: '3',
    unit: 'links',
    check: 'page',
  },
  { key: 'shopLinksLive', group: 'links', kind: 'switch', value: '', check: 'page' },
];

/** The Shopping rules' keys: checked against the shopping path (shoppingStatus). */
export const SHOPPING_RULE_KEYS: ReadonlySet<string> = new Set(SHOPPING_RULES.map((r) => r.key));

/**
 * The rules of a set: the type's own, then the shared groups, with the
 * type's length, or the page's own when it was brought in to optimize; and
 * a shopping path's on an online shop's page that takes one (`shopping`).
 */
export function ruleSet(
  pageType: PageType | null,
  defaults: {
    keywords?: string[];
    language?: string | null;
    length?: number | null;
    shopping?: boolean;
  } = {},
): RuleDef[] {
  const own = (pageType && TYPE_RULES[pageType]) || [];
  const shopping =
    defaults.shopping && pageType && Object.hasOwn(PRODUCTS_FOR, pageType) ? SHOPPING_RULES : [];
  return [
    ...own,
    ...shopping,
    ...SHARED_RULES.map((rule) => {
      if (rule.key === 'length') {
        return { ...rule, value: String(defaults.length ?? lengthTarget(pageType)) };
      }
      if (rule.key === 'language') return { ...rule, value: languageRuleValue(defaults.language) };
      if (rule.key === 'keywords' && defaults.keywords?.length) {
        return { ...rule, value: defaults.keywords.join(', ') };
      }
      return rule;
    }),
  ];
}

/** Per rule: whether it is on, and the value used. */
const overridesSchema = z
  .record(
    z.string().max(40),
    z.object({ on: z.boolean().optional(), value: z.string().max(500).optional() }),
  )
  .refine((o) => Object.keys(o).length <= 60);

/** A rule written in the person's own words ("Your text rules"). */
export const MAX_TEXT_RULES = 50;
export const MAX_TEXT_RULE_LENGTH = 300;
export const textRuleSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(MAX_TEXT_RULE_LENGTH),
  on: z.boolean(),
});
export type TextRule = z.infer<typeof textRuleSchema>;

/** The draft's choices on its rules (content_drafts.rules, 00213). */
export const draftRulesSchema = z.object({
  /** The page type whose set applies; null follows the draft's type. */
  set: z.enum(PAGE_TYPES).nullable(),
  /**
   * The set the draft started from: GetCito's default, or the workspace's
   * My rules (00214). Null until the person changes something: the
   * workspace's My rules for the type apply, if it has them.
   */
  source: z.enum(['default', 'mine']).nullable().default(null),
  overrides: overridesSchema,
  textRules: z.array(textRuleSchema).max(MAX_TEXT_RULES).default([]),
  /**
   * A page brought in to optimize: its length when it came in, in
   * characters. Its Length rule aims there (±20%), not at the type's length
   * for a new page; the person can still change it.
   */
  importLength: z.number().int().min(1).max(10_000_000).optional(),
});
export type DraftRules = z.infer<typeof draftRulesSchema>;
/** As saved: the source and text rules may be left out (rules from before 00214 have neither). */
export type DraftRulesInput = z.input<typeof draftRulesSchema>;
export const NO_DRAFT_RULES: DraftRules = {
  set: null,
  source: null,
  overrides: {},
  textRules: [],
};

/** A workspace's My rules for one page type (content_rule_sets, 00214). */
export const savedRuleSetSchema = z.object({
  overrides: overridesSchema,
  textRules: z.array(textRuleSchema).max(MAX_TEXT_RULES),
});
export type SavedRuleSet = z.infer<typeof savedRuleSetSchema>;

/**
 * The database's size checks, in bytes of the JSON as stored: a draft's
 * rules (00213), and a set's overrides and text rules (00214). The zod
 * limits count characters, and text outside Latin script takes 2–4 bytes
 * each, so a save is checked against these first.
 */
export const MAX_DRAFT_RULES_BYTES = 32_768;
export const MAX_SET_OVERRIDES_BYTES = 16_384;
export const MAX_SET_TEXT_RULES_BYTES = 32_768;

/**
 * At least the bytes a value takes as jsonb text: its UTF-8 JSON, plus the
 * space jsonb writes after each ':' and ',' (counted for every one, so the
 * size errs high).
 */
export function storedBytes(value: unknown): number {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).length + (json.match(/[:,]/g)?.length ?? 0);
}

/** Whether a draft's rules fit the database's check. */
export function draftRulesFit(rules: DraftRules): boolean {
  return storedBytes(rules) <= MAX_DRAFT_RULES_BYTES;
}

/** Whether a set fits the database's checks. */
export function ruleSetFits(set: SavedRuleSet): boolean {
  return (
    storedBytes(set.overrides) <= MAX_SET_OVERRIDES_BYTES &&
    storedBytes(set.textRules) <= MAX_SET_TEXT_RULES_BYTES
  );
}

/**
 * The choices in effect: the draft's own; or, for a draft no one has set
 * rules on yet, the workspace's My rules for the set's type, as a template.
 */
export function effectiveRules(rules: DraftRules, mine: SavedRuleSet | undefined): DraftRules {
  const untouched =
    rules.source === null && !Object.keys(rules.overrides).length && !rules.textRules.length;
  if (untouched && mine) {
    return {
      ...rules,
      source: 'mine',
      overrides: overridesForImport(mine.overrides, rules.importLength),
      textRules: mine.textRules,
    };
  }
  return rules;
}

/**
 * A set's choices as a page brought in to optimize takes them: the set's
 * Length value is for a new page, so the page's own length (importLength)
 * stands in for it; on or off still follows the set.
 */
export function overridesForImport(
  overrides: SavedRuleSet['overrides'],
  importLength: number | undefined,
): SavedRuleSet['overrides'] {
  const length = overrides.length;
  if (!importLength || length?.value === undefined) return overrides;
  return { ...overrides, length: { on: length.on } };
}

/**
 * The set Save as my rules keeps from a draft. A page brought in shows its
 * own length, which isn't a choice: the workspace's Length value stays.
 */
export function setToSave(rules: DraftRules, mine: SavedRuleSet | undefined): SavedRuleSet {
  const kept = mine?.overrides.length?.value;
  const length = rules.overrides.length;
  if (!rules.importLength || length?.value !== undefined || kept === undefined) {
    return { overrides: rules.overrides, textRules: rules.textRules };
  }
  return {
    overrides: { ...rules.overrides, length: { ...length, value: kept } },
    textRules: rules.textRules,
  };
}

/*
 * The tag passes below read each '<' once, left to right, and give what the
 * regex each names would, in time near the text's length however its tags
 * are left open. The same as textLength's on the server
 * (backend/src/lib/pageContent.js).
 */

/** ASCII letters lower-cased, nothing else: every index stays where it was. */
const asciiLower = (text: string) => text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());

/** A letter, digit or _, as \b reads a word. */
const isWordChar = (code: number) =>
  (code >= 48 && code <= 57) ||
  (code >= 65 && code <= 90) ||
  (code >= 97 && code <= 122) ||
  code === 95;

/** Each script and style element as a space: /<(script|style)\b[\s\S]*?<\/\1>/gi. */
function withoutScripts(text: string): string {
  const lower = asciiLower(text);
  // A name with no closing tag left closes nowhere after it either.
  const open = new Set(['script', 'style']);
  let out = '';
  let kept = 0;
  for (let at = lower.indexOf('<'); at !== -1 && open.size;) {
    const name = [...open].find((tag) => lower.startsWith(tag, at + 1));
    const after = name ? at + 1 + name.length : 0;
    if (name && !isWordChar(lower.charCodeAt(after))) {
      const close = lower.indexOf(`</${name}>`, after);
      if (close !== -1) {
        out += `${text.slice(kept, at)} `;
        kept = close + name.length + 3;
        at = lower.indexOf('<', kept);
        continue;
      }
      open.delete(name);
    }
    at = lower.indexOf('<', at + 1);
  }
  return out + text.slice(kept);
}

const SPACED_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'td',
  'th',
  'blockquote',
  'br',
  'div',
]);

/** Each block tag, opening or closing, as a space: /<\/?(p|h[1-6]|li|td|th|blockquote|br|div)\b[^>]*>/gi. */
function withoutBlockTags(text: string): string {
  const lower = asciiLower(text);
  let out = '';
  let kept = 0;
  for (let at = lower.indexOf('<'); at !== -1;) {
    const from = lower[at + 1] === '/' ? at + 2 : at + 1;
    let end = from;
    while (isWordChar(lower.charCodeAt(end))) end += 1;
    if (SPACED_TAGS.has(lower.slice(from, end))) {
      const close = lower.indexOf('>', end);
      // No '>' left: no tag after this one ends either.
      if (close === -1) break;
      out += `${text.slice(kept, at)} `;
      kept = close + 1;
      at = lower.indexOf('<', kept);
      continue;
    }
    // The word holds no '<': the next tag starts after it.
    at = lower.indexOf('<', Math.max(at + 1, end));
  }
  return out + text.slice(kept);
}

/** Every other tag dropped: /<[^>]*>/g. */
function withoutTags(text: string): string {
  let out = '';
  let kept = 0;
  for (let at = text.indexOf('<'); at !== -1;) {
    const close = text.indexOf('>', at + 1);
    if (close === -1) break;
    out += text.slice(kept, at);
    kept = close + 1;
    at = text.indexOf('<', kept);
  }
  return out + text.slice(kept);
}

/**
 * A page's text length in characters, about as the editor counts it: the
 * words without tags, runs of spaces as one (a space between blocks, where
 * the editor counts none, so a little over). Read where there is no editor
 * to count: on the server, and before a draft opens.
 */
export function pageTextLength(html: string): number {
  return withoutTags(withoutBlockTags(withoutScripts(html)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&[#a-z0-9]+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/**
 * The rules a draft starts with. A page brought in to optimize aims its
 * Length rule at its own length (within the range the rule takes), not a
 * new page's; anything else starts with none.
 */
export function startingRules(method: DraftMethod, bodyHtml: string | undefined): DraftRules {
  if (method !== 'optimize' || bodyHtml === undefined) return NO_DRAFT_RULES;
  const length = pageTextLength(bodyHtml);
  if (!length) return NO_DRAFT_RULES;
  return {
    ...NO_DRAFT_RULES,
    importLength: Math.min(RULE_LENGTH_MAX, Math.max(RULE_LENGTH_MIN, length)),
  };
}

/**
 * Paste many: one rule per line, bullets and numbering taken off ("- ",
 * "• ", "1. ", "2) "), empty lines dropped, each cut to the limit.
 */
export function splitRules(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .map((line) => line.slice(0, MAX_TEXT_RULE_LENGTH));
}

/** How a text rule is checked: a number makes it a number check; anything else, AI. */
export function textRuleCheck(text: string): 'numberCheck' | 'aiCheck' {
  return /\d/.test(text) ? 'numberCheck' : 'aiCheck';
}

export interface ActiveRule extends RuleDef {
  on: boolean;
  /** The value in effect: the draft's, else the set's. */
  current: string;
  changed: boolean;
}

export function activeRules(defs: RuleDef[], rules: Pick<DraftRules, 'overrides'>): ActiveRule[] {
  return defs.map((def) => {
    const override = rules.overrides[def.key];
    const current = override?.value ?? def.value;
    return {
      ...def,
      on: def.fixed ? true : (override?.on ?? true),
      current,
      changed: (override?.on !== undefined && override.on !== true) || current !== def.value,
    };
  });
}

/** The lengths a brief is built for (contentBrief.js BRIEF_LENGTH_MIN/MAX), in characters. */
export const RULE_LENGTH_MIN = 100;
export const RULE_LENGTH_MAX = 50_000;

/**
 * The page length the rules ask for: the Length rule's value while it is on,
 * within the range Rebuild outline builds for.
 */
export function ruleLength(rules: ActiveRule[], pageType: PageType | null): number {
  const rule = rules.find((r) => r.key === 'length');
  const value = rule?.on ? Number(rule.current) : NaN;
  if (!Number.isFinite(value) || value <= 0) return lengthTarget(pageType);
  return Math.min(RULE_LENGTH_MAX, Math.max(RULE_LENGTH_MIN, value));
}

/**
 * About how many characters a word takes, its space and punctuation
 * included: an English average, for showing a length in words too
 * (Content Editor v1.1 §3.2). Characters stay the unit rules count in.
 */
export const CHARACTERS_PER_WORD = 6;

/** A length in characters as about so many words, to the nearest ten from 100 on. */
export function wordsForLength(characters: number): number {
  const words = Math.max(1, Math.round(characters / CHARACTERS_PER_WORD));
  return words >= 100 ? Math.round(words / 10) * 10 : words;
}

// ─── The page as written ────────────────────────────────────────────────────

export interface PageBlock {
  tag: string;
  text: string;
  words: number;
  /** Links in the block, as written. */
  links: string[];
}

export interface PageRead {
  blocks: PageBlock[];
  text: string;
  /** The editor's character count, as the toolbar shows it. */
  characters: number;
  /** H1s with words inside the page's HTML blocks. */
  htmlBlockH1s?: number;
  /**
   * Every link on the page, each once: in any block (a heading's, a table's
   * too) and inside its HTML blocks (a product card or grid's). What the
   * Shopping rules and Before you publish read (shopping path).
   */
  links?: string[];
  /** The product cards in its HTML blocks, with the price each shows (Before you publish). */
  cards?: PageCard[];
}

const BLOCK_TAGS = 'h1, h2, h3, p, li, table, ol, ul, blockquote';

/** Reads the page's blocks in order, each list item and table once. */
export function readPage(html: string, characters: number): PageRead {
  // The content DOM's parser (dom.ts): the browser's, or jsdom's on the server (go-live gate).
  const doc = parseHtml(html);
  const blocks: PageBlock[] = [];
  for (const el of doc.body.querySelectorAll(BLOCK_TAGS)) {
    const tag = el.tagName.toLowerCase();
    // A paragraph inside a list item or a cell is part of that block.
    if (tag === 'p' && el.closest('li, td, th, blockquote')) continue;
    if ((tag === 'ol' || tag === 'ul') && el.closest('li')) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    blocks.push({
      tag:
        tag === 'ol' || tag === 'ul' ? `${tag}:${el.querySelectorAll(':scope > li').length}` : tag,
      text,
      words: countWords(text),
      links: [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
    });
  }
  // An HTML block's H1s are the page's too (One H1 per page): the editor
  // doesn't rewrite them, so the rule says so.
  let htmlBlockH1s = 0;
  // Every link, whatever block holds it, an HTML block's too: a product
  // card's or grid's counts for the Shopping rules.
  const links = new Set(
    [...doc.body.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
  );
  const cards: PageCard[] = [];
  for (const el of doc.body.querySelectorAll('[data-html-block]')) {
    const inner = decodeHtmlBlock(el.getAttribute('data-html-block') ?? '');
    if (!inner) continue;
    const block = parseHtml(inner);
    htmlBlockH1s += [...block.body.querySelectorAll('h1')].filter((h) =>
      h.textContent?.trim(),
    ).length;
    for (const a of block.body.querySelectorAll('a[href]')) links.add(a.getAttribute('href') ?? '');
    // A card's price is its span, after the name (productBlock.ts).
    for (const a of block.body.querySelectorAll('a.getcito-product[href]')) {
      const price = a.querySelector('span')?.textContent?.trim();
      cards.push({ href: a.getAttribute('href') ?? '', price: price || null });
    }
  }
  return {
    blocks,
    text: blocks
      .filter((b) => !b.tag.startsWith('ol') && !b.tag.startsWith('ul'))
      .map((b) => b.text)
      .join(' '),
    characters,
    htmlBlockH1s,
    links: [...links].filter((href) => href.trim()),
    cards,
  };
}

const isHeading = (b: PageBlock) => b.tag === 'h1' || b.tag === 'h2' || b.tag === 'h3';
const isText = (b: PageBlock) => b.tag === 'p' || b.tag === 'li';
const isQuestion = (b: PageBlock) => b.text.trim().endsWith('?');

// ─── Checks ─────────────────────────────────────────────────────────────────

/** A rule's status: met, not met (with what's missing), or one the page can't say. */
export type RuleStatus =
  | { state: 'ok' }
  | {
      state: 'bad';
      code: 'over' | 'found';
      count: number;
      /** The linked products that no longer sell, by name and why (shopLinksLive). */
      items?: { title: string; state: ShoppingLinkState }[];
    }
  | {
      state: 'bad';
      code: 'partOf';
      count: number;
      of: number;
      /** The fan-outs still to use, the most searched first (fanoutH2, fanoutFaq). */
      missing?: string[];
    }
  | { state: 'bad'; code: 'current'; count: number }
  /** Out of the Length rule's band, as it reads (lengthBand). */
  | { state: 'bad'; code: 'short' | 'long'; count: number; min: number; max: number }
  | { state: 'bad'; code: 'words'; count: number }
  /** The page's price, GTIN or stock differs from its product's in the feed (CE-053). */
  | { state: 'bad'; code: 'feedDiffers'; count: number }
  | { state: 'bad'; code: 'missing' | 'noH2' | 'notSet' }
  /** No FAQ yet: the fan-outs its questions should use, the most searched first. */
  | { state: 'bad'; code: 'needsFaq'; missing?: string[] }
  | {
      state: 'info';
      code:
        | 'aiCheck'
        | 'needsFeed'
        | 'feedReading'
        | 'notInFeed'
        | 'feedNothing'
        | 'noFanouts'
        | 'addKeywords'
        | 'notHowTo'
        | 'englishOnly'
        | 'noSizes'
        /** No shopping path yet, it's being read, or it couldn't be (shopping path, part 6). */
        | 'noShoppingPath'
        | 'shoppingReading'
        | 'shoppingFailed';
    };

export interface RuleContext {
  brandDomains: string[];
  competitorDomains: string[];
  /** The fan-outs the draft keeps, the most searched first. */
  fanouts: string[];
  /** The brand's language (brands.language); none reads as English. */
  language?: string | null;
  /**
   * The page's product in the brand's catalog (getCatalogMatch, Quality
   * CE-053), for "Price, GTIN and stock match the feed": 'reading' while it
   * is read; none where the feed isn't checked (before Phase 3, other types).
   */
  catalog?: CatalogMatch | 'reading' | null;
  /**
   * The page's shopping path read against the catalog now (shoppingCheck.ts),
   * for the Shopping rules: 'reading' while it is read, 'failed' when it
   * couldn't be; none without a path.
   */
  shopping?: ShoppingCheck | 'reading' | 'failed' | null;
}

/** Phrases that read as machine-written (spec §10, "Remove AI traces"). */
export const AI_TRACES = [
  'delve',
  "in today's fast-paced world",
  'in today’s fast-paced world',
  'it is important to note',
  "it's important to note",
  'navigate the complexities',
  'unlock the power',
  'a testament to',
  'in the ever-evolving',
  'game-changer',
  'not only',
];

const list = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

function count(text: string, phrase: string): number {
  const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    text.toLowerCase().match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu'))
      ?.length ?? 0
  );
}

/** The machine-written phrases the page has, each once: what "Remove AI traces" counts. */
export function aiTracesFound(text: string): string[] {
  return [
    ...new Set(
      AI_TRACES.filter((phrase) => count(text, phrase) > 0).map((p) => p.replace('’', "'")),
    ),
  ];
}

/** A link's host, or null for one on the page's own site (a path or an anchor). */
function linkHost(href: string): string | null {
  if (!/^https?:\/\//i.test(href)) return null;
  return normalizeDomain(href) || null;
}

/** Whether a fan-out's words are carried by a text, as the Sources tab reads it. */
function carries(fanout: string, text: string): boolean {
  const words = [...new Set(wordsOf(fanout))];
  if (!words.length) return false;
  const have = new Set(wordsOf(text));
  return words.filter((w) => have.has(w)).length / words.length >= 0.75;
}

/**
 * An FAQ's heading, in the languages it's read in ("FAQ", "Häufig gestellte
 * Fragen", "Questions fréquentes", "Preguntas frecuentes", "Sıkça Sorulan
 * Sorular"…), lowercased the Turkish way too.
 */
const FAQ_HEADING =
  /(?<!\p{L})(?:faqs?|frequently asked|häufig gestellte fragen|häufige fragen|questions fréquentes|foire aux questions|preguntas frecuentes|sıkça sorulan sorular|sık sorulan sorular|sss|domande frequenti|perguntas frequentes|veelgestelde vragen)(?!\p{L})/iu;
/**
 * A product's sizes on its page: a size chart or guide, "sizes", letter
 * sizes or a country's numbered ones ("XS", "XL", "EU 42", "US 9.5").
 */
const SIZES =
  /(?<!\p{L})(?:size\s+(?:chart|guide|table)|sizes|sizing|xxs|xs|xl|xxl|xxxl|(?:eu|us|uk)\s?\d{1,2}(?:[.,]5)?)(?!\p{L})/iu;
/** The languages an FAQ's heading is read in: another page's missing FAQ isn't said. */
const FAQ_LANGUAGES = new Set(['en', 'de', 'fr', 'es', 'tr', 'it', 'pt', 'nl']);
const isFaqHeading = (text: string) =>
  FAQ_HEADING.test(text) || FAQ_HEADING.test(text.toLocaleLowerCase('tr'));

/** The FAQ's questions: the blocks after an "FAQ" heading, up to the next H2, that ask one. */
function faqQuestions(blocks: PageBlock[]): string[] | null {
  const start = blocks.findIndex((b) => (b.tag === 'h2' || b.tag === 'h3') && isFaqHeading(b.text));
  if (start < 0) return null;
  const level = blocks[start].tag;
  const questions: string[] = [];
  for (const block of blocks.slice(start + 1)) {
    if (block.tag === 'h2' || (level === 'h3' && block.tag === 'h3' && !isQuestion(block))) break;
    if ((block.tag === 'h3' || isText(block)) && isQuestion(block)) questions.push(block.text);
  }
  return questions;
}

/** A title that promises steps: "How to …", "… step by step", a tutorial. */
const HOW_TO_TITLE =
  /\bhow to\b|\bstep[-\s]by[-\s]step\b|\btutorial\b|\b\d+\s+(easy\s+|simple\s+)?steps\b/i;

/** How far into its first sentence a definition names what the term is. */
const DEFINING_WORDS = 8;

/** Subjects that make "… is …" a remark, not a definition: "Many say it is great." */
const PRONOUNS = /^(it|this|that|these|those|there|which|who|he|she|they|we|you|i)$/i;

/**
 * "X is …": the first sentence says what its subject is, means or refers to
 * within its first few words, and the subject isn't a pronoun.
 */
function definesAtOnce(text: string): boolean {
  const sentence = text.trim().split(/(?<=[.!?])\s/)[0];
  // Words without their punctuation: "Cold brew is, simply, …" defines too.
  const words = sentence
    .split(/\s+/)
    .slice(0, DEFINING_WORDS)
    .map((w) => w.replace(/[^\p{L}]/gu, ''));
  const verb = words.findIndex(
    (w, i) =>
      /^(is|are|means)$/i.test(w) || (/^refers$/i.test(w) && /^to$/i.test(words[i + 1] ?? '')),
  );
  return verb > 0 && !PRONOUNS.test(words[verb - 1]);
}

/**
 * The Length rule is a target, not a floor: a page within 20% of it meets it,
 * shorter or longer doesn't, so a 15,921-character page under a 3,000 rule is
 * open, and Apply rules with Agent asks for it to be shortened.
 */
export const LENGTH_TOLERANCE = 0.2;
export function lengthBand(target: number): { min: number; max: number } {
  return {
    min: Math.round(target * (1 - LENGTH_TOLERANCE)),
    max: Math.round(target * (1 + LENGTH_TOLERANCE)),
  };
}

const atLeast = (have: number, want: number): RuleStatus =>
  have >= want ? { state: 'ok' } : { state: 'bad', code: 'partOf', count: have, of: want };

/**
 * Rules the Content Agent can't fix: it changes words and adds blocks, never
 * a heading's level, so a page's extra H1s are made H2s in the editor; a
 * price, GTIN or stock that differs from the feed is the person's to check
 * (the page or the feed may be the one that's wrong); a linked product that
 * no longer sells is the person's to remove or replace.
 */
export const NOT_FOR_AGENT = new Set(['oneH1', 'feedMatch', 'shopLinksLive']);

/**
 * What to do instead, for the open rules the agent doesn't fix: its
 * message's key, the extra H1s' first, then the feed's and the shopping
 * links', one message for both when both are open.
 */
export const notForAgentMessage = (open: readonly { rule: { key: string } }[]) => {
  const has = (key: string) => open.some(({ rule }) => rule.key === key);
  if (has('oneH1')) return 'notForAgent';
  if (!has('shopLinksLive')) return 'notForAgentFeed';
  return has('feedMatch') ? 'notForAgentFeedShopping' : 'notForAgentShopping';
};

/**
 * The fan-outs a rule still needs (fanoutH2, fanoutFaq), quoted for the
 * agent, the most searched first and as many as fit in `max` characters:
 * the rule's detail it is sent has room for 500. Null when there are none.
 */
export function fanoutsToUse(status: RuleStatus, max = 300): string | null {
  if (status.state !== 'bad' || !('missing' in status) || !status.missing?.length) return null;
  const quoted: string[] = [];
  let length = 0;
  for (const fanout of status.missing) {
    const item = `"${fanout}"`;
    // One too long for what's left: a shorter one after it may still fit.
    if (length + item.length > max) continue;
    quoted.push(item);
    length += item.length + 2;
  }
  return quoted.length ? quoted.join('; ') : null;
}

/**
 * The rules on that the page doesn't meet (of `only`, when given): the ones
 * the Content Agent is asked to fix, those it never fixes, and those `held`
 * on this page by what it keeps word for word (editor test 2026-10-25: long
 * sentences all inside passages AI answers quote, a Length out of a
 * rewrite's reach), which are the person's to decide.
 */
export function openRulesForAgent<T extends { rule: ActiveRule; status: RuleStatus }>(
  rules: T[],
  only?: string[],
  held: ReadonlySet<string> = NO_HELD,
): { forAgent: T[]; notForAgent: T[]; held: T[] } {
  const open = rules.filter(
    ({ rule, status }) => rule.on && status.state === 'bad' && (!only || only.includes(rule.key)),
  );
  return {
    forAgent: open.filter(({ rule }) => !NOT_FOR_AGENT.has(rule.key) && !held.has(rule.key)),
    notForAgent: open.filter(({ rule }) => NOT_FOR_AGENT.has(rule.key)),
    held: open.filter(({ rule }) => !NOT_FOR_AGENT.has(rule.key) && held.has(rule.key)),
  };
}

/** No rule held by what the page keeps. */
export const NO_HELD: ReadonlySet<string> = new Set();

/**
 * A page past its Length when a Fix run doesn't send the Length rule (held
 * for the person, or not picked; a hand-off sends none: editor test
 * 2026-10-26): its characters and the most it may have, so what the agent
 * adds for the other rules stays short. Undefined with Length off, within
 * it, sent, or a Length of 0.
 */
export function overLengthFor<T extends { rule: ActiveRule; status: RuleStatus }>(
  rules: T[],
  sent: readonly { rule: ActiveRule }[],
): { count: number; max: number } | undefined {
  const length = rules.find(({ rule }) => rule.key === 'length' && rule.on);
  if (!length || sent.some(({ rule }) => rule.key === 'length')) return undefined;
  const { status } = length;
  // A Length of 0 reads every page as long, at most 0: nothing to say.
  return status.state === 'bad' && 'code' in status && status.code === 'long' && status.max >= 1
    ? { count: status.count, max: status.max }
    : undefined;
}

/**
 * What to say when only held rules are left for the agent: the quoted
 * passages' (a sentence in one), else the Length's, out of a rewrite's reach.
 */
export const heldMessage = (held: readonly { rule: { key: string } }[]) =>
  held.some(({ rule }) => rule.key === 'sentence') ? 'heldAll' : 'heldLength';

/** A rule read with nothing of the brand's: for checks that read only the page. */
export const NO_RULE_CONTEXT: RuleContext = {
  brandDomains: [],
  competitorDomains: [],
  fanouts: [],
};

/** How far off its Length a page may be before Rewrite the page to these rules is recommended. */
export const REWRITE_LENGTH_OFF = 0.3;
/** How many rules the agent can fix may be open before it is. */
export const REWRITE_OPEN_RULES = 4;
/** The most text a page sent whole may hold (contentRewrite.js MAX_REWRITE_CHARS). */
export const REWRITE_MAX_CHARS = 60_000;

/** The page's last rewrite, as the API keeps it (00285). */
export interface LastRewrite {
  /** The characters it came to (the editor counts its page again, as its toolbar does). */
  chars: number;
  /** The Length it was written to; null with Length off. */
  target: number | null;
  /** The characters it kept word for word. */
  kept: number;
}

/**
 * What a page rewrite can't go under, and what the last one came to: a
 * Length under either is out of its reach (editor test 2026-10-25, where a
 * page kept 78% of its Length and three rewrites never got there).
 */
export interface RewriteReach {
  /** The characters it keeps as they are (the passages AI answers quote, tables, images…). */
  kept: number;
  /**
   * The least a rewrite that keeps them comes to: those, the headings, and
   * the least answer under each heading and summary under the H1 where
   * nothing kept stands (rewriteFloor in the editor). Kept low on purpose.
   */
  floor: number;
  /** The page's last rewrite, or null for none (or one made before 00285). */
  last: LastRewrite | null;
}

/** Nothing known about what a rewrite keeps or reached: every Length is in reach. */
export const NO_REACH: RewriteReach = { kept: 0, floor: 0, last: null };

/** A long page whose Length a rewrite can't reach, and a Length it could. */
export interface LengthOutOfReach {
  count: number;
  target: number;
  /** The characters a rewrite keeps as they are. */
  kept: number;
  /** Why: the least a rewrite comes to is past the Length, or the last rewrite came to `least`. */
  why: 'floor' | 'reached';
  /** The least a rewrite comes to: the estimate, or what the last one came to, the more. */
  least: number;
  /** A Length the page can be rewritten to: that, up to the 500. */
  suggested: number;
}

/**
 * What the last rewrite says of this Length: the characters it came to, when
 * it was written to a Length (not with Length off) and it was asked for
 * this Length or a longer one, or missed its own and this one is within that
 * one's band. Null when it says nothing (a rewrite to 10,000 says nothing of
 * 3,000), or the page keeps less now than it kept then (a passage unlocked
 * since: a rewrite may go shorter). The counts differ by about a space a
 * block, so a little slack. `inReach`: whether coming within the band would
 * say this Length is in reach — not when the page keeps more now than then
 * (one rewritten with its cited passages too, say): keeping less and still
 * missing says keeping more misses too, but not the other way round.
 */
function lastRewriteSays(
  last: LastRewrite | null,
  target: number,
  kept: number,
): { chars: number; inReach: boolean } | null {
  if (!last || last.target === null) return null;
  const slack = last.kept * 0.02 + 20;
  if (last.kept > kept + slack) return null;
  const band = lengthBand(last.target);
  const missedItsOwn = last.chars > band.max && target >= band.min;
  if (target < last.target && !missedItsOwn) return null;
  return { chars: last.chars, inReach: last.kept >= kept - slack };
}

/**
 * Whether what a rewrite keeps, with the headings and their answers, puts
 * the Length out of its reach on its own: what the agent card names as why
 * a rewrite missed (the rewrite itself is no reason).
 */
export function keptOutOfReach<T extends { rule: ActiveRule; status: RuleStatus }>(
  rules: T[],
  reach: RewriteReach,
): boolean {
  return lengthOutOfReach(rules, { ...reach, last: null }) !== null;
}

/**
 * How much longer than the last rewrite came to the page must be for that
 * rewrite to say another won't get further: a page that took it (about as
 * long, or shorter) is rewritten from there, and the cut pass goes on.
 */
const REWRITTEN_SLACK = 0.05;

/**
 * Whether the page is over its Length by more than a rewrite could take
 * out: the least a rewrite comes to (`reach.floor`) is past the top of the
 * Length's band, or the last rewrite (lastRewriteSays) came to more than it
 * from a page still longer than it came to (editor test 2026-11-03: a
 * rewrite taken a little long held the Length out of reach for good, and
 * the agent never shortened the page again). A last rewrite that got
 * within the band says it's in reach, whatever the estimate. Null
 * otherwise, and for a page under its Length.
 */
export function lengthOutOfReach<T extends { rule: ActiveRule; status: RuleStatus }>(
  rules: T[],
  reach: RewriteReach,
): LengthOutOfReach | null {
  const length = rules.find(({ rule }) => rule.key === 'length' && rule.on);
  const target = Number(length?.rule.current);
  const status = length?.status;
  if (
    status?.state !== 'bad' ||
    status.code !== 'long' ||
    !Number.isFinite(target) ||
    target <= 0
  ) {
    return null;
  }
  const { max } = lengthBand(target);
  const says = lastRewriteSays(reach.last, target, reach.kept);
  if (says?.inReach && says.chars <= max) return null;
  const reached =
    says && says.chars > max && status.count > says.chars * (1 + REWRITTEN_SLACK)
      ? says.chars
      : null;
  if (reached === null && reach.floor <= max) return null;
  // The more of the two, so the Length suggested is one a rewrite can reach.
  const least = Math.max(reach.floor, reached ?? 0);
  const why = reached !== null && reached >= reach.floor ? 'reached' : 'floor';
  // A Length the page fits as a rewrite leaves it, never under the rule's
  // own value nor past its top, nor past the page as it is (that would read short).
  const roundUp = (n: number) => Math.ceil(n / 500) * 500;
  return {
    count: status.count,
    target,
    kept: reach.kept,
    why,
    least,
    suggested: Math.min(
      RULE_LENGTH_MAX,
      Math.max(target, Math.min(roundUp(least), roundUp(status.count))),
    ),
  };
}

/** Why the Rules tab recommends rewriting the page whole. */
export type RewriteAdvice =
  | { reason: 'length'; count: number; target: number; percent: number }
  | { reason: 'open'; count: number };

/**
 * Whether the Rules tab recommends Rewrite the page to these rules over
 * Apply rules with Agent's few edits a run: the page more than 30% off its
 * Length (one a rewrite can reach, given what it keeps and what the last
 * one came to: never again after one missed it), or 4 rules or more open
 * that the agent can fix. Null otherwise.
 */
export function rewriteAdvice<T extends { rule: ActiveRule; status: RuleStatus }>(
  rules: T[],
  reach: RewriteReach = NO_REACH,
  held: ReadonlySet<string> = NO_HELD,
): RewriteAdvice | null {
  const length = rules.find(({ rule }) => rule.key === 'length' && rule.on);
  const target = Number(length?.rule.current);
  const status = length?.status;
  // An empty page has nothing to rewrite, and one too long can't be sent whole.
  if (status && 'count' in status && (status.count === 0 || status.count > REWRITE_MAX_CHARS)) {
    return null;
  }
  if (
    status?.state === 'bad' &&
    (status.code === 'short' || status.code === 'long') &&
    Number.isFinite(target) &&
    target > 0
  ) {
    const off = Math.abs(status.count - target) / target;
    if (off > REWRITE_LENGTH_OFF && !lengthOutOfReach(rules, reach)) {
      return { reason: 'length', count: status.count, target, percent: Math.round(off * 100) };
    }
  }
  // A Length out of reach is no rule a rewrite meets.
  const outOfReach = lengthOutOfReach(rules, reach) !== null;
  const open = openRulesForAgent(rules, undefined, held).forAgent.filter(
    ({ rule }) => !(outOfReach && rule.key === 'length'),
  ).length;
  return open >= REWRITE_OPEN_RULES ? { reason: 'open', count: open } : null;
}

/**
 * "Price, GTIN and stock match the feed" (CE-053): the page against its
 * product in the brand's catalog, once a catalog is connected and has it.
 */
function feedStatus(
  page: PageRead,
  catalog: CatalogMatch | 'reading' | null | undefined,
): RuleStatus {
  if (catalog === 'reading') return { state: 'info', code: 'feedReading' };
  if (!catalog?.connected) return { state: 'info', code: 'needsFeed' };
  if (!catalog.product) return { state: 'info', code: 'notInFeed' };
  const texts = page.blocks.map((b) => b.text);
  const { compared, mismatches } = feedCheck({
    texts,
    offer: pageOffer(texts),
    variants: catalog.product.variants,
  });
  if (!compared) return { state: 'info', code: 'feedNothing' };
  return mismatches.length
    ? { state: 'bad', code: 'feedDiffers', count: mismatches.length }
    : { state: 'ok' };
}

/**
 * A Shopping rule's status (shopping path, part 6), from every link on the
 * page (PageRead's `links`): the category page linked; at least `n` of the
 * path's products that sell, or all of them when fewer do; none that no
 * longer sells, by name.
 */
function shoppingStatus(
  key: string,
  n: number,
  hrefs: string[],
  check: RuleContext['shopping'],
): RuleStatus {
  if (check === 'reading') return { state: 'info', code: 'shoppingReading' };
  if (check === 'failed') return { state: 'info', code: 'shoppingFailed' };
  if (!check) return { state: 'info', code: 'noShoppingPath' };
  const read = shoppingLinks(hrefs, check, n);
  if (key === 'shopCategoryLink') {
    if (!check.categories.length) return { state: 'info', code: 'noShoppingPath' };
    return read.categoryLinked ? { state: 'ok' } : { state: 'bad', code: 'missing' };
  }
  if (key === 'shopProductLinks') {
    if (!read.products) return { state: 'info', code: 'noShoppingPath' };
    return atLeast(read.linked.length, read.want);
  }
  return read.bad.length
    ? {
        state: 'bad',
        code: 'found',
        count: read.bad.length,
        items: read.bad.map((p) => ({ title: p.title, state: p.state })),
      }
    : { state: 'ok' };
}

/** A number rule's value as the checks read it: a whole number, 0 when it isn't one. */
export const ruleNumber = (rule: Pick<ActiveRule, 'current'>) =>
  Math.max(0, Math.floor(Number(rule.current) || 0));

/** Checks one rule against the page as written. */
export function checkRule(rule: ActiveRule, page: PageRead, ctx: RuleContext): RuleStatus {
  if (rule.check === 'feed') return feedStatus(page, ctx.catalog);
  if (rule.key === 'whoFor' && !rule.current.trim()) return { state: 'bad', code: 'notSet' };
  if (rule.check === 'ai') return { state: 'info', code: 'aiCheck' };

  const n = ruleNumber(rule);
  const { blocks } = page;
  const h1 = blocks.findIndex((b) => b.tag === 'h1');
  const firstH2 = blocks.findIndex((b) => b.tag === 'h2');
  const summary = blocks
    .slice(h1 + 1, firstH2 < 0 ? undefined : firstH2)
    .find((b) => b.tag === 'p');
  const own = ctx.brandDomains.map(normalizeDomain);
  const competitors = ctx.competitorDomains.map(normalizeDomain);
  const links = blocks.flatMap((b) => (isText(b) ? b.links : []));
  if (SHOPPING_RULE_KEYS.has(rule.key)) {
    return shoppingStatus(rule.key, n, page.links ?? [], ctx.shopping);
  }
  const outbound = (href: string) => {
    const host = linkHost(href);
    if (!host) return false;
    const kind = classifyDomain(host, { brandDomains: own, competitorDomains: competitors });
    return kind !== 'you' && kind !== 'competitor';
  };

  switch (rule.key) {
    case 'sentence': {
      const over = blocks
        .filter(isText)
        .flatMap((b) => b.text.split(/(?<=[.!?])\s+/))
        .filter((s) => s.length > n).length;
      return over ? { state: 'bad', code: 'over', count: over } : { state: 'ok' };
    }
    case 'length': {
      const { min, max } = lengthBand(n);
      if (page.characters < min) {
        return { state: 'bad', code: 'short', count: page.characters, min, max };
      }
      if (page.characters > max) {
        return { state: 'bad', code: 'long', count: page.characters, min, max };
      }
      return { state: 'ok' };
    }
    case 'summary':
      if (!summary || !summary.words) return { state: 'bad', code: 'missing' };
      return summary.words <= n
        ? { state: 'ok' }
        : { state: 'bad', code: 'words', count: summary.words };
    case 'h2Answer': {
      const h2s = blocks.flatMap((b, i) => (b.tag === 'h2' ? [i] : []));
      if (!h2s.length) return { state: 'bad', code: 'noH2' };
      const answered = h2s.filter((i) => {
        const next = blocks[i + 1];
        return next?.tag === 'p' && next.words > 0 && next.words <= n;
      }).length;
      return atLeast(answered, h2s.length);
    }
    case 'fanoutH2': {
      const top = ctx.fanouts.slice(0, n);
      if (!top.length) return { state: 'info', code: 'noFanouts' };
      const h2s = blocks.filter((b) => b.tag === 'h2');
      // Which ones, so the agent writes those, not H2s of its own.
      const missing = top.filter((f) => !h2s.some((h) => carries(f, h.text)));
      return missing.length
        ? {
            state: 'bad',
            code: 'partOf',
            count: top.length - missing.length,
            of: top.length,
            missing,
          }
        : { state: 'ok' };
    }
    case 'faq':
    case 'buyingFaq': {
      const questions = faqQuestions(blocks);
      if (!questions) {
        // A language whose FAQ heading isn't read: not said to be missing.
        return FAQ_LANGUAGES.has(languageCode(ctx.language) ?? '')
          ? { state: 'bad', code: 'missing' }
          : { state: 'info', code: 'englishOnly' };
      }
      return atLeast(questions.length, n);
    }
    case 'fanoutFaq': {
      const questions = faqQuestions(blocks);
      if (!questions) {
        // A new page has no FAQ yet: still name the fan-outs it should ask.
        const missing = ctx.fanouts.slice(0, n);
        return missing.length
          ? { state: 'bad', code: 'needsFaq', missing }
          : { state: 'bad', code: 'needsFaq' };
      }
      if (!ctx.fanouts.length) return { state: 'info', code: 'noFanouts' };
      // Different fan-outs the questions use, as fanoutH2 counts its H2s: no
      // more than there are, and each one still needed is named.
      const unused = ctx.fanouts.filter((f) => !questions.some((q) => carries(f, q)));
      const used = ctx.fanouts.length - unused.length;
      const of = Math.min(n, ctx.fanouts.length);
      if (used >= of) return { state: 'ok' };
      // The most searched ones no question uses yet, as many as are still needed.
      return { state: 'bad', code: 'partOf', count: used, of, missing: unused.slice(0, of - used) };
    }
    case 'keywords': {
      const wanted = list(rule.current);
      if (!wanted.length) return { state: 'info', code: 'addKeywords' };
      return atLeast(wanted.filter((k) => count(page.text, k) > 0).length, wanted.length);
    }
    case 'internalLinks':
      return atLeast(
        links.filter((href) => {
          const host = linkHost(href);
          return host
            ? classifyDomain(host, { brandDomains: own, competitorDomains: [] }) === 'you'
            : !href.startsWith('#') && !/^[a-z]+:/i.test(href);
        }).length,
        n,
      );
    case 'outboundLinks':
      return atLeast(links.filter(outbound).length, n);
    case 'oneH1': {
      // One H1, the page's title: more blur what the page is about.
      const h1s = blocks.filter((b) => b.tag === 'h1' && b.text).length + (page.htmlBlockH1s ?? 0);
      return h1s > 1 ? { state: 'bad', code: 'found', count: h1s } : { state: 'ok' };
    }
    case 'datedPoint': {
      const first100 = page.text.split(/\s+/).slice(0, 100).join(' ');
      return /\b(19|20)\d{2}\b/.test(first100)
        ? { state: 'ok' }
        : { state: 'bad', code: 'missing' };
    }
    case 'citeInline':
      return links.some(outbound) ? { state: 'ok' } : { state: 'bad', code: 'missing' };
    case 'aiTraces': {
      const found = AI_TRACES.reduce((sum, phrase) => sum + count(page.text, phrase), 0);
      return found ? { state: 'bad', code: 'found', count: found } : { state: 'ok' };
    }
    case 'bannedWords': {
      const found = list(rule.current).reduce((sum, word) => sum + count(page.text, word), 0);
      return found ? { state: 'bad', code: 'found', count: found } : { state: 'ok' };
    }
    case 'comparisonTable':
    case 'sideBySide':
    case 'specsTable':
    case 'sizeChart':
      return blocks.some((b) => b.tag === 'table')
        ? { state: 'ok' }
        : { state: 'bad', code: 'missing' };
    case 'proofPerSection': {
      const sections = splitSections(blocks);
      if (!sections.length) return { state: 'bad', code: 'noH2' };
      const proven = sections.filter(
        (s) =>
          s.filter((b) => b.tag === 'blockquote' || (isText(b) && /\d/.test(b.text))).length >= n,
      ).length;
      return atLeast(proven, sections.length);
    }
    case 'useCaseSteps':
    case 'howToSteps':
    case 'measureSteps': {
      // A guide that isn't a how-to (a travel guide, a resource page) has no steps to count.
      if (rule.key === 'howToSteps' && !HOW_TO_TITLE.test(blocks[h1]?.text ?? '')) {
        return { state: 'info', code: 'notHowTo' };
      }
      const most = Math.max(
        0,
        ...blocks.filter((b) => b.tag.startsWith('ol:')).map((b) => Number(b.tag.slice(3))),
      );
      return most ? atLeast(most, n) : { state: 'bad', code: 'missing' };
    }
    case 'fitQuestions': {
      // Read in English only ("fit", "size"): another language's page isn't scored on it.
      if (ctx.language && ctx.language !== 'en') return { state: 'info', code: 'englishOnly' };
      const asked = blocks.filter(
        (b) => isQuestion(b) && /\b(fit|fits|size|sizes|sizing)\b/i.test(b.text),
      ).length;
      // A product with no sizes (a coffee grinder) has no fit to ask about.
      if (!asked && !blocks.some((b) => SIZES.test(b.text))) {
        return { state: 'info', code: 'noSizes' };
      }
      return atLeast(asked, n);
    }
    case 'introText': {
      const words = blocks
        .slice(h1 + 1, firstH2 < 0 ? undefined : firstH2)
        .filter(isText)
        .reduce((sum, b) => sum + b.words, 0);
      return words >= n ? { state: 'ok' } : { state: 'bad', code: 'current', count: words };
    }
    case 'definitionFirst':
      // The term defined at once: "X is …" in a short first paragraph. Read
      // in English words only, so another language's page isn't counted.
      if (ctx.language && ctx.language !== 'en') return { state: 'info', code: 'englishOnly' };
      if (!summary || !summary.words) return { state: 'bad', code: 'missing' };
      if (!definesAtOnce(summary.text)) return { state: 'bad', code: 'missing' };
      return summary.words <= n
        ? { state: 'ok' }
        : { state: 'bad', code: 'words', count: summary.words };
    case 'examplesSection':
      return blocks.some((b) => isHeading(b) && /\bexamples?\b/i.test(b.text))
        ? { state: 'ok' }
        : { state: 'bad', code: 'missing' };
    case 'bestTime':
      return summary && /\bbest time\b/i.test(summary.text)
        ? { state: 'ok' }
        : { state: 'bad', code: 'missing' };
    default:
      return { state: 'info', code: 'aiCheck' };
  }
}

/** The blocks under each H2, up to the next. */
function splitSections(blocks: PageBlock[]): PageBlock[][] {
  const sections: PageBlock[][] = [];
  for (const block of blocks) {
    if (block.tag === 'h2') sections.push([]);
    else if (sections.length && !isHeading(block)) sections[sections.length - 1].push(block);
  }
  return sections;
}

/**
 * Whether the editor's length counter warns: exactly when the Length rule is
 * on and reads short or long, so the counter and the Rules tab never
 * disagree, whatever value or default the rule has.
 */
export function lengthWarns(statuses: { rule: ActiveRule; status: RuleStatus }[]): boolean {
  return statuses.some(
    ({ rule, status }) => rule.key === 'length' && rule.on && status.state === 'bad',
  );
}

/**
 * The least text, in characters, a part the rules ask for takes: a heading
 * with a two-sentence answer under it, a question with a one-sentence
 * answer, a summary of a sentence or two. Kept low on purpose, so a page
 * told they don't fit really can't hold them.
 */
const LEAST_SECTION = 200;
const LEAST_QUESTION = 150;
export const LEAST_SUMMARY = 100;
/** The least answer under a heading, a sentence or two (rewriteFloor). */
export const LEAST_ANSWER = 100;

/**
 * Rules that can't both be met (Content Agent rule gaps, C): the fan-out
 * sections, FAQ questions and summary the rules in effect still ask for, at
 * their least, against the most text Length allows. Null when they fit,
 * when the page already meets them all, or when Length is off. Rules the
 * page can't check yet (no fan-outs) ask for nothing, and a fan-out rule
 * asks for no more fan-outs than there are.
 */
export function lengthConflict(
  statuses: { rule: ActiveRule; status: RuleStatus }[],
  fanouts: number,
): { need: number; max: number } | null {
  const counted: RuleStatus[] = [];
  const asked = (key: string) => {
    const found = statuses.find((s) => s.rule.key === key);
    if (!found?.rule.on || found.status.state === 'info') return 0;
    const n = Number(found.rule.current);
    if (!Number.isFinite(n) || n <= 0) return 0;
    counted.push(found.status);
    return n;
  };
  const length = statuses.find((s) => s.rule.key === 'length')?.rule;
  const target = length?.on ? Number(length.current) : NaN;
  if (!Number.isFinite(target) || target <= 0) return null;
  const need =
    Math.min(asked('fanoutH2'), fanouts) * LEAST_SECTION +
    Math.max(
      asked('faq'),
      asked('buyingFaq'),
      fanouts ? Math.min(asked('fanoutFaq'), fanouts) : 0,
    ) *
      LEAST_QUESTION +
    (asked('summary') ? LEAST_SUMMARY : 0);
  // The page holds them all already: it shows they fit.
  if (counted.every((status) => status.state === 'ok')) return null;
  const { max } = lengthBand(target);
  return need > max ? { need, max } : null;
}

/** How many of the rules in effect are met: off rules and ones the page can't say don't count. */
export function rulesMet(statuses: { rule: ActiveRule; status: RuleStatus }[]): {
  met: number;
  total: number;
} {
  const counted = statuses.filter((s) => s.rule.on && s.status.state !== 'info');
  return { met: counted.filter((s) => s.status.state === 'ok').length, total: counted.length };
}

/** The language a draft's own Language rule names, when it is on and set. */
export function draftLanguage(rules: unknown): string | null {
  const language = draftRulesSchema.safeParse(rules).data?.overrides.language;
  const value = language?.on === false ? '' : (language?.value?.trim() ?? '');
  return value || null;
}
