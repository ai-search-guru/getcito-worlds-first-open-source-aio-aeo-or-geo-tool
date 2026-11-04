import * as cheerio from 'cheerio';
import { z } from 'zod';

/**
 * The person's data the Content Agent writes from, and what it says it used
 * (Content Editor v1.1 §3b, CE-033): the sources the Sources tab keeps —
 * prompts, fan-outs, cited pages, Search Console queries — numbered for the
 * model (S1, S2…). Each suggestion names the sources behind it and marks the
 * words each one supports, so the editor shows "Based on" chips and ¹ ² marks.
 *
 * And no number without a source. The model reads a source by its words
 * (a question, a search), never its content, so a mark alone proves
 * nothing: a number the agent adds must be in the page, the brand's or the
 * brief's words, the rules, this year, or a source's own words — and then it
 * is marked to that source. A claim (a %, a ×, a scale, a currency) must be
 * known with the same unit or sign: "crm for 50 users" never sources "50%".
 * A cited page's address is no words of its own. A suggestion with any
 * other number is not kept; a page the agent writes whole has it looked
 * up, or loses its sentence (contentResearch.js).
 */

/** The most sources one suggestion names (content_draft_suggestions.sources, 00248). */
export const MAX_SUGGESTION_SOURCES = 8;
/** The most marks one suggestion keeps (source_marks, 00248). */
export const MAX_SOURCE_MARKS = 12;
/** What stands where a number had no source. */
export const NUMBER_PLACEHOLDER = '[figure, source]';

/** What a suggestion says it used, and the words each source supports. */
export const sourcesField = z
  .array(z.string())
  .describe('The numbers (S1, S2…) of your data this change uses; [] when it uses none.');
export const marksField = z
  .array(
    z.object({
      words: z.string().describe('The words in "after" the source supports, copied exactly.'),
      source: z.string().describe('Its number, e.g. S2.'),
    }),
  )
  .describe('Each fact the change takes from your data, with its source.');

/** The rule every prompt that uses the list gives the model. */
export const SOURCES_RULE = `- Your data is numbered (S1, S2…) and listed by its words only: you don't see what a cited page says. Put the numbers of the ones a change uses in "sources", and mark the exact words each supports in "marks"; never write "S1" in the page's words. Add a number only when the page, the brand, the rules or your data's own words have it; otherwise ask for it to be looked up with {{find: …}}.`;

/** A query as the Sources tab keys it: trimmed, spaces collapsed, lowercased (sources.ts normalizeQuery). */
export function normalizeQuery(query) {
  return String(query ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * The sources numbered: [{ id: 'S1', kind, ref, label, detail }], refs as the
 * Sources tab keys its rows (a prompt's id, a normalized query, a page's
 * address), so the editor finds each one there. Brief › Your input comes
 * last, as inputSources (contentInputs.js) lists it (CE-048).
 */
export function numberSources({
  prompts = [],
  fanouts = [],
  pages = [],
  queries = [],
  inputs = [],
}) {
  const list = [
    ...prompts.map((p) => ({ kind: 'prompt', ref: p.id, label: p.text })),
    ...fanouts.map((f) => ({
      kind: 'fanout',
      ref: normalizeQuery(f.query),
      label: f.query,
      detail: f.platforms?.length ? f.platforms.join(', ') : '',
    })),
    ...pages.map((p) => ({ kind: 'cited_page', ref: p.url, label: p.url, detail: p.kind })),
    ...queries.map((q) => ({ kind: 'gsc_query', ref: normalizeQuery(q), label: q })),
    ...inputs,
  ].filter((s) => s.ref && s.label);
  return list.map((s, i) => ({ id: `S${i + 1}`, ...s }));
}

const KIND_NAMES = {
  prompt: 'Prompt (a question tracked in AI answers)',
  fanout: 'Fan-out (a search AI ran while answering)',
  cited_page: 'Cited page (AI answers cite it today; answer better, never copy)',
  gsc_query: 'Search Console query (a Google search people use)',
  input: "Your input (the person's own, given for this page)",
};

/** What the agent does with Brief › Your input, when the list has any (CE-048). */
export const INPUT_RULE = `- Your input is the person's own: write their experience as first-hand ("we tested…") and add nothing to it; quote an expert word for word, with their name and title; cite GetCito data as its line says. Never invent people, quotes, customer stories, test results or numbers beyond what you were given: where one of the brand's own is missing, write {{ask: …}}.`;

/** The numbered list as the model reads it, or '' with none. */
export function sourcesPrompt(numbered) {
  if (!numbered.length) return '';
  const lines = numbered.map(
    (s) =>
      `${s.id} ${KIND_NAMES[s.kind]}: ${s.kind === 'cited_page' ? s.label : `"${s.label}"`}${s.detail ? ` (${s.detail})` : ''}${s.note ? ` — ${s.note}` : ''}`,
  );
  const rule = numbered.some((s) => s.kind === 'input') ? `\n${INPUT_RULE}` : '';
  return `Your data, numbered (cite by number):\n${lines.join('\n')}${rule}`;
}

/** A source number written into the words in brackets ("(S2)", "[S1, S3]"): never the page's. */
const SOURCE_ID = /\s?[([]S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*[)\]]/g;

/**
 * Words with the source numbers the model wrote into them taken out: with
 * `count`, only S1 to S{count}, the numbers it was given, so a name with one
 * ("Galaxy (S23)") stays.
 */
export function stripSourceIds(text, count = Infinity) {
  return String(text ?? '').replace(SOURCE_ID, (ids) =>
    ids.match(/\d+/g).every((n) => Number(n) <= count) ? '' : ids,
  );
}

/**
 * A number as the guard reads it: digits with their separators, not stuck to
 * a letter before them ("B2B", "H2", "Web3" are words).
 */
const NUMBER = /(?<!\p{L})\d+(?:[.,]\d+)*/gu;
const CURRENCY = /[$€£¥₺]/;
/** What makes a lone digit a claim: a percent, a times, a scale. */
const UNIT_AFTER =
  /^\s?(?:%|×|[xX]\b|[kKMB]\b|bn\b|mn\b|[Mm]illions?\b|[Bb]illions?\b|[Tt]housands?\b|[Tt]rillions?\b)/;
/** UNIT_AFTER read at a place in the text, without slicing it off. */
const UNIT_AT = new RegExp(UNIT_AFTER.source.slice(1), 'y');

/** A percent written before its number, as Turkish does: "%40", "yüzde 40". */
const PERCENT_BEFORE = /(?:%\s?|(?<!\p{L})yüzde\s)$/iu;

/** A claim's unit, one name for each way it is written: "40%", "%40", "3x", "2M", "$40". */
function unitOf(text, start, end) {
  const before = text[start - 1] ?? '';
  if (CURRENCY.test(before)) return before;
  if (PERCENT_BEFORE.test(text.slice(Math.max(0, start - 6), start))) return '%';
  const unit = text.slice(end).match(UNIT_AFTER)?.[0].trim().toLowerCase();
  if (!unit) return '';
  if (unit === '%') return '%';
  if (unit === '×' || unit === 'x') return '×';
  if (unit === 'k' || unit.startsWith('thousand')) return 'thousand';
  if (unit === 'm' || unit === 'mn' || unit.startsWith('million')) return 'million';
  if (unit === 'b' || unit === 'bn' || unit.startsWith('billion')) return 'billion';
  return 'trillion';
}
/**
 * A placeholder the agent leaves ("[figure, source, 2025]"): it holds no
 * claim. Never one with another "[" in it, so an opening bracket with no
 * closing one isn't read to the text's end from each "[" after it.
 */
const BRACKETS = /\[[^[\]]*\]/g;

/**
 * A number's value as compared: thousands separators dropped ("1,299" and
 * "1.299" are 1299), then a decimal comma read as a point ("3,4" is 3.4,
 * "1.250,5" is 1250.5), as Turkish, German, French and others write it.
 */
const valueOf = (token) => token.replace(/[.,](?=\d{3}(?!\d))/g, '').replace(',', '.');

/** The numbers a text holds, each with where it is and its unit ('' for none). */
export function numbersIn(text) {
  const s = String(text ?? '');
  const found = [];
  for (const m of s.matchAll(NUMBER)) {
    const end = m.index + m[0].length;
    found.push({ value: valueOf(m[0]), unit: unitOf(s, m.index, end), start: m.index, end });
  }
  return found;
}

/** A number as a known set holds it: its value, and with a unit its value and unit. */
const unitKey = (n) => `${n.value}|${n.unit}`;

/**
 * Every number in these texts: each value, so a plain number matches it
 * written any way, and each value with its unit, which a claim must match.
 */
export function knownNumbers(...texts) {
  return new Set(
    texts.flatMap((text) =>
      numbersIn(text).flatMap((n) => (n.unit ? [n.value, unitKey(n)] : [n.value])),
    ),
  );
}

/**
 * The known numbers with names that hold their own ("Trail 450", a
 * shopping path's product: shoppingLinks.js): a name's numbers are known
 * where the name is written whole, never alone. Kept on the set, as
 * `named`; returns it.
 */
export function withNamedNumbers(known, names) {
  const named = [
    ...new Set(
      (names ?? [])
        .map((n) =>
          String(n ?? '')
            .replace(/\s+/g, ' ')
            .trim(),
        )
        .filter((n) => /\d/.test(n)),
    ),
  ].sort((a, b) => b.length - a.length);
  if (!named.length) return known;
  // Its spaces and apostrophes written any way: "Men’s  Trail 450".
  const spelled = named.map((n) =>
    n
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/ /g, '\\s+')
      .replace(/['’]/g, "['’]"),
  );
  return Object.assign(known, {
    named: new RegExp(`(?<![\\p{L}\\p{N}])(?:${spelled.join('|')})(?![\\p{L}\\p{N}])`, 'gu'),
  });
}

/** Today as the agent may write it: its year alone ("23" on the 23rd would let "23%" through). */
export function todayText(now = new Date()) {
  return `${now.getUTCFullYear()}`;
}

/**
 * A source's words its numbers are read from: a cited page's address is
 * none ("/2024/03/15/post-1234"), nor what only places a source, its note
 * (a quote's address, the days GetCito data covers: contentInputs.js).
 */
export function sourceWords(source) {
  return source.kind === 'cited_page' ? '' : `${source.label} ${source.detail ?? ''}`;
}

/** Tags whose text is never a page's words. */
const NOT_WORDS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'textarea']);

/** All of a page's words, tables and HTML blocks too, each piece apart: where its numbers are read. */
export function htmlText(html) {
  const $ = cheerio.load(html || '', null, false);
  const pieces = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') pieces.push(node.data);
      else if (node.type === 'tag' && !NOT_WORDS.has(node.name)) walk(node.children ?? []);
    }
  };
  walk($.root().contents().get());
  return pieces.join(' ');
}

/**
 * HTML's text nodes, each with where it starts in the HTML read as text (as
 * cheerio's .text() and a browser's textContent join them, with nothing
 * between blocks): numbers are read node by node, so "Option 1" and "2
 * seats" in two items never read as 12.
 */
export function textPieces(html) {
  const $ = cheerio.load(html || '', null, false);
  const pieces = [];
  let at = 0;
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        pieces.push({ text: node.data, start: at });
        at += node.data.length;
      } else if (node.type === 'tag') walk(node.children ?? []);
    }
  };
  walk($.root().contents().get());
  return pieces;
}

/**
 * The numbers a text adds: not known, outside a placeholder, and not a lone
 * digit used as a count ("3 ways", "Step 2") — one with a %, a ×, a scale
 * or a currency sign is a claim and counts.
 */
export function addedNumbers(text, known) {
  const blank = (m) => ' '.repeat(m.length);
  const bare = String(text ?? '').replace(BRACKETS, blank);
  // A name's own numbers, where it is written (withNamedNumbers).
  const s = known.named ? bare.replace(known.named, blank) : bare;
  return numbersIn(s).filter((n) => {
    // A claim is known only with its unit or sign; a plain number as any.
    if (known.has(n.unit ? unitKey(n) : n.value)) return false;
    return n.unit !== '' || n.value.length > 1;
  });
}

/**
 * A suggestion's sources and marks, as kept — or null when it adds a number
 * none of them has. `pieces` are its words (one piece for a replace's, an
 * insert's text nodes); `known` the numbers it may write unmarked (the
 * page's, the brand's, the brief's, the rules', today's).
 *
 * Sources: the ones its marks name, then the ones it names, each once and
 * at most MAX_SUGGESTION_SOURCES, as [{ kind, ref, label }]. Marks: each
 * mark's words found in the text, { start, end, source } (an index into the
 * sources), in order and apart; then a mark on each number it adds from a
 * source's own words, to that source. Ids the list doesn't have are dropped.
 */
export function sourceSuggestion({ named, marks, pieces, numbered, known }) {
  const text = pieces.map((p) => p.text).join('');
  const byId = new Map(numbered.map((s) => [s.id.toUpperCase(), s]));
  const sources = [];
  const indexOf = (source) => {
    if (!source) return -1;
    let i = sources.findIndex((s) => s.kind === source.kind && s.ref === source.ref);
    if (i === -1 && sources.length < MAX_SUGGESTION_SOURCES) {
      sources.push({ kind: source.kind, ref: source.ref, label: source.label });
      i = sources.length - 1;
    }
    return i;
  };
  const sourceOf = (id) =>
    byId.get(
      String(id ?? '')
        .trim()
        .toUpperCase(),
    );
  // A marked source first: the cap never drops one a mark needs.
  for (const mark of marks ?? []) indexOf(sourceOf(mark.source));
  for (const id of named ?? []) indexOf(sourceOf(id));

  const kept = [];
  const free = (start, end) => kept.every((k) => end <= k.start || start >= k.end);
  for (const mark of marks ?? []) {
    if (kept.length >= MAX_SOURCE_MARKS) break;
    // The words as text: tags and entities a model copies in don't count.
    const words = cheerio
      .load(String(mark.words ?? ''), null, false)
      .root()
      .text()
      .trim();
    const source = indexOf(sourceOf(mark.source));
    if (!words || source === -1) continue;
    let at = text.indexOf(words);
    while (at !== -1 && !free(at, at + words.length)) at = text.indexOf(words, at + 1);
    if (at !== -1) kept.push({ start: at, end: at + words.length, source });
  }

  // Each number it adds: the page's own, or one of its sources' words' —
  // the ones it named or marked first, so a number two sources have goes
  // to the one it used, then the rest in their order.
  const own = numbered.map((s) => knownNumbers(sourceWords(s)));
  const used = new Set(sources.map((s) => `${s.kind}:${s.ref}`));
  const order = numbered
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Number(!used.has(`${numbered[a].kind}:${numbered[a].ref}`)) -
        Number(!used.has(`${numbered[b].kind}:${numbered[b].ref}`)),
    );
  for (const piece of pieces) {
    for (const n of addedNumbers(piece.text, known)) {
      const start = piece.start + n.start;
      const end = piece.start + n.end;
      const from = order.find((i) => own[i].has(n.unit ? unitKey(n) : n.value)) ?? -1;
      if (from === -1) return null;
      const source = indexOf(numbered[from]);
      if (source === -1) return null;
      const marked = kept.some(
        (k) => k.start <= start && end <= k.end && sources[k.source].ref === numbered[from].ref,
      );
      if (!marked && free(start, end) && kept.length < MAX_SOURCE_MARKS) {
        kept.push({ start, end, source });
      }
    }
  }
  kept.sort((a, b) => a.start - b.start);
  return { sources, marks: kept };
}

/** A text with each number it adds put as a placeholder: for a page written whole, with no marks. */
export function placeholderNumbers(text, known) {
  const s = String(text ?? '');
  // The text built once from its pieces, left to right: rebuilt per number,
  // a line with thousands would take their count times its length (#1544 review).
  // The sign and unit go with it: "$40", "40%" and "%40" become the placeholder.
  const found = addedNumbers(s, known).map((n) => {
    let start = n.start;
    if (CURRENCY.test(s[start - 1] ?? '')) start -= 1;
    const percent = s.slice(Math.max(0, start - 2), start).match(/%\s?$/);
    if (percent) start -= percent[0].length;
    return { start, end: n.end };
  });
  let out = '';
  let at = 0;
  found.forEach((n, i) => {
    let end = n.end;
    UNIT_AT.lastIndex = end;
    const unit = UNIT_AT.exec(s);
    // A unit that runs into the next number's sign is that one's ("40 %50").
    if (unit && end + unit[0].length <= (found[i + 1]?.start ?? Infinity)) end += unit[0].length;
    const start = Math.max(n.start, at);
    out += s.slice(at, start) + NUMBER_PLACEHOLDER;
    at = Math.max(at, end);
  });
  return out + s.slice(at);
}

/** Tags whose text a page's placeholders never touch: code and what isn't words. */
const KEPT_AS_IS = new Set([...NOT_WORDS, 'code', 'pre']);

/** An HTML page with each number it adds put as a placeholder, in its words only. */
export function placeholderNumbersInHtml(html, known) {
  const $ = cheerio.load(html || '', null, false);
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') node.data = placeholderNumbers(stripSourceIds(node.data), known);
      // Attributes are left alone.
      else if (node.type === 'tag' && !KEPT_AS_IS.has(node.name)) walk(node.children ?? []);
    }
  };
  walk($.root().contents().get());
  return $.html();
}
