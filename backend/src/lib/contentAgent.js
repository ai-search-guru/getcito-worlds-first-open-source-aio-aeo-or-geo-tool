import { randomUUID } from 'crypto';
import { NoObjectGeneratedError, generateObject } from 'ai';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { brandRulesSection } from './brandRules.js';
import { readBrandRules } from './brandRulesRead.js';
import { resolveModel } from './aiProvider.js';
import {
  CONTENT_WRITE_MAX_TOKENS,
  contentReadModelId,
  contentWriteModelId,
  rebuildSources,
} from './contentBrief.js';
import { inputSources, readDraftInputs } from './contentInputs.js';
import { RESEARCH_RULE, lookUpSuggestionFacts, pageOwn, withFactLinks } from './contentResearch.js';
import { HEALTH_RULE, addsHealthClaim, healthGuard, withoutHealthFinds } from './contentHealth.js';
import { linkAllowList, linkKey, linkTargetsPrompt, readLinkTargets } from './contentLinks.js';
import { shoppingGiven, shoppingPathFor, withShopping } from './shoppingLinks.js';
import { siteTypeLine, pageTypeFormat } from './contentPageTypes.js';
import {
  NOT_NAMES,
  SPEECH,
  authorWords,
  editLines,
  guardPeopleInHtml,
  isKnown,
  isRole,
  knownPeople,
} from './contentPeople.js';
import {
  RunStoppedError,
  advanceRun,
  dropRun,
  finishRun,
  fixUnderWay,
  isStop,
  runCall,
  startRun,
  stopIfStopped,
} from './contentRuns.js';
import {
  SOURCES_RULE,
  htmlText,
  knownNumbers,
  marksField,
  numberSources,
  sourceSuggestion,
  sourceWords,
  sourcesField,
  sourcesPrompt,
  stripSourceIds,
  textPieces,
  todayText,
  withNamedNumbers,
} from './contentSources.js';
import { draftLanguage } from './contentLanguage.js';
import { editSpans } from './editSpans.js';
import { getLanguageName } from './languages.js';
import { PlanLimitError, reserveAiBudget } from './planGuard.js';
import { carefulLine, carefulRules } from './contentSuggestionStats.js';
import { livePageLine, readLivePage } from './contentLivePage.js';
import { logger } from './logger.js';
import { objectOptions } from './structuredOutput.js';

/**
 * Fix open rules with agent (Content Editor CE-018, spec §8): the Content
 * Agent reads the draft as saved and the rules it doesn't meet yet, and
 * leaves suggestions for a person to review (content_draft_suggestions,
 * 00217) — never changes to the page itself. A suggestion replaces words in
 * one passage, or adds blocks after one, and names the rules it fixes. The
 * passages AI answers quote today (locked, CE-018) are never changed. It
 * writes from the sources the Sources tab keeps and says which each change
 * used (v1.1 CE-033, contentSources.js). It is metered from the
 * organization's AI usage, as the brief is.
 */

/** The most suggestions one run leaves. */
export const MAX_AGENT_SUGGESTIONS = 8;

/** How long the model may take: the editor waits for it. */
const CALL_TIMEOUT_MS = 60_000;

/** The most links one replace keeps (after_links, 00240). */
const MAX_LINKS = 20;

/** The longest passage the agent may change: keepSuggestions skips longer ones. */
const MAX_PASSAGE_CHARS = 5_000;

/**
 * How long an agent may make a heading, by level: an H1 around 50–60
 * characters, an H2 8–15 words, as 2026's SEO/AEO guides advise. Longer, it
 * has taken in an answer. The same as HEADING_LIMITS in
 * frontend/src/lib/content/suggestions.ts; a person's own headings are never held.
 */
export const HEADING_LIMITS = { h1: 70, other: 90 };

/** The longest an agent may make a heading of this tag. */
export const headingLimit = (tag) => (tag === 'h1' ? HEADING_LIMITS.h1 : HEADING_LIMITS.other);

/** The headings rule both agent prompts give the model (fix rules, Start Agent). */
export const HEADING_RULE = `- A heading stays a heading: one short line, an H1 up to ${HEADING_LIMITS.h1} characters and other headings up to ${HEADING_LIMITS.other}. Never write an answer, a sentence or a FAQ into a heading's replace; to answer under a heading, insert a paragraph after it.`;

/** The fan-outs rule both agent prompts give the model: the ones named, in their words. */
export const FANOUT_RULE = `- Fan-outs are the searches AI engines run for the page's questions. For each fan-out a rule names, in its words ("aeo tracker" → "What is an AEO tracker?"), not questions of your own: fanoutH2 wants an H2, fanoutFaq a question ending in "?" under the FAQ heading. Add it as its own question: after the paragraph that ends an existing answer, insert a heading at the level of the FAQ's other questions (an H3 under an H2 FAQ) and a paragraph that answers it. Reword an existing question into a fan-out's words only when its answer still answers it, replacing that question alone. One question per heading: never add a question to a heading. Call a change a fan-out answer only when it uses a fan-out listed.`;

/** The links rule both agent prompts give the model: only the URLs listed, never invented. */
export const LINK_RULE = `- Links: link only to a URL listed under the pages or sources you may link to, copied exactly, as <a href="URL">the words it explains</a>, in a replace's "after" or in an insert. Cite a source by linking the words it supports. Never invent a URL, never link a heading, and when no listed page fits, add no link.`;

/** What the agent may say of a source, and the names a list keeps (editor test 2026-10-25). */
export const ATTRIBUTION_RULE = `- Never give a claim to a source that neither the page nor Your input gives ("According to X…", "X says…", "X found that…"): you don't see what a cited page or a link says. A link goes on the words it explains, never as a source for a claim. Keep every name a list has (products, brands, people): never drop one.`;

/** The shortest answer a heading's replace may carry for it to go under the heading. */
const MIN_ANSWER_CHARS = 40;

/**
 * How much of the page the model reads, in characters: a very long page is
 * sent up to here, so one run can't spend far past the AI usage budget.
 */
export const MAX_PROMPT_PASSAGE_CHARS = 60_000;

/** How many of a draft's newest suggestions are read to find its latest batch. */
const LATEST_BATCH_ROWS = 50;

/** What the editor sends: the rules still open, and the passages it keeps locked. */
export const fixRulesInput = z.object({
  rules: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        name: z.string().trim().min(1).max(200),
        /** What the rule asks and how the page reads now: "aim 3,000 characters · 2,610". */
        detail: z.string().trim().max(500).default(''),
      }),
    )
    .min(1)
    .max(40),
  /** Rules in the person's own words, to follow as well. */
  textRules: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  /** The locked passages, by passageKey. */
  locked: z.array(z.string().max(5000)).max(500).default([]),
  /** The sources the Sources tab keeps (v1.1 CE-033); none from an older editor. */
  sources: rebuildSources.optional(),
  /**
   * The page past its Length when Length isn't among the rules (held for the
   * person, or not picked: editor test 2026-10-26): its characters and the
   * most it may have, so what the agent adds for the other rules stays short.
   * A hint, never a reason to refuse the run: a value out of range (a Length
   * of 0 reads every page as long, at most 0) is dropped.
   */
  overLength: z
    .object({
      count: z.number().int().min(0).max(10_000_000),
      max: z.number().int().min(1).max(10_000_000),
    })
    .optional()
    .catch(undefined),
});

export const suggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        kind: z.enum(['replace', 'insert']),
        passage: z
          .number()
          .int()
          .describe('The number of the passage it changes, or the one it adds blocks after.'),
        before: z
          .string()
          .describe(
            'replace: the words of that passage to change, copied exactly as written; insert: an empty string.',
          ),
        after: z
          .string()
          .describe(
            `replace: the new words, as plain text with links only as <a href> to the URLs listed (a heading stays one line: an H1 up to ${HEADING_LIMITS.h1} characters, others up to ${HEADING_LIMITS.other}); insert: the blocks to add, as simple HTML (h2, h3, p, ul, ol, li, strong, em, a).`,
          ),
        reason: z.string().describe('What the change does, in a few words.'),
        rules: z.array(z.string()).describe('The keys of the rules it fixes.'),
        sources: sourcesField,
        marks: marksField,
      }),
    )
    .max(MAX_AGENT_SUGGESTIONS),
});

export const SYSTEM_PROMPT = `You are the Content Agent for Answer Engine Optimization (AEO). You improve one web page so it meets its writing rules, by suggesting small changes that a person reviews.

Rules for your suggestions:
- Fix only the rules listed. Each suggestion fixes one or more of them; put their keys in "rules".
- A replace changes words inside one passage: copy "before" exactly as that passage has it (a phrase or a sentence), and write "after" as plain text that fits in its place, with links only as the links rule below says.
- An insert adds new blocks after a passage, as simple HTML (h2, h3, p, ul, ol, li, strong, em, and a for links).
${HEADING_RULE}
${LINK_RULE}
${FANOUT_RULE}
- Never change a passage marked LOCKED: AI assistants quote its wording today. You may insert after it.
- Use only facts from the page, the brand and your data, and the ones you ask to have looked up. Never invent numbers, prices, dates, names, sources or quotes.
${RESEARCH_RULE}
${HEALTH_RULE}
${SOURCES_RULE}
${ATTRIBUTION_RULE}
- Keep the page's voice and change as little as each rule needs. At most ${MAX_AGENT_SUGGESTIONS} suggestions.
- "reason" says in a few words what the change does and why, e.g. "add a dated data point (rule)".
- Write in the language asked for.`;

/**
 * A text's words as the editor compares passages, one space apart: the same
 * as passageKey in frontend/src/lib/content/citedPassages.ts.
 */
export function passageKey(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(' ');
}

/** The page's passages as the editor reads them: headings and paragraphs, in order. */
export function draftPassages(html) {
  const $ = cheerio.load(html || '', null, false);
  const passages = [];
  $('h1, h2, h3, h4, h5, h6, p').each((_, el) => {
    const text = $(el).text();
    if (text.trim()) passages.push({ tag: el.tagName.toLowerCase(), text });
  });
  return passages;
}

const INSERT_TAGS = new Set([
  'h2',
  'h3',
  'h4',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'br',
]);

/**
 * An insert's HTML kept to the blocks the editor takes from an agent, with
 * no attributes; anything else is unwrapped to its text. A link stays only
 * to a URL in `links` (linkAllowList), with that URL, and never in a heading.
 * The editor checks it again where it is inserted, and every save checks the
 * page.
 */
export function cleanInsertHtml(html, links = null) {
  const $ = cheerio.load(html || '', null, false);
  $('script, style, iframe, object, embed, noscript, template, head, title').remove();
  // The page has its H1, its title: an agent's heading is an H2 at most.
  $('h1').each((_, el) => {
    el.name = 'h2';
  });
  for (const el of $('*').get().reverse()) {
    const tag = el.tagName?.toLowerCase();
    const href = tag === 'a' && links ? links.get(linkKey(el.attribs?.href)) : undefined;
    const inHeading = $(el).parents('h1, h2, h3, h4, h5, h6').length > 0;
    if (href && !inHeading && $(el).text().trim()) {
      for (const name of Object.keys(el.attribs ?? {})) $(el).removeAttr(name);
      $(el).attr('href', href);
      continue;
    }
    if (!INSERT_TAGS.has(tag)) {
      $(el).replaceWith($(el).contents());
      continue;
    }
    for (const name of Object.keys(el.attribs ?? {})) $(el).removeAttr(name);
  }
  return $.html().trim();
}

/**
 * Inline HTML's words and the links on them, { text, links: [{ start, end,
 * href }] } with offsets into the text: runs of spaces and line breaks
 * collapsed to one space (a non-breaking space stays), trimmed.
 */
export function inlineText(html) {
  const $ = cheerio.load(html || '', null, false);
  let text = '';
  const links = [];
  const add = (data) => {
    const piece = data.replace(/[ \t\r\n\f]+/g, ' ');
    text += text === '' || text.endsWith(' ') ? piece.replace(/^ /, '') : piece;
  };
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') add(node.data);
      if (node.type !== 'tag') continue;
      if (node.name === 'br') {
        add(' ');
        continue;
      }
      const start = text.length;
      walk(node.children ?? []);
      if (node.name !== 'a' || !node.attribs?.href) continue;
      let from = start;
      let to = text.length;
      while (from < to && text[from] === ' ') from++;
      while (to > from && text[to - 1] === ' ') to--;
      if (to > from) links.push({ start: from, end: to, href: node.attribs.href });
    }
  };
  walk($.root().contents().get());
  const trimmed = text.replace(/ +$/, '');
  return { text: trimmed, links: links.filter((link) => link.end <= trimmed.length) };
}

const textOf = (html) =>
  cheerio
    .load(html || '', null, false)
    .root()
    .text();

/**
 * HTML's lines as text, as the guards read them (editLines): each block and
 * each line break apart, a line's inline tags read with it ("<a>Gartner</a>'s
 * report" whole).
 */
export function htmlLines(html) {
  const lines = [];
  editLines(cheerio.load(html || '', null, false), (text) => {
    lines.push(text);
    return [];
  });
  return lines;
}

const isHeading = (tag) => /^h[1-6]$/.test(tag);

/** A question, then what follows it: "?" before a space, or a full-width "？". */
const QUESTION_AND_ANSWER = /^([\s\S]+?(?:\?(?=\s)|？))\s*(\S[\s\S]*)$/;
/** How an answer ends: a sentence. */
const ANSWER_END = /[.!。！]$/;
/** What follows a heading's question may open with another question, not an answer. */
const OPENS_WITH_QUESTION = /^[^.!?。！？]*(?:\?(?=\s|$)|？)/;
/** Each question's end: "?" before a space or at the end, or a full-width "？". */
const QUESTION_MARKS = /\?(?=\s|$)|？/g;
const questionsIn = (text) => (text.match(QUESTION_MARKS) ?? []).length;

/** Where the first block of a cleaned HTML starts. */
const BLOCK_START = /<(?:h[2-4]|p|ul|ol|li)>/;

/** Whether a replace grows a heading past its limit: one already longer may still be shortened. */
export function growsPastLimit(passage, before, words) {
  if (!isHeading(passage.tag)) return false;
  const now = passage.text.trim().length;
  const then = passage.text.replace(before, () => words).trim().length;
  return then > headingLimit(passage.tag) && then > now;
}

/**
 * Attributions a change can write: "According to Zapier…", "as reported by
 * Gartner", "per Forrester", "Zapier says…", "Zapier found that…", "laut
 * Zapier", "Zapier'e göre". The agent never sees what a cited page or a link
 * says (SOURCES_RULE), so one it adds puts a claim in a source's mouth
 * (editor test 2026-10-25: an AI Overview's claim given to Zapier).
 */
// A capitalised word of a name, starting a word: a dot inside it ("Node.js")
// or after an initial ("U.S."), never the one that ends its sentence
// ("…according to Gartner. The plan"). A dot is taken one way only: an
// initial's is one no letter follows, so a run of initials ("U.S.U.S.…")
// is read in linear time, never tried both ways at each dot.
const NAME_DOT = String.raw`\.(?=[\p{L}\p{N}])|(?<=(?:^|[^\p{L}\p{N}]|\.)\p{Lu})\.(?![\p{L}\p{N}])`;
/** The most words a source's name is read with: a run of capitalised words past it isn't one. */
const MAX_NAME_WORDS = 8;
const NAME_WORD = String.raw`(?<![\p{L}\p{N}&'’.-])\p{Lu}(?:[\p{L}\p{N}&'’-]|${NAME_DOT})*`;
// A name as an attribution gives it: capitalised words, after an article
// or a year ("the Zapier report", "a 2025 Gartner survey").
const SOURCE_NAME = String.raw`(?<name>(?!(?:The|This|That|These|Those|Our|Their|Its|Your|My|His|Her|We|They|It|A|An)\b)${NAME_WORD}(?:\s+${NAME_WORD}){0,${MAX_NAME_WORDS - 1}})`;
/** A name before a Turkish ending ("Google Analytics'e göre"): capitalised words, a few at most. */
const TR_WORD = String.raw`(?<![\p{L}\p{N}.-])\p{Lu}(?:[\p{L}\p{N}-]|${NAME_DOT})*`;
const TR_NAME = String.raw`(?<name>${TR_WORD}(?:\s+${TR_WORD}){0,2})`;
/** A name shaped as one, sentence's start or not: an acronym (TÜİK, GA4) or a capital after a small letter (HubSpot). */
const TR_SHAPED = String.raw`(?<name>(?<![\p{L}\p{N}.-])\p{Lu}(?:[\p{Lu}\p{N}]+(?![\p{Ll}])|(?=[\p{L}\p{N}]*?(?:\p{Ll}\p{Lu}|\p{L}\p{N}))[\p{L}\p{N}]+))`;
/** A source's report, study, data or survey "göre": a year or a small word before it. */
const TR_REPORT = String.raw`(?:(?:\d{4}|\p{Ll}+)\s+)?(?:raporuna|araştırmasına|verilerine|anketine|çalışmasına|açıklamasına)\s+göre\b`;
/** German articles and possessives before a noun ("dem Bericht", "unseren Messungen"). */
const DE_DET = String.raw`(?:[Dd](?:em|er|en|ie|as|es)|[Ee]in(?:e|er|em|en|es)?|[Uu]nser(?:e|er|em|en|es)?|[Ii]hr(?:e|er|em|en|es)?|[Nn]euesten|[Aa]ktuellen|[Jj]üngsten)`;
/**
 * Turkish words a sentence starts with before a source's name ("Ancak
 * Gartner'a göre", "Son raporuna göre"): read past by the attributions only,
 * never by the people guard ("Son Heung-min").
 */
const TR_SENTENCE_WORDS = new Set(
  'ancak ama fakat ayrıca bu şu bir ve ile son yeni özellikle'.split(' '),
);
const LEAD = String.raw`(?:(?:the|a|an)\s+)?(?:\d{4}\s+)?`;
/**
 * A pattern that starts with a name, run only on a text with its trigger
 * word: tried at each capital, it would read a long line of capitalised
 * words in time adding up across the patterns (#1544 review).
 */
const when = (trigger, re) => Object.assign(re, { trigger });
/** Up to three small words before a report's noun, none a product's or the reader's ("this", "your"). */
const SMALL_WORDS = String.raw`(?:(?!(?:your|this|our|each|these|those|that|my|their)\b)[\p{Ll}\p{N}]+\s+){0,3}`;
/** "report by Gartner", "survey from a 2025 Statista": a source's report and its name. */
const REPORT_FROM = String.raw`(?:[Rr]eport|[Ss]tudy|[Ss]urvey|[Pp]aper|[Pp]oll)\s+(?:by|from)\s+${LEAD}${SOURCE_NAME}`;
/**
 * Words that speak to the reader ("you can see…"), or tell them what to do
 * in a tool ("filter by channel", "open the report"): a how-to, not a claim.
 * A verb only as one, before a small word: never a noun's ("open rates",
 * "use cases", "add-on sales", "download numbers").
 */
const TO_READER = String.raw`(?:(?:you|your|yours|you['’](?:re|ll|ve|d))\b|(?:open|click|select|filter|go|choose|use|look|see|check|find|navigate|scroll|set|add|export|download|sort|compare)(?![\p{L}'’-])\s+(?:the|a|an|by|to|on|in|at|for|your|this|it|out)\b)`;
/** Kinds of report an acronym names, never a source ("SEO raporuna göre", "PDF raporuna göre"). */
const TR_REPORT_KINDS = String.raw`(?!(?:SEO|PDF|KPI|CRM|ERP)(?![\p{L}\p{N}]))`;
const ATTRIBUTIONS = [
  new RegExp(String.raw`\b[Aa]ccording to\s+${LEAD}${SOURCE_NAME}`, 'gu'),
  new RegExp(
    String.raw`\b[Aa]s\s+(?:reported|noted|stated|found)\s+by\s+${LEAD}${SOURCE_NAME}`,
    'gu',
  ),
  when(/\b(?:says|said)\b/, new RegExp(String.raw`${SOURCE_NAME}\s+(?:says|said)\b`, 'gu')),
  // "Claims" and "states" are nouns too ("Warranty claims are…", "all 50
  // US states"): those, as "reports" and the rest, only before "that".
  when(
    /\b(?:reports|reported|notes|noted|finds|found|estimates|estimated)\s+that\b/,
    new RegExp(
      String.raw`${SOURCE_NAME}\s+(?:reports|reported|notes|noted|finds|found|estimates|estimated)\s+that\b`,
      'gu',
    ),
  ),
  // …and never a run of names counted ("all 50 US states that allow…", "most
  // US states that", "Most US states that", "In most of the US states that",
  // "the 48 contiguous US states that"), or one read from the middle of a name ("New England states
  // that"); small words between only after a number or "all", so "In some
  // cases Gartner states that" is read. A capital first, as below: a
  // lookbehind ending in a run of spaces isn't tried at each of them.
  when(
    /\b(?:claims|claimed|states|stated)\s+that\b/,
    new RegExp(
      String.raw`(?=\p{Lu})(?<!(?:\b(?:[Aa]ll|\d{1,3})(?:\s+\p{Ll}+){0,2}|\b(?:[Mm]ost|[Mm]any|[Ss]ome|[Ss]everal|[Bb]oth|[Ee]very)(?:\s+of\s+the)?|\p{Lu}[\p{L}\p{N}&.'’-]*)\s+)(?!(?:All|Most|Many|Some|Several|Both|Every)\b)${SOURCE_NAME}\s+(?:claims|claimed|states|stated)\s+that\b`,
      'gu',
    ),
  ),
  // "shows" only before "that" or a figure: a tool's report shows things
  // too ("The Search Console report shows clicks", "GA4's Acquisition report
  // shows where…").
  when(
    /\b(?:report|study|survey|research|data|analysis)\s+(?:shows|showed|finds|found|says|said|suggests)\b/,
    new RegExp(
      String.raw`${SOURCE_NAME}(?:['’]s)?\s+(?:report|study|survey|research|data|analysis)\s+(?:(?:shows|showed)(?=\s+(?:that\b|\p{N}))|(?:finds|found|says|said|suggests)\b)`,
      'gu',
    ),
  ),
  // Never the maker's own words, a manual or the page's own, as product
  // pages give them ("laut Hersteller", "laut Herstellerangaben", "laut
  // Angaben des Herstellers", "laut Datenblättern", "laut Anleitung"), in a
  // compound too ("laut Produktdatenblatt", "laut Packungsbeilage", "laut
  // Kundenbewertungen").
  new RegExp(
    String.raw`\b[Ll]aut\s+${LEAD}(?![\p{L}-]*?(?:[Hh]ersteller|[Dd]atenbl|[Aa]nleitung|[Bb]eschreibung|[Gg]esetz|[Aa]ngaben|[Bb]eilage|[Bb]ewertungen))${SOURCE_NAME}`,
    'gu',
  ),
  // "nach Angaben von Gartner", "laut Angaben des Statistischen
  // Bundesamtes", never the maker's ("des Herstellers").
  new RegExp(
    String.raw`\b(?:[Nn]ach|[Ll]aut)\s+Angaben\s+(?:von|des|der)\s+${LEAD}(?!Hersteller)${SOURCE_NAME}`,
    'gu',
  ),
  // "Gartner zufolge"; never a noun German capitalises: after an article,
  // with an adjective or not ("Dem Bericht zufolge", "Einer Studie zufolge",
  // "Einer neuen Studie zufolge"; a verb's ending is no adjective's: "Die
  // Ausgaben sollen Gartner zufolge steigen") or a plural ("Berichten",
  // "Herstellerangaben", "Insidern zufolge"), the cost a name like Nielsen
  // pays. A capital first: the lookbehind ends in a run of spaces, and tried
  // at each of a long run's, it would read it in time growing with its square.
  when(
    /\bzufolge\b/,
    new RegExp(
      String.raw`(?=\p{Lu})(?<!\b${DE_DET}(?:\s+\p{Ll}+(?:en|em|er|es))?\s+)(?!${DE_DET}\b|Hersteller)${SOURCE_NAME}(?<!\p{Ll}(?:en|ern))\s+zufolge\b`,
      'gu',
    ),
  ),
  // "As Zapier notes, …", "As Zapier puts it, …": the verb then a comma or
  // "that", never an event ("As Google adds AI Overviews to more queries").
  new RegExp(String.raw`\b[Aa]s\s+${LEAD}${SOURCE_NAME}\s+${SPEECH}(?=\s*[,:]|\s+that\b)`, 'gu'),
  // "a survey from Statista finds": as a claim's source, never a thing to get
  // ("Download the report from Gartner."); "shows" only before "that" or a
  // figure, as a tool's report shows things too ("The Performance report
  // from Google Search Console shows clicks"). One short aside may come
  // before the verb ("A 2025 report by Gartner, published in May, found…"),
  // bounded so the read stays linear.
  new RegExp(
    String.raw`\b(?:[Rr]eport|[Ss]tudy|[Ss]urvey|[Pp]aper|[Pp]oll)\s+(?:by|from)\s+${LEAD}${SOURCE_NAME}(?=(?:\s*,[^,.!?;]{1,80},)?\s+(?:(?:shows?|showed)\s+(?:that\b|\p{N})|(?:finds|found|says|said|suggests?|suggested|reveals?|revealed|estimates?|estimated)\b))`,
    'gu',
  ),
  // "In a 2025 report by Gartner, …", "According to a survey from Statista,
  // …": the comma only after "according to", "per" or a sentence's "In",
  // with small words between that aren't a product's or the reader's ("In
  // this report from Google Search Console, you can…", "In the Performance
  // report from…"), never a product's sentence ("Send a survey from
  // Typeform, Jotform or Google Forms"). The noun is looked for first: a
  // lookbehind ending in a run of spaces, tried at each of them, would read
  // a long run in time growing with its square.
  new RegExp(
    String.raw`(?=(?:[Rr]eport|[Ss]tudy|[Ss]urvey|[Pp]aper|[Pp]oll)\s)(?<=(?:\b[Aa]ccording\s+to|\b[Pp]er)\s+${SMALL_WORDS})${REPORT_FROM}(?=\s*,)`,
    'gu',
  ),
  // A sentence's "In …," only when the reader isn't spoken to after the
  // comma: then it's a tool's report ("In the report from Google Search
  // Console, you can see…", "In a report from Google Analytics, filter by
  // channel").
  new RegExp(
    String.raw`(?=(?:[Rr]eport|[Ss]tudy|[Ss]urvey|[Pp]aper|[Pp]oll)\s)(?<=(?:^|[.!?]\s+)In\s+${SMALL_WORDS})${REPORT_FROM}(?=\s*,(?!\s*${TO_READER}))`,
    'gu',
  ),
  // "data from Statista shows that …" or a figure, never a tool's ("Data
  // from GA4 shows where visitors come from").
  new RegExp(
    String.raw`\b(?:[Dd]ata|[Ff]igures|[Nn]umbers|[Ss]tatistics)\s+from\s+${LEAD}${SOURCE_NAME}\s+(?:shows?|showed|finds|found|suggests?|suggested|reveals?|revealed)(?=\s+(?:that\b|\p{N}))`,
    'gu',
  ),
  // "laut einer (aktuellen) Studie von Gartner": by "von" only, as German
  // writes every noun with a capital ("laut der Anleitung des Herstellers").
  new RegExp(
    String.raw`\b[Ll]aut\s+(?:einer|einem|der|dem|des)\s+(?:\p{L}+\s+){1,2}von\s+${LEAD}${SOURCE_NAME}`,
    'gu',
  ),
  // "Gartner'ın raporuna göre": a source's report, study, data or survey.
  // A year or a word before the noun ("Gartner'ın 2025 raporuna", "son
  // raporuna"), a name of more words than one ("Google Analytics").
  when(/göre/, new RegExp(String.raw`${TR_NAME}['’]\p{L}{1,3}\s+${TR_REPORT}`, 'gu')),
  // Without its ending ("Gartner raporuna", "TÜİK verilerine"): a name in
  // the sentence, or one shaped as a name (TÜİK, GA4, HubSpot), never a
  // sentence's first noun ("Ürün açıklamasına göre", "Sipariş verilerine").
  // A capital first, so the lookbehind isn't tried in a run of spaces.
  // A list's number isn't the sentence's ("1) Ürün açıklamasına göre").
  // Never a kind of report's acronym, here or below ("Aylık SEO raporuna göre").
  when(
    /göre/,
    new RegExp(
      String.raw`(?=\p{Lu})(?<=[^\s.!?:)]\s+)${TR_REPORT_KINDS}${TR_NAME}\s+${TR_REPORT}`,
      'gu',
    ),
  ),
  when(/göre/, new RegExp(String.raw`${TR_REPORT_KINDS}${TR_SHAPED}\s+${TR_REPORT}`, 'gu')),
  // "Gartner'a göre", never a comparison ("ChatGPT'ye göre daha hızlı");
  // "en" after it is the source's claim ("Gartner'a göre en hızlı büyüyen").
  when(/göre/, new RegExp(String.raw`${TR_NAME}['’]\p{L}{1,3}\s+göre\b(?!\s+daha\b)`, 'gu')),
];

/**
 * "Per Gartner, …", "per Gartner's survey", "…, per Gartner.": read on an
 * English page only, as German writes "per E-Mail", "per App" (an English
 * "Per SKU, you pay…" still reads as one: an acronym may be a source too,
 * "Per IDC, …").
 */
const PER_ATTRIBUTIONS = [
  new RegExp(String.raw`\bPer\s+${LEAD}${SOURCE_NAME}(?=\s*,)`, 'gu'),
  new RegExp(String.raw`\b[Pp]er\s+${LEAD}${SOURCE_NAME}(?=['’]s\b)`, 'gu'),
  new RegExp(String.raw`,\s*per\s+${LEAD}${SOURCE_NAME}(?=\s*[.;!?]|\s*$)`, 'gu'),
];

/** The attributions read on a page in this language: "per" on an English one (or one not said). */
const attributionsFor = (language) =>
  !language || /^en\b/i.test(language) ? [...ATTRIBUTIONS, ...PER_ATTRIBUTIONS] : ATTRIBUTIONS;

/**
 * The sources a claim may be given to on a page: the names it gives claims
 * to already, Brief › Your input's (an expert, the person's own data) and
 * the workspace's authors.
 */
export function attributableSources(pageHtml, numbered, authors = [], language = null, own = []) {
  const inputs = numbered.filter((s) => s.kind === 'input').map(sourceWords);
  return {
    // Read line by line, as a change's blocks are (htmlLines).
    ...knownPeople(
      ...htmlLines(pageHtml).flatMap((line) => attributedNames(line, language)),
      ...inputs,
      ...authors,
      // The brand's own: its report or data says what it says ("A weekly report from Acme").
      ...own,
    ),
    language,
  };
}

/** Each attribution a text writes: the name it gives a claim to, and where. */
function attributionsIn(text, language = null) {
  const found = [];
  const s = String(text);
  for (const re of attributionsFor(language)) {
    if (re.trigger && !re.trigger.test(s)) continue;
    for (const match of s.matchAll(re)) {
      const name = match.groups?.name ?? '';
      // A sentence's words alone ("Who says", "Son raporuna göre") name no one.
      if (name && nameStart(name) < name.length) {
        found.push({ name, index: match.index + match[0].indexOf(name) });
      }
    }
  }
  return found;
}

/** The names a text gives claims to: the sources the page already attributes to. */
export function attributedNames(text, language = null) {
  return attributionsIn(text, language).map((a) => a.name);
}

/**
 * Where a name's own words start: past the words a sentence starts with, a
 * role or an adverb ("As Zapier", "CEO Jane Doe", "Recently Gartner"), as
 * personIn (contentPeople.js) reads a person's. Its last word is the name
 * when it is an "-ly" word or a capitalised role ("Grammarly", "Coach"),
 * never a sentence's word ("Who says", "Most said") or "CEO" alone.
 */
function nameStart(name) {
  const words = [...name.matchAll(/\S+/g)];
  for (const [i, word] of words.entries()) {
    const lower = word[0].toLowerCase();
    // A sentence's word, never an acronym written as one ("According to AMA").
    if ((NOT_NAMES.has(lower) || TR_SENTENCE_WORDS.has(lower)) && !/^\p{Lu}{2,}$/u.test(word[0])) {
      continue;
    }
    const ly = /^\p{L}+ly$/u.test(lower);
    if (!ly && !isRole(lower)) return word.index;
    if (i === words.length - 1 && (ly || /^\p{Lu}\p{Ll}+$/u.test(word[0]))) return word.index;
  }
  return name.length;
}

/**
 * Whether a name is one the agent was given (`known`, knownPeople): its own
 * words (nameStart), without a possessive ("Gartner's latest survey"),
 * whole or their end of two words at least ("Acme CEO Jane Doe": "Jane
 * Doe"). "Forrester Research" isn't known for the word "research" in a bio.
 */
function knownName(name, known) {
  const words = name
    .slice(nameStart(name))
    .replace(/['’]\p{L}{0,3}$/u, '')
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; words.length - i >= (i === 0 ? 1 : 2); i++) {
    if (isKnown(words.slice(i).join(' '), known)) return true;
  }
  return false;
}

/** How many claims a text gives to a source the agent wasn't given. */
function attributions(text, known) {
  return attributionsIn(text, known?.language).filter((a) => !known || !knownName(a.name, known))
    .length;
}

/**
 * Whether a change gives more claims to a source the agent wasn't given than
 * the passage did (an insert: than none). Given: one the page attributes to
 * already, an expert from Brief › Your input, an author (`known`).
 */
export function addsAttribution(before, words, known = null) {
  return attributions(words, known) > attributions(before, known);
}

/**
 * A text with each claim given to a source the agent wasn't given put as a
 * placeholder ("According to [source], …"): for a page rewritten whole,
 * where dropping it would drop the page.
 */
export function placeholderAttributions(text, known = null) {
  const s = String(text);
  let out = '';
  let at = 0;
  for (const e of attributionEdits(s, known)) {
    out += s.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + s.slice(at);
}

/**
 * Each claim a text gives to a source the agent wasn't given, as an edit
 * that puts the name's own words as "[source]" (a sentence's first word
 * before it stays: "As [source] says"), apart and in order: a name two
 * wordings read ("As Zapier says") goes once.
 */
function attributionEdits(text, known) {
  const { spans: edits, free, add } = editSpans();
  for (const { name, index } of attributionsIn(text, known?.language)) {
    if (known && knownName(name, known)) continue;
    const start = index + nameStart(name);
    // The possessive stays when a word follows it ("According to [source]'s
    // latest survey"); a name that is one goes whole ("According to
    // McDonald's, sales rose": "[source], sales rose").
    const owner = /^\s+[\p{L}\p{N}]/u.test(
      text.slice(index + name.length, index + name.length + 3),
    );
    const end = index + (owner ? name.replace(/['’]\p{Ll}{1,3}$/u, '') : name).length;
    if (start >= end || !free(start, end)) continue;
    add({ start, end, text: '[source]' });
  }
  return edits;
}

/**
 * An HTML page with each claim given to a source the agent wasn't given put
 * as a placeholder, line by line in its words (editLines): a name linked to
 * its page ("According to <a>Zapier</a>, …") is read, and an entity is read
 * as its character ("AT&T"). The HTML as it was when there's none.
 */
export function placeholderAttributionsInHtml(html, known = null) {
  const $ = cheerio.load(html || '', null, false);
  if (!editLines($, (text) => attributionEdits(text, known))) return html;
  // A link whose words all became the placeholder would still give the claim to its page.
  $('a').each((_, el) => {
    if ($(el).text() === '[source]') $(el).replaceWith('[source]');
  });
  return $.html();
}

// A list of names: two or more capitalised items with commas and an "and"
// ("GetCito, Profound and LLM Pulse"; und, ve, et, y…), or three with
// commas; a dot only inside a word, as in a source's name.
const ITEM_WORD = String.raw`(?<![\p{L}\p{N}&+'’.-])\p{Lu}(?:[\p{L}\p{N}&+'’-]|${NAME_DOT})*`;
const ITEM = String.raw`${ITEM_WORD}(?:\s+${ITEM_WORD}){0,${MAX_NAME_WORDS - 1}}`;
const AND = String.raw`(?:and|or|&|und|oder|ve|veya|ile|et|ou|y|o|e|en|of)`;
const NAME_LIST = new RegExp(
  String.raw`(?:${ITEM}\s*,\s*)+${ITEM},?\s+${AND}\s+${ITEM}|(?:${ITEM}\s*,\s*){2,}${ITEM}`,
  'gu',
);
const ITEM_RE = new RegExp(ITEM, 'gu');
// Two names ("ChatGPT and Claude", "Shopify & WooCommerce"), read as a list
// only when one is shaped as a product's or a brand's (a capital after a small
// letter): "Sales and Marketing", "SEO and AEO", "B2B and B2C" are terms.
const TWO_NAMES = new RegExp(
  String.raw`${ITEM}\s+(?:and|or|&|und|oder|ve|veya|ile|et|ou)\s+${ITEM}`,
  'gu',
);
const BRANDISH = /\p{Ll}\p{Lu}/u;

/** The lists of names a text has: three or more, and two shaped as a brand's. */
function nameLists(text) {
  const twos = (text.match(TWO_NAMES) ?? []).filter((pair) =>
    (pair.match(ITEM_RE) ?? []).some((item) => BRANDISH.test(item)),
  );
  return [...(text.match(NAME_LIST) ?? []), ...twos];
}

/**
 * The words the Banned words rule lists, as the editor's detail sends them:
 * "aim: seamless, leverage" then " · now: 3 found" (frontend/src/lib/content/
 * agentWrite.ts, useRuleDescriber; en.json rules.agent.aim). Empty without
 * the rule, or without its aim (an empty list): never the count.
 */
export function bannedWordsOf(rules = []) {
  const detail = rules.find((r) => r.key === 'bannedWords')?.detail ?? '';
  const aim = detail.split(' · ')[0].match(/^aim:\s*(.*)$/i);
  return (aim?.[1] ?? '')
    .split(/[,;]/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * Whether a replace drops a name from a list the passage has: a product, a
 * brand or a person left out of a claim changes the claim (editor test
 * 2026-10-25: Claude dropped from the engines a tool tracks). Only names in
 * a list: a capitalised word alone may be any noun (German), an acronym or a
 * month. Each item the replace touches is read in the passage as changed,
 * the blocks it adds too, by its last word, whole and in any case, without
 * a possessive or a case ending ("Ask ChatGPT" → "ask ChatGPT", "Claude's"
 * → "Claude", "Claude'u" → "Claude'da"). Two names count as a list when one
 * is shaped as a brand's (nameLists). A change made to take out an AI trace
 * may drop any; one taking out a banned word only the item that is one
 * (`banned`, bannedWordsOf).
 */
export function dropsName(passageText, before, words, rules = [], blocksText = '', banned = []) {
  if (rules.includes('aiTraces')) return false;
  // Taking out a banned word: the item that is one may go, no other. Without
  // the rule's words, any may, as before.
  if (rules.includes('bannedWords') && banned.length === 0) return false;
  // An item's words without the banned ones: "Leverage Shopify" is still Shopify.
  const unbanned = (item) =>
    item
      .split(/\s+/)
      .filter(
        (word) =>
          !rules.includes('bannedWords') ||
          !banned.some((b) => isKnown(word.replace(/['’]\p{L}*$/u, ''), knownPeople(b))),
      );
  const text = String(passageText);
  const changed = knownPeople(`${text.replace(before, () => words)} ${blocksText}`);
  for (const list of nameLists(text)) {
    for (const item of list.match(ITEM_RE) ?? []) {
      if (!String(before).includes(item)) continue;
      const rest = unbanned(item);
      // The item is a banned word: it may go.
      if (!rest.length) continue;
      const last = rest.at(-1).replace(/['’]\p{L}*$/u, '');
      if (!isKnown(last, changed)) return true;
    }
  }
  return false;
}

/**
 * Whether a replace makes a heading ask more than one question: an FAQ
 * question with a fan-out's question added to it ("What is X? What is an
 * AEO tracker?"). A new question goes in as its own heading and answer.
 */
export function asksMoreThanOne(passage, before, words) {
  if (!isHeading(passage.tag)) return false;
  const then = questionsIn(passage.text.replace(before, () => words));
  return then > 1 && then > questionsIn(passage.text);
}

/** A paragraph holding `text`, escaped. */
function paragraph(text) {
  const $ = cheerio.load('<p></p>', null, false);
  $('p').text(text);
  return $.html();
}

/**
 * A replace's "after" split into the words that go in its passage and the
 * blocks that go after it. Asked to answer under a heading, models write the
 * heading and its answer (or a whole FAQ) as the replace, which would glue
 * them onto the heading's line. The words are its leading text, or its first
 * block when that is of the passage's kind; the rest is an insert. On a
 * heading, words that answer its question ("What is X? X is …", the answer
 * a sentence of MIN_ANSWER_CHARS or more) keep the question, and the answer
 * becomes the first paragraph under it. The words' links (to a URL in
 * `links`) come with their offsets; a heading's words keep none.
 */
export function splitReplace(after, tag, links = null) {
  const html = cleanInsertHtml(after, links);
  const start = html.search(BLOCK_START);
  let words = start === -1 ? html : html.slice(0, start);
  let blocks = start === -1 ? '' : html.slice(start);
  if (!textOf(words).trim()) {
    const own = blocks.match(
      isHeading(tag) ? /^<(h[2-4])>([\s\S]*?)<\/\1>/ : /^<(p)>([\s\S]*?)<\/p>/,
    );
    if (own) {
      words = own[2];
      blocks = blocks.slice(own[0].length);
    }
  }
  // Line breaks and runs of spaces, not a non-breaking space the passage may keep.
  const read = inlineText(words);
  words = read.text;
  const wordLinks = isHeading(tag) ? [] : read.links;
  if (isHeading(tag)) {
    // A question and its answer ("What is X? X is …"): the answer goes under
    // the heading first, before any blocks that came with it. A subtitle that
    // fits ("What is AEO? The Complete Guide") isn't one: an answer ends a
    // sentence. Past the heading's limit, the rest is never the heading's,
    // unless it opens with a second question: that one isn't an answer, and
    // the heading asking both is dropped (asksMoreThanOne).
    const answered = words.match(QUESTION_AND_ANSWER);
    if (
      answered &&
      !OPENS_WITH_QUESTION.test(answered[2]) &&
      (words.length > headingLimit(tag) ||
        (ANSWER_END.test(answered[2]) && answered[2].length >= MIN_ANSWER_CHARS))
    ) {
      words = answered[1];
      blocks = paragraph(answered[2]) + blocks;
    }
  }
  return { words, links: wordLinks, blocks: blocks.trim() };
}

/**
 * The model's suggestions the editor can apply: on a passage that exists,
 * a replace's words found in it and never on a locked passage, an insert's
 * HTML cleaned and not empty; the rules named kept to the ones sent, and
 * each change once. A replace that carries blocks, or an answer on a
 * heading, is split into a replace and an insert after it (splitReplace);
 * one that would still grow a heading past its headingLimit (a long heading
 * may still be shortened), or make it ask a second question, is dropped.
 * Links stay only to the URLs in `links` (linkAllowList): a replace's go in
 * after_links, by offset into its words, an insert's in its HTML. Each keeps
 * the sources it names and the words each supports (withSources); one that
 * adds a number with no source is not kept. A person's name or a quote
 * that what it was given doesn't have becomes a placeholder, read in its
 * words as written, blockquotes too, before they are cleaned (CE-044).
 * On a health brand's page (`sourcing.health`, contentHealth.js), one that
 * adds a health claim the brand didn't make, or asks for one, is not kept.
 * `sourcing` is the numbered sources, the numbers known already
 * (the page's, the brand's) and the words names and quotes are looked up in
 * (knownPeople): without it, the page's.
 */
export function keepSuggestions(raw, passages, lockedKeys, ruleKeys, links = null, sourcing = {}) {
  const numbered = sourcing.numbered ?? [];
  // Quality's hand-off (CE-051): a placeholder is the person's to fill.
  const keepsPlaceholders = sourcing.keepPlaceholders === true;
  const known = sourcing.known ?? knownNumbers(...passages.map((p) => p.text));
  const people = sourcing.people ?? knownPeople(...passages.map((p) => p.text));
  // The sources a claim may be given to: the ones the page gives claims to,
  // and what it was given (Your input, the authors), never just any name the
  // page has (a competitor in a list).
  const attributable = sourcing.attributable ?? people;
  // The Banned words rule's words: a change taking one out may drop that item only.
  const banned = sourcing.banned ?? [];
  // A health brand's guard (contentHealth.js healthGuard): null for any other brand.
  const health = sourcing.health ?? null;
  const kept = [];
  const seen = new Set();
  for (const answer of raw) {
    if (kept.length >= MAX_AGENT_SUGGESTIONS) break;
    // Source numbers belong in "sources", never in the words; no invented
    // person or quote (CE-044).
    const s = {
      ...answer,
      after: guardPeopleInHtml(stripSourceIds(answer.after), people).html,
    };
    const passage = passages[s.passage - 1];
    // The card shows it: a source number the model wrote in ("(S2)") goes.
    const reason = stripSourceIds(s.reason).trim().slice(0, 300);
    if (!passage || !reason || passage.text.length > MAX_PASSAGE_CHARS) continue;
    const rules = [...new Set(s.rules.filter((key) => ruleKeys.has(key)))];
    // Blocks read line by line (htmlLines): compact HTML
    // ("<li>ChatGPT</li><li>Gemini</li>") never runs their words together,
    // and a linked name ("<a>Gartner</a>'s report") is read whole.
    const insertOf = (html) => {
      const lines = htmlLines(html);
      return lines.some((line) => line.trim()) &&
        html.length <= 20_000 &&
        // A claim given to a source it wasn't given (editor test 2026-10-25).
        !lines.some((line) => addsAttribution('', line, attributable)) &&
        // A health claim the brand didn't make (owner's safety rule, 2026-11-03).
        !lines.some((line) => addsHealthClaim(line, health))
        ? {
            id: `insert:${passage.text}:${html}`,
            row: {
              kind: 'insert',
              block_text: passage.text,
              before_text: '',
              after_text: html,
              reason,
              rule_keys: rules,
            },
          }
        : null;
    };
    // One suggestion's changes are kept together, or not at all: a split
    // replace never leaves a question without its answer.
    let changes;
    if (s.kind !== 'replace') {
      changes = [insertOf(cleanInsertHtml(s.after, links))];
    } else {
      if (lockedKeys.has(passageKey(passage.text))) continue;
      const before = s.before.trim();
      if (!before || !passage.text.includes(before)) continue;
      const split = splitReplace(s.after, passage.tag, links);
      const { words, blocks } = split;
      // As many as a suggestion may keep (00240).
      const wordLinks = split.links.slice(0, MAX_LINKS);
      // Linking words the passage already has is a change too.
      const changed = words && (words !== before || wordLinks.length > 0);
      // Read in what is kept: the passage's new words, and the blocks after it.
      if (
        keepsPlaceholders &&
        changed &&
        dropsPlaceholder(
          passage.text,
          before,
          `${words} ${htmlLines(blocks).join(' ')}`,
          passage.tag,
        )
      ) {
        continue;
      }
      if (
        changed &&
        (words.length > 2000 ||
          growsPastLimit(passage, before, words) ||
          asksMoreThanOne(passage, before, words) ||
          addsAttribution(before, words, attributable) ||
          // Read in the passage as changed: a question it asks claims nothing.
          addsHealthClaim(
            passage.text.replace(before, () => words),
            health,
          ) ||
          (!/^h[1-6]$/.test(passage.tag) &&
            dropsName(passage.text, before, words, rules, htmlLines(blocks).join(' '), banned)))
      )
        continue;
      changes = [
        changed && {
          id: `replace:${passage.text}:${before}`,
          row: {
            kind: 'replace',
            block_text: passage.text,
            before_text: before,
            after_text: words,
            ...(wordLinks.length ? { after_links: wordLinks } : {}),
            reason,
            rule_keys: rules,
          },
        },
        blocks && insertOf(blocks),
      ];
    }
    changes = changes.filter(Boolean);
    if (!changes.length || changes.some((c) => seen.has(c.id))) continue;
    if (kept.length + changes.length > MAX_AGENT_SUGGESTIONS) continue;
    // What it used (v1.1 CE-033), and no number without a source.
    const rows = changes.map((c) => withSources(c.row, s, numbered, known));
    if (rows.some((row) => !row)) continue;
    changes.forEach((c, i) => {
      seen.add(c.id);
      kept.push(rows[i]);
    });
  }
  return kept;
}

/**
 * Why a run left nothing to review (editor test 2026-10-25), so the editor
 * says what to do: the model proposed nothing ('none'); every change it
 * proposed was in a passage AI answers quote, which the page keeps word for
 * word ('locked'); or the checks dropped the rest ('dropped': an invented
 * number, a heading grown too long…).
 */
export function emptyWhy(raw, passages, lockedKeys) {
  if (!raw?.length) return 'none';
  const onLocked = raw.filter(
    (s) => s.kind === 'replace' && lockedKeys.has(passageKey(passages[s.passage - 1]?.text ?? '')),
  );
  return onLocked.length === raw.length ? 'locked' : 'dropped';
}

/**
 * A change row with the sources its suggestion names and the marks on its
 * words (a replace's after_text, an insert's HTML read as text); null when
 * it adds a number neither the page nor a source has (sourceSuggestion).
 */
function withSources(row, suggestion, numbered, known) {
  const pieces =
    row.kind === 'replace' ? [{ text: row.after_text, start: 0 }] : textPieces(row.after_text);
  const sourced = sourceSuggestion({
    named: suggestion.sources,
    marks: suggestion.marks,
    pieces,
    numbered,
    known,
  });
  if (!sourced) return null;
  const { sources, marks } = sourced;
  return {
    ...row,
    ...(sources.length ? { sources } : {}),
    ...(marks.length ? { source_marks: marks } : {}),
  };
}

/**
 * The passages the model reads: the ones it may change (up to
 * MAX_PASSAGE_CHARS each), in order, until MAX_PROMPT_PASSAGE_CHARS.
 * `more` says the page goes on past them.
 */
export function promptPassages(passages) {
  const sent = [];
  let chars = 0;
  for (const passage of passages) {
    if (passage.text.length > MAX_PASSAGE_CHARS) continue;
    if (chars + passage.text.length > MAX_PROMPT_PASSAGE_CHARS) {
      return { passages: sent, more: true };
    }
    chars += passage.text.length;
    sent.push(passage);
  }
  return { passages: sent, more: false };
}

/**
 * Words in square brackets with a letter and more than one character in
 * them: a placeholder (CE-044), as the editor reads one (placeholders.ts).
 */
const PLACEHOLDER = /\[(?!sic\])(?=[^[\]\n]*\p{L})[^[\]\n]{2,}\](?!\()/giu;

/**
 * The forms the server's guards write (the number guard's "[figure,
 * source]", contentPeople.js's name and quote): in a heading only these
 * are placeholders, as the editor reads them (placeholders.ts placeholderIn);
 * brackets a person writes in a title ("[2026 Update]") are part of it.
 */
const AGENT_PLACEHOLDER =
  /\[(?:figure, source[^[\]\n]*|name of a real person|quote from a real person[^[\]\n]*)\](?!\()/giu;

/** Each placeholder in the text, by how many times it is there. */
function placeholderCounts(text, heading) {
  const counts = new Map();
  for (const found of text.match(heading ? AGENT_PLACEHOLDER : PLACEHOLDER) ?? []) {
    counts.set(found, (counts.get(found) ?? 0) + 1);
  }
  return counts;
}

/**
 * Whether a replace takes a placeholder out of its passage, filled or
 * dropped: each placeholder counted before and after the change, so one of
 * two alike ("[figure, source]" twice) counts too (a "before" may cut into
 * one: "product name" in "[product name]").
 */
export function dropsPlaceholder(passage, before, after, tag = 'p') {
  const heading = isHeading(tag);
  const had = placeholderCounts(passage, heading);
  if (!had.size) return false;
  const now = placeholderCounts(
    passage.replace(before, () => String(after ?? '')),
    heading,
  );
  return [...had].some(([placeholder, count]) => (now.get(placeholder) ?? 0) < count);
}

/** Quality's hand-off (CE-051): the guard drops a fill, so the model isn't asked to make one. */
const KEEP_PLACEHOLDERS =
  "Leave every [placeholder] exactly as it is: the person fills it; don't change or remove one.";

/**
 * What the model is told of a page already over its Length that it isn't
 * asked to shorten: fixing the other rules, it adds no more than they need
 * (editor test 2026-10-26: fan-out sections, FAQ answers and H2 answers took a
 * page 26% over its Length further over).
 */
export function overLengthLine(over) {
  if (!over || over.count <= over.max) return '';
  return `The page is already ${over.count.toLocaleString('en-US')} characters, past the most its Length allows (${over.max.toLocaleString('en-US')}). The Length isn't among the rules here, so don't cut the page for it. Fix each rule with as few words as it needs: an answer in one or two sentences, no section, list, table or example a rule doesn't ask for, and a replace no longer than the words it replaces unless the rule needs words added (a keyword, a figure, a name).`;
}

/** What the model is told: the brand, the page's passages, and the rules to fix. */
export function buildFixPrompt({
  brand,
  draft,
  passages,
  more = false,
  lockedKeys,
  input,
  linkTargets = '',
  sources = '',
  handoff = false,
  careful = '',
  livePage = '',
}) {
  const lines = passages.map((p, i) => {
    const locked = lockedKeys.has(passageKey(p.text)) ? ', LOCKED' : '';
    return `[${i + 1}] (${p.tag}${locked}) ${p.text}`;
  });
  if (more) lines.push('(The page goes on; suggest changes only to the passages above.)');
  const rules = input.rules.map((r) => `- ${r.key}: ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  const own = input.textRules.map((text) => `- ${text}`);
  // The brand's rules (Settings › Content, 00450): before the writer's own, which they outrank.
  const brandRules = brandRulesSection(
    brand.rules,
    "The brand's rules, to follow in every change, before the writer's own:",
  );
  // Said only when the Length isn't among the rules: the line says it isn't.
  const over = input.rules.some((r) => r.key === 'length') ? '' : overLengthLine(input.overLength);
  return `Brand: ${brand?.name || 'Unknown'}
Industry: ${brand?.industry || 'Not specified'}
${siteTypeLine(brand)}Description: ${brand?.description || 'N/A'}

Page: ${draft.title || 'Untitled'}
Page type: ${pageTypeFormat(draft.page_type)}

Rules the page doesn't meet yet (key: rule — what it asks and how the page reads now):
${rules.join('\n')}
${over ? `${over}\n` : ''}${careful ? `${careful}\n` : ''}${livePage ? `${livePage}\n` : ''}${handoff ? `${KEEP_PLACEHOLDERS}\n` : ''}${brandRules ? `\n${brandRules}\n` : ''}${own.length ? `\nThe writer's own rules, to follow in every change:\n${own.join('\n')}\n` : ''}${sources ? `\n${sources}\n` : ''}${linkTargets ? `\n${linkTargets}\n` : ''}
The page, passage by passage:
${lines.join('\n')}

Write in ${getLanguageName(brand?.language)}.`;
}

/**
 * The brand's prompts among `ids`, { id, text }, in the order asked: through
 * the prompt's set, not its topic (a prompt may have no topic).
 */
export async function readPrompts(brandId, ids) {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin
    .from('prompts')
    .select('id, text, prompt_sets!inner(brand_id)')
    .in('id', ids)
    .eq('prompt_sets.brand_id', brandId);
  if (error) throw error;
  const byId = new Map((data ?? []).map((p) => [p.id, p.text]));
  return ids.filter((id) => byId.has(id)).map((id) => ({ id, text: byId.get(id) }));
}

/**
 * Whether the draft's latest batch still has suggestions nobody decided:
 * the editor shows only that batch, so a new one would hide them (and Undo
 * on the ones accepted).
 */
export async function hasOpenSuggestions(draftId) {
  const { data, error } = await supabaseAdmin
    .from('content_draft_suggestions')
    .select('batch_id, status')
    .eq('draft_id', draftId)
    .order('created_at', { ascending: false })
    .limit(LATEST_BATCH_ROWS);
  if (error) throw error;
  const latest = data?.[0]?.batch_id;
  return (data ?? []).some((row) => row.batch_id === latest && row.status === 'open');
}

/** A 'writing' this old was left by a server that stopped: it can start again. */
export const WRITING_STALE_MS = 10 * 60_000;

/** Whether Start or a rewrite holds the draft now (agent_state, 00219). */
export function agentWriting(draft, now = Date.now()) {
  return (
    draft.agent_state === 'writing' &&
    new Date(draft.agent_state_at).getTime() > now - WRITING_STALE_MS
  );
}

/**
 * Runs the agent on a draft: reads it and its brand, charges the AI usage
 * budget, asks the model, and keeps the suggestions the editor can apply as
 * one new batch, linked to the draft's Action Center action if it has one.
 * Throws with `.status` 404 for a draft outside the brand, 409 for a
 * published draft, one whose suggestions are still open or one the agent is
 * fixing already (`running`), 422 for an empty page, PlanLimitError once
 * the budget is spent — all before charging.
 *
 * `handoff` runs it as Quality's hand-off (CE-051): a run of its own kind,
 * by a person or the editor on its own (`origin`). The rules are the page's
 * checks in the server's words, and what the editor sent of them (their
 * detail) is no fact the agent may write; a placeholder stays the person's.
 * An automatic one runs only on a draft made while its brand handed off
 * (quality_handoff, 00275) and while it still does (409 `not_due`), once
 * (409 `already`); one the AI budget stops
 * before it begins is taken back, to run once the budget renews.
 */
export async function fixDraftRules({ draftId, brandId, input, handoff = null }) {
  const { data: draft, error: draftError } = await supabaseAdmin
    .from('content_drafts')
    .select(
      `id, brand_id, title, body_html, page_type, rules, action_id, status, source_url, published_url, agent_state, agent_state_at, shopping_path${handoff ? ', quality_handoff' : ''}`,
    )
    .eq('id', draftId)
    .maybeSingle();
  if (draftError) throw draftError;
  if (!draft || draft.brand_id !== brandId) {
    throw Object.assign(new Error('Draft not found'), { status: 404 });
  }
  // An automatic hand-off on a draft its brand doesn't hand off never will be due.
  if (handoff?.origin === 'auto' && draft.quality_handoff !== true) {
    throw Object.assign(new Error('The brand hands off no quality fixes'), {
      status: 409,
      code: 'not_due',
    });
  }
  if (draft.status === 'published') {
    throw Object.assign(new Error('The draft is published'), { status: 409, code: 'published' });
  }
  const { passages, more } = promptPassages(draftPassages(draft.body_html));
  if (!passages.length) {
    throw Object.assign(new Error('The page has no text to fix'), { status: 422, code: 'empty' });
  }
  if (await hasOpenSuggestions(draftId)) {
    throw Object.assign(new Error('Decide the open suggestions first'), {
      status: 409,
      code: 'open_suggestions',
    });
  }
  // Start or a rewrite holds the draft: a batch here would drop its answer,
  // already charged, when it lands (another tab, another member, the API).
  if (agentWriting(draft)) {
    throw Object.assign(new Error('The agent is already writing it'), {
      status: 409,
      code: 'writing',
    });
  }
  // One fix at a time on a draft (a second tab, a person's beside the auto one).
  if (await fixUnderWay(draftId)) {
    throw Object.assign(new Error('The agent is already fixing it'), {
      status: 409,
      code: 'running',
    });
  }

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select(
      `name, industry, description, organization_id, language, site_type, shopping_mode_enabled${handoff ? ', content_quality_handoff' : ''}`,
    )
    .eq('id', brandId)
    .single();
  if (brandError) throw brandError;
  // The brand's rules (00450), read here: the prompt puts them first.
  brand.rules = await readBrandRules(brandId);
  // Turned off since the draft was made: its automatic hand-off doesn't run.
  if (handoff?.origin === 'auto' && brand.content_quality_handoff !== true) {
    throw Object.assign(new Error('The brand hands off no quality fixes'), {
      status: 409,
      code: 'not_due',
    });
  }

  // Its steps, named by the work it does (CE-027/035); Stop aborts the call.
  const sources = input.sources;
  const run = await startRun({
    draftId,
    kind: handoff ? 'handoff' : 'fix',
    origin: handoff?.origin ?? 'person',
    strict: handoff?.origin === 'auto',
    counts: {
      [handoff ? 'checks' : 'rules']: input.rules.length,
      sources: sources
        ? sources.promptIds.length +
          sources.fanouts.length +
          sources.pages.length +
          sources.queries.length
        : 0,
    },
  });
  try {
    const result = await fixWithRun({
      draft,
      brand,
      brandId,
      draftId,
      input,
      passages,
      more,
      run,
      handoff: !!handoff,
    });
    // Why it left nothing, on its writing step: an editor whose answer was
    // lost reads it there (jsonb, so no column).
    if (result.why && run?.steps?.[2]) run.steps[2] = { ...run.steps[2], why: result.why };
    await finishRun(run, 'done', { 2: result.count });
    return result;
  } catch (err) {
    if (isStop(err, run)) {
      await finishRun(run, 'stopped');
      throw new RunStoppedError();
    }
    // An automatic hand-off the budget stopped before it began: its claim goes.
    if (handoff?.origin === 'auto' && err instanceof PlanLimitError) await dropRun(run);
    else await finishRun(run, 'failed');
    throw err;
  }
}

/** Quality's checks a hand-off fixes with a source: they link the draft's sources (CE-051). */
const SOURCE_CHECKS = new Set([
  'trust:claimsSourced',
  'trust:freshSources',
  'trust:noWeakSources',
  'trust:primarySources',
  'trust:noBrokenLinks',
]);

/** The brand's approved facts still on its site (CE-047), as their words. */
async function approvedFacts(brandId) {
  const { data, error } = await supabaseAdmin
    .from('brand_facts')
    .select('quote')
    .eq('brand_id', brandId)
    .eq('status', 'approved')
    .is('gone_at', null);
  if (error) throw error;
  return (data ?? []).map((f) => f.quote).filter(Boolean);
}

/** Fix open rules' run itself, step by step: nothing is kept once it is stopped. */
async function fixWithRun({
  draft,
  brand,
  brandId,
  draftId,
  input,
  passages,
  more,
  run,
  handoff = false,
}) {
  const modelId = contentWriteModelId();
  const lockedKeys = new Set(input.locked.map(passageKey));
  const ruleKeys = new Set(input.rules.map((r) => r.key));
  // The rules here people at the brand mostly reject its changes for
  // (learning B6): kept small, and named on the run's rules step, which the
  // editor's agent card shows. Apply rules with Agent only: Quality's
  // hand-off (CE-051), whose card doesn't show it, runs as it was. A read
  // that fails leaves the run as it was.
  const careful = handoff
    ? []
    : await carefulRules(brandId, { keys: ruleKeys }).catch((err) => {
        logger.warn(
          { err: { message: err?.message }, draftId },
          '[content-agent] decisions not read',
        );
        return [];
      });
  if (careful.length && run?.steps?.[0]) {
    run.steps[0] = { ...run.steps[0], careful: careful.map(({ key }) => key) };
  }
  // The data it writes from, numbered, Brief › Your input last (CE-048);
  // the numbers it may write unmarked.
  await advanceRun(run, 1);
  const [prompts, inputRow, shoppingPath, livePage] = await Promise.all([
    readPrompts(brandId, input.sources?.promptIds ?? []),
    readDraftInputs(draftId),
    // Its shopping path, checked: none when it isn't one (shopping path, part 4).
    shoppingPathFor(draft),
    // How the page it optimizes does now (learning B5), as the Live page
    // tab reads it: at the address it was published at, else the one it
    // optimizes. Apply rules with Agent only, as the careful rules. A read
    // that fails leaves the run as it was.
    handoff
      ? null
      : readLivePage(brandId, draft.published_url ?? draft.source_url).catch((err) => {
          logger.warn(
            { err: { message: err?.message }, draftId },
            '[content-agent] live page not read',
          );
          return null;
        }),
  ]);
  // Named on the run's sources step, which the editor's agent card shows:
  // only a page AI answers cited, as the card speaks of its citations. One
  // with AI visits alone is still told to the agent.
  const cited = livePage && (livePage.citations.cur > 0 || livePage.citations.prev > 0);
  if (cited && run?.steps?.[1]) {
    run.steps[1] = {
      ...run.steps[1],
      live: {
        days: livePage.days,
        citations: livePage.citations.cur,
        before: livePage.citations.prev,
        lost: livePage.prompts.lost,
      },
    };
  }
  const numbered = numberSources({
    prompts,
    fanouts: input.sources?.fanouts,
    pages: input.sources?.pages,
    queries: input.sources?.queries,
    inputs: inputSources(inputRow, brand.name),
  });
  // A hand-off's details and the person's and brand's rules are the editor's
  // words: no fact the agent may write. The brand's approved facts are, read here.
  const ruleWords = handoff
    ? input.rules.map((r) => r.name)
    : [
        ...input.rules.flatMap((r) => [r.name, r.detail]),
        ...input.textRules,
        ...(brand.rules ?? []),
      ];
  const facts = handoff && ruleKeys.has('trust:brandFacts') ? await approvedFacts(brandId) : [];
  // The shopping path's prices and names: the catalog's, written unmarked.
  const shopping = shoppingGiven(shoppingPath);
  const known = withNamedNumbers(
    knownNumbers(
      htmlText(draft.body_html),
      draft.title,
      brand.name,
      brand.industry,
      brand.description,
      ...ruleWords,
      ...facts,
      shopping.prices,
      todayText(),
    ),
    shopping.names,
  );
  // The people and quotes it may name: the same words, its data's and the authors' (CE-044).
  const authors = await authorWords(supabaseAdmin, brand.organization_id);
  const people = knownPeople(
    htmlText(draft.body_html),
    draft.title,
    brand.name,
    brand.industry,
    brand.description,
    ...ruleWords,
    ...shopping.names,
    ...numbered.map(sourceWords),
    ...authors,
  );
  // A health brand's guard: the claims it made in its own words (the page,
  // its description, Your input, its approved facts and the rules people
  // wrote), never the brief's or a buyer's (contentHealth.js).
  const health = healthGuard(brand, {
    html: draft.body_html,
    texts: [
      draft.title,
      brand.name,
      brand.description,
      ...facts,
      ...shopping.names,
      ...(handoff ? [] : [...input.textRules, ...(brand.rules ?? [])]),
    ],
    numbered,
  });
  // The sources a claim may be given to: the ones the page gives claims to,
  // and its Your input and authors (never just a name the page lists).
  const attributable = attributableSources(
    draft.body_html,
    numbered,
    authors,
    await draftLanguage(draft, brand),
    [brand.name],
  );
  // Where it may link: the brand's pages and the draft's sources (A); a
  // hand-off's source checks link the draft's sources.
  const linkKeys =
    handoff && [...ruleKeys].some((key) => SOURCE_CHECKS.has(key))
      ? new Set([...ruleKeys, 'outboundLinks', 'citeInline'])
      : ruleKeys;
  // …and its shopping path's shop pages (shopping path, part 4).
  const targets = withShopping(
    await readLinkTargets({
      brandId,
      draftId,
      sourceUrl: draft.source_url,
      ruleKeys: linkKeys,
    }),
    shoppingPath,
  );
  // Held on the budget before the call, so calls at once can't pass it.
  const budget = await reserveAiBudget(brand.organization_id, {
    feature: 'content',
    modelId,
    draftId,
  });
  let object;
  try {
    await advanceRun(run, 2);
    const generated = await runCall(run, budget, CALL_TIMEOUT_MS, (abortSignal) =>
      generateObject({
        model: resolveModel(modelId),
        ...objectOptions(modelId, suggestionsSchema, { maxOutputTokens: CONTENT_WRITE_MAX_TOKENS }),
        system: SYSTEM_PROMPT,
        prompt: buildFixPrompt({
          brand,
          draft,
          passages,
          more,
          lockedKeys,
          input,
          linkTargets: linkTargetsPrompt(targets, linkKeys),
          sources: sourcesPrompt(numbered),
          handoff,
          careful: carefulLine(careful),
          livePage: livePageLine(livePage),
        }),
        abortSignal,
      }),
    );
    await budget.charge(generated.usage);
    object = generated.object;
  } catch (err) {
    // An answer the provider billed but that missed the schema is charged,
    // as Improve's is: else it, and each retry after it, would run free.
    if (NoObjectGeneratedError.isInstance(err) && err.usage) await budget.charge(err.usage);
    throw err;
  } finally {
    // Nothing charged (a timeout, a refusal): the hold goes.
    await budget.release();
  }

  await advanceRun(run, 3);
  // One that asks for a health claim to be looked up ({{find: …}}) goes
  // first: none is searched (contentHealth.js). The claims the rest make
  // are read once placed (keepSuggestions).
  const asked = withoutHealthFinds(object.suggestions, health);
  if (asked.length < object.suggestions.length) {
    logger.info(
      { draftId, health: object.suggestions.length - asked.length },
      '[content-agent] suggestions asking for a health claim dropped',
    );
  }
  // The facts it asked for, and the figures it wrote with no source, looked
  // up on the web and written in with their links, or their sentences
  // written without them (contentResearch.js). The figures its data's
  // words have are its sources' (sourceSuggestion), not ones to look up.
  const looked = await lookUpSuggestionFacts({
    suggestions: asked,
    known: withNamedNumbers(
      new Set([...known, ...knownNumbers(...numbered.map(sourceWords))]),
      shopping.names,
    ),
    own: pageOwn(draft.body_html),
    products: shopping.names,
    orgId: brand.organization_id,
    draftId,
    modelId: contentReadModelId(),
    run,
    context: { brand: brand.name, title: draft.title },
  });
  for (const value of looked.learned) known.add(value);
  const rows = keepSuggestions(
    looked.suggestions,
    passages,
    lockedKeys,
    ruleKeys,
    withFactLinks(linkAllowList(targets), looked.links),
    {
      numbered,
      known,
      people,
      attributable,
      keepPlaceholders: handoff,
      banned: bannedWordsOf(input.rules),
      health,
    },
  );
  // Stopped meanwhile: nothing it wrote is kept.
  await stopIfStopped(run);
  if (!rows.length) {
    return { count: 0, batchId: null, why: emptyWhy(object.suggestions, passages, lockedKeys) };
  }

  const batchId = randomUUID();
  const { error: insertError } = await supabaseAdmin.from('content_draft_suggestions').insert(
    rows.map((row, position) => ({
      ...row,
      draft_id: draftId,
      batch_id: batchId,
      action_id: draft.action_id ?? null,
      position,
    })),
  );
  if (insertError) throw insertError;
  return { count: rows.length, batchId };
}
