/**
 * Keeps AI fix recommendations truthful and short before they're saved. The
 * model gets the same rules in its prompt; this is the server-side check.
 *
 * - Facts: a number, percentage, price, date or company name must appear in
 *   the page or in the brand data the model was given. A recommendation
 *   leaves the person no research to do (2026-10-30): the audit reads the
 *   page, it doesn't search the web, so a figure or a date the page doesn't
 *   have (a statistic, a count, a year) goes with its sentence. Only what the
 *   brand alone knows stays as a [placeholder] for the person ("Your input
 *   needed" in the report): its customers' names, its prices, and in code
 *   the values its markup needs. A placeholder the model wrote for anything
 *   else ("[source URL]", "[statistic]") goes with its sentence too, and a
 *   recommendation keeps MAX_INPUT_PLACEHOLDERS at most.
 * - Length: the explanation and every sentence of the paste-able draft are at
 *   most 150 characters. Code (JSON-LD/HTML) is exempt from the length rule,
 *   not from the facts rule.
 */

export const MAX_COPY_CHARS = 150;

/** The most placeholders a recommendation's explanation and draft leave the person. */
export const MAX_INPUT_PLACEHOLDERS = 3;

export const PLACEHOLDER = {
  name: '[customer name]',
  metric: '[your figure]',
  price: '[price]',
  date: '[date]',
};

/**
 * What stands, in an explanation or a draft, where a figure or a date the
 * page doesn't have was: a private-use character no text has, so its
 * sentence is found and taken out (dropUnsettled).
 */
const GONE = '\uE000';

/**
 * A placeholder the brand fills: the guard's own forms, or one the model
 * wrote for the brand's own fact ("[your plan]", "[your result]").
 */
const BRAND_OWN = /^\[(?:your\b[^\]]*|customer name|price|date)\]$/i;

// A placeholder already in the text, e.g. "[customer name]". Letters and
// spaces only, so a JSON array such as ["a", "b"] never reads as one.
const PLACEHOLDER_SOURCE = String.raw`\[[A-Za-z][A-Za-z ]{1,38}\]`;

// Left as they are: URLs and domains (their digits aren't claims) and the
// placeholders the model already wrote.
const MASK_RE = new RegExp(
  [
    String.raw`\bhttps?:\/\/[^\s"'<>)]+`,
    String.raw`\bwww\.[^\s"'<>)]+`,
    String.raw`\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|ai|co|dev|app|edu|gov|info)\b(?:\/[^\s"'<>)]*)?`,
    PLACEHOLDER_SOURCE,
  ].join('|'),
  'gi',
);

const NUM = String.raw`\d+(?:[.,]\d+)*`;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;

// One pass over the text, most specific shape first.
const VALUE_RE = new RegExp(
  [
    `(?<date>\\b\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?(?![\\w-])|\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?(?:\\s+\\d{4})?\\b|\\b${MONTH}\\.?\\s+\\d{4}\\b)`,
    `(?<price>[$€£¥₹₺]\\s?${NUM}(?:\\s?(?:k|m|bn)\\b)?|\\b${NUM}\\s?(?:usd|eur|gbp|try|dollars?|euros?|pounds?)\\b)`,
    `(?<percent>\\b${NUM}\\s?(?:%|percent\\b|per cent\\b))`,
    `(?<year>\\b(?:19|20)\\d{2}\\b)`,
    `(?<number>(?<![\\w.#/-])${NUM}(?:\\s?[–-]\\s?${NUM})?(?:[kmx×+](?![a-z])|\\s?(?:million|billion|thousand)\\b)?(?![\\w%]))`,
  ].join('|'),
  'gi',
);

// "Write a 120–150 character description", "add 3–5 questions", "an
// og:image of 1200×630 pixels", "under 200 KB": writing and build
// instructions, not claims. Only the explanation may use them.
const INSTRUCTION_UNIT_RE =
  /^\s*(?:[×x]\s*\d+\s*)?(?:[a-z-]+\s+){0,2}(?:characters?|chars?|words?|sentences?|paragraphs?|questions?|q&as?|pairs?|answers?|items?|bullets?|points?|steps?|headings?|subheadings?|h[1-6]s?|sections?|links?|sources?|citations?|examples?|faqs?|lines?|tips?|terms?|definitions?|quotes?|quotations?|statistics?|stats?|images?|px|pixels?|kb|mb|kilobytes?|megabytes?|ms|milliseconds?|seconds?|secs?)\b/i;

// "A Flesch reading ease of 60", "a score above 70": targets to aim for.
const TARGET_BEFORE_RE =
  /\b(?:score|ease|grade|rating|ratio|density)\s+(?:of\s+)?(?:at least\s+|above\s+|below\s+|under\s+|over\s+|around\s+)?$/i;

// "Step 2", "Top 10", or "1." at the start of a line: numbering, not data.
const NUMBERING_WORD_RE = /\b(?:step|part|phase|tier|level|top)\s*$/i;
const NUMBERING_AFTER_RE = /^[.)]\s/;
// JSON-LD keys whose numbers are structure, not claims ("position": 1).
const STRUCTURAL_JSON_KEY_RE = /^(?:position|width|height)$/i;

// Words that introduce a company or customer name: "brands like TechFlow".
const NAME_CUE_RE =
  /\b(?:(?:brands|companies|customers|clients|teams|partners|businesses|organi[sz]ations)\s+(?:like|such as|including)|trusted by|used by|loved by|chosen by|relied on by|teams at|worked with)\s+/gi;
// CamelCase names such as "TechFlow" or "HubSpot".
const CAMEL_RE = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g;
const CAPITALISED_RE = /^[A-Z][\w&'’.-]*/;

// Platforms a recommendation may always name: the AI engines and sources the
// whole product is about.
const ALWAYS_KNOWN_NAMES = new Set(
  [
    'Google',
    'ChatGPT',
    'OpenAI',
    'Perplexity',
    'Gemini',
    'Claude',
    'Anthropic',
    'Copilot',
    'Microsoft',
    'Bing',
    'Grok',
    'DeepSeek',
    'Meta',
    'Wikipedia',
    'Wikidata',
    'YouTube',
    'Reddit',
    'LinkedIn',
    'Quora',
    'GitHub',
    'G2',
    'Capterra',
    'Trustpilot',
    'Schema.org',
    'JavaScript',
    'WordPress',
    'TypeScript',
    'PageSpeed',
    'OpenGraph',
    // AI crawlers a recommendation may name
    'PerplexityBot',
    'ClaudeBot',
    'SearchBot',
    'SaaS',
    'PhD',
    'AI Overviews',
    'AI Mode',
    // schema.org types a recommendation may name
    'HowTo',
    'BlogPosting',
    'NewsArticle',
    'WebPage',
    'WebSite',
    'AboutPage',
    'ContactPage',
    'CollectionPage',
    'ProfilePage',
    'LocalBusiness',
    'SoftwareApplication',
    'ItemList',
    'ListItem',
    'BreadcrumbList',
    'AggregateRating',
    'QAPage',
    'ImageObject',
    'VideoObject',
    'ContactPoint',
    'PostalAddress',
    'DefinedTerm',
    'DefinedTermSet',
    'JobPosting',
  ].map((n) => n.toLowerCase()),
);

function normNumber(raw) {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : raw;
}

function digitGroups(text) {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? [];
}

// Numbers the known text uses as percentages, and as prices (next to a
// currency, or as a JSON-LD price).
const KNOWN_PERCENT_RE = /(\d+(?:[.,]\d+)*)\s?(?:%|percent\b|per cent\b)/gi;
const KNOWN_PRICE_RE =
  /[$€£¥₹₺]\s?(\d+(?:[.,]\d+)*)|(\d+(?:[.,]\d+)*)\s?(?:usd|eur|gbp|try|dollars?|euros?|pounds?)\b|"(?:price|lowPrice|highPrice|amount)"\s*:\s*"?(\d+(?:[.,]\d+)*)/gi;

function numberSet(groups) {
  const set = new Set();
  for (const group of groups) {
    set.add(normNumber(group));
    set.add(group);
  }
  return set;
}

/**
 * @typedef {Object} KnownFacts
 * @property {string} text            all known text, lowercased
 * @property {Set<string>} numbers    every number in it
 * @property {Set<string>} percents   numbers it uses as percentages
 * @property {Set<string>} prices     numbers it uses as prices
 */

/**
 * Everything a recommendation may quote: the page's text, title, meta tags
 * and JSON-LD, plus the brand data the model was given.
 *
 * @param {{ pageText?: string, extras?: string[], brand?: { name?: string|null, description?: string|null, domains?: string[] } | null }} input
 * @returns {KnownFacts}
 */
export function buildKnownFacts({ pageText = '', extras = [], brand = null } = {}) {
  const parts = [pageText, ...extras];
  if (brand) parts.push(brand.name ?? '', brand.description ?? '', ...(brand.domains ?? []));
  const text = parts.filter(Boolean).join(' \n ');
  return {
    text: text.toLowerCase(),
    numbers: numberSet(digitGroups(text)),
    percents: numberSet([...text.matchAll(KNOWN_PERCENT_RE)].map((m) => m[1])),
    prices: numberSet([...text.matchAll(KNOWN_PRICE_RE)].map((m) => m[1] ?? m[2] ?? m[3])),
  };
}

/** Runs `fn` on the stretches of `text` outside URLs and placeholders. */
function outsideMasks(text, fn) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(MASK_RE)) {
    out += fn(text.slice(last, m.index), out);
    out += m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last), out);
}

function numbersIn(value, set) {
  return digitGroups(value).every((g) => set.has(normNumber(g)) || set.has(g));
}

// The JSON-LD key a value belongs to.
function jsonKey(before) {
  return before.match(/"([@\w]+)"\s*:\s*"?[^"]*$/)?.[1] ?? '';
}

// In JSON-LD, the key a value belongs to picks the placeholder: "price": 49
// becomes "price": "[price]".
function jsonPlaceholder(key, fallback) {
  if (/price|amount|cost/i.test(key)) return PLACEHOLDER.price;
  if (/date|time|year/i.test(key)) return PLACEHOLDER.date;
  return fallback;
}

/**
 * Replaces numbers, percentages, prices and dates that the page and brand
 * data don't contain. With `figure`, a number, percentage or date in words
 * becomes it instead of a placeholder (guardFacts takes its sentence out).
 *
 * @param {string} text
 * @param {KnownFacts} known
 * @param {{ field: 'recommendation' | 'draft' | 'code', figure?: string | null }} opts
 * @returns {{ text: string, hits: number }}
 */
export function replaceUnknownValues(text, known, { field, figure = null }) {
  let hits = 0;
  const result = outsideMasks(text, (chunk, done) =>
    chunk.replace(VALUE_RE, (match, ...args) => {
      const groups = args.at(-1);
      const offset = args.at(-3);
      const before = done + chunk.slice(0, offset);
      const after = chunk.slice(offset + match.length);

      // "2000 words" is a count, not a year.
      const isYear = groups.year && !INSTRUCTION_UNIT_RE.test(after);
      let placeholder;
      if (groups.date) {
        // An ISO date is known when its day is, whatever time follows it.
        const day = /^\d{4}-\d{2}-\d{2}/.test(match) ? match.slice(0, 10) : match;
        if (known.text.includes(day.toLowerCase())) return match;
        placeholder = PLACEHOLDER.date;
      } else if (groups.price) {
        if (numbersIn(match, known.prices)) return match;
        placeholder = PLACEHOLDER.price;
      } else if (groups.percent) {
        if (numbersIn(match, known.percents)) return match;
        placeholder = PLACEHOLDER.metric;
      } else if (isYear) {
        if (numbersIn(match, known.numbers)) return match;
        placeholder = PLACEHOLDER.date;
      } else {
        if (numbersIn(match, known.numbers)) return match;
        if (field === 'recommendation' && INSTRUCTION_UNIT_RE.test(after)) return match;
        if (field === 'recommendation' && TARGET_BEFORE_RE.test(before)) return match;
        if (field === 'code' && STRUCTURAL_JSON_KEY_RE.test(jsonKey(before))) return match;
        if (field !== 'code' && /^\d+$/.test(match)) {
          const line = before.slice(before.lastIndexOf('\n') + 1);
          if (NUMBERING_WORD_RE.test(line)) return match;
          if (/^\s*$/.test(line) && NUMBERING_AFTER_RE.test(after)) return match;
        }
        placeholder = PLACEHOLDER.metric;
      }

      hits += 1;
      // A figure or a date in words: `figure` (GONE, from guardFacts), so its sentence goes.
      if (field !== 'code') {
        return figure && placeholder !== PLACEHOLDER.price ? figure : placeholder;
      }
      const chosen = jsonPlaceholder(jsonKey(before), placeholder);
      // A bare JSON number needs quotes to stay valid JSON.
      return /:\s*$/.test(before) ? `"${chosen}"` : chosen;
    }),
  );
  return { text: result, hits };
}

function nameKnown(name, known) {
  const lower = name.toLowerCase();
  return ALWAYS_KNOWN_NAMES.has(lower) || known.text.includes(lower);
}

// The names listed right after a cue: "TechFlow, Acme Corp and Zenith".
function namesAfterCue(rest) {
  const names = [];
  let pos = 0;
  for (;;) {
    const lead = rest.slice(pos).match(/^\s*/)[0].length;
    const word = rest.slice(pos + lead).match(CAPITALISED_RE);
    if (!word) break;
    let start = pos + lead;
    let end = start + word[0].length;
    // Further capitalised words belong to the same name ("Blue Bottle
    // Coffee"), never past the end of its sentence: "TechFlow. Their team"
    // is a name, then the next sentence, which may go on its own.
    for (
      let m;
      !rest.slice(start, end).endsWith('.') && (m = rest.slice(end).match(/^\s+([A-Z][\w&'’.-]*)/));
    ) {
      end += m[0].length;
    }
    const raw = rest.slice(start, end);
    const name = raw.replace(/[.,;:]+$/, '');
    names.push({ start, end: start + name.length, name });
    const sep = rest.slice(start + name.length).match(/^\s*(?:,|and\b|or\b|&)\s*/i);
    if (!sep) break;
    pos = start + name.length + sep[0].length;
  }
  return names;
}

/**
 * Replaces company and customer names the page and brand data don't contain:
 * CamelCase names anywhere, and capitalised names after "like", "such as",
 * "trusted by" and similar.
 *
 * @param {string} text
 * @param {KnownFacts} known
 * @returns {{ text: string, hits: number }}
 */
export function replaceUnknownNames(text, known) {
  let hits = 0;
  const result = outsideMasks(text, (chunk) => {
    const spans = [];
    for (const cue of chunk.matchAll(NAME_CUE_RE)) {
      const from = cue.index + cue[0].length;
      for (const n of namesAfterCue(chunk.slice(from))) {
        spans.push({ start: from + n.start, end: from + n.end, name: n.name });
      }
    }
    for (const m of chunk.matchAll(CAMEL_RE)) {
      spans.push({ start: m.index, end: m.index + m[0].length, name: m[0] });
    }
    const unknown = spans
      .filter((s) => !nameKnown(s.name, known))
      .sort((a, b) => a.start - b.start)
      .filter((s, i, all) => i === 0 || s.start >= all[i - 1].end);
    let out = '';
    let last = 0;
    for (const s of unknown) {
      out += chunk.slice(last, s.start) + PLACEHOLDER.name;
      last = s.end;
      hits += 1;
    }
    return out + chunk.slice(last);
  });
  // "[customer name], [customer name] and [customer name]" reads as one.
  const collapsed = result.replace(
    /\[customer name\](?:\s*(?:,|and|or|&)\s*\[customer name\])+/g,
    PLACEHOLDER.name,
  );
  return { text: collapsed, hits };
}

/**
 * Where a sentence ends inside a line, for taking one out: before a capital,
 * a digit, a quote, a bracket or what stands for a figure that went.
 */
const DROP_BREAK_RE = new RegExp(
  // "e.g. Google's guide" goes on: an abbreviation, not a sentence's end.
  `(?<=[.!?…])(?<!\\b(?:[Ee]\\.[Gg]|[Ii]\\.[Ee]|vs|cf)\\.)\\s+(?=["“'([A-Z0-9${GONE}])`,
);

/** "1. ", "2) " or "- " that starts a line: it stays or goes with the line's text. */
const LIST_MARKER_RE = /^\s*(?:\d{1,3}[.)]|[-*•])\s+/;

/** The two lines of a Q&A pair ("Q: …" then "A: …"): one goes with the other. */
const QUESTION_LINE_RE = /^\s*(?:\*\*)?(?:q|question)\s*\d*\s*(?:\*\*)?\s*:/i;
const ANSWER_LINE_RE = /^\s*(?:\*\*)?(?:a|answer)\s*\d*\s*(?:\*\*)?\s*:/i;

/** The placeholders a text holds, as written; "[a link](…)" is a link, not one. */
const placeholdersOf = (text) => text.match(new RegExp(`${PLACEHOLDER_SOURCE}(?!\\()`, 'g')) ?? [];

/**
 * A text with the sentences it can't keep taken out, line by line: one with
 * a figure that went (GONE), one with a placeholder that isn't the brand's
 * own, and one past what is `left` of a recommendation's placeholders.
 * Returns the text ('' with nothing left) and how many sentences went.
 */
function dropUnsettled(text, budget) {
  let dropped = 0;
  const source = text.split('\n');
  const lines = source.map((line) => {
    if (!line.trim()) return line;
    const marker = line.match(LIST_MARKER_RE)?.[0] ?? '';
    const kept = line
      .slice(marker.length)
      .split(DROP_BREAK_RE)
      .filter((sentence) => {
        const own = placeholdersOf(sentence);
        const keep =
          !sentence.includes(GONE) &&
          own.every((p) => BRAND_OWN.test(p)) &&
          own.length <= budget.left;
        if (keep) budget.left -= own.length;
        else dropped += 1;
        return keep;
      });
    return kept.length ? marker + kept.join(' ') : null;
  });
  // A question whose answer went goes too, and an answer whose question went.
  for (let i = 0; i + 1 < source.length; i++) {
    if (!QUESTION_LINE_RE.test(source[i]) || !ANSWER_LINE_RE.test(source[i + 1])) continue;
    if ((lines[i] === null) === (lines[i + 1] === null)) continue;
    lines[i] = null;
    lines[i + 1] = null;
    dropped += 1;
  }
  // A line that went leaves no run of empty lines (between Q&A pairs) behind.
  const out = lines
    .filter((line) => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: out, dropped };
}

/**
 * The facts rule for one recommendation: a figure or a date it adds goes
 * with its sentence, a name or a price it adds becomes the brand's
 * placeholder, at most MAX_INPUT_PLACEHOLDERS in its explanation and draft
 * (dropUnsettled). Its code keeps a placeholder for each value its markup
 * needs. An explanation left with no sentence is '': the item goes
 * (generateRecommendations).
 *
 * @template {{ recommendation: string, draft: string|null, code?: string|null }} R
 * @param {R} rec
 * @param {KnownFacts} known
 * @returns {{ rec: R, hits: number }}
 */
export function guardFacts(rec, known) {
  let hits = 0;
  const budget = { left: MAX_INPUT_PLACEHOLDERS };
  const prose = (text, field) => {
    if (!text) return text ?? null;
    const values = replaceUnknownValues(text, known, { field, figure: GONE });
    const names = replaceUnknownNames(values.text, known);
    const settled = dropUnsettled(names.text, budget);
    hits += values.hits + names.hits + settled.dropped;
    return settled.text;
  };
  const recommendation = prose(rec.recommendation, 'recommendation') ?? '';
  const draft = prose(rec.draft, 'draft') || null;
  let code = rec.code ?? null;
  if (code) {
    const values = replaceUnknownValues(code, known, { field: 'code' });
    hits += values.hits;
    code = values.text;
  }
  return { rec: { ...rec, recommendation, draft, code }, hits };
}

// Where one sentence of a line ends and the next begins.
const SENTENCE_BREAK_RE = /(?<=[.!?…])\s+(?=["“'([A-Z0-9])/;

/** Sentences of a draft, line by line. */
export function sentencesOf(text) {
  return (text ?? '')
    .split('\n')
    .flatMap((line) => line.split(SENTENCE_BREAK_RE))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Which parts of a recommendation are over the limit. */
export function tooLongParts(rec) {
  return {
    recommendation: (rec.recommendation ?? '').length > MAX_COPY_CHARS,
    draft: sentencesOf(rec.draft).some((s) => s.length > MAX_COPY_CHARS),
  };
}

/** True when the explanation or a draft sentence is over the limit. */
export function needsShortening(rec) {
  const parts = tooLongParts(rec);
  return parts.recommendation || parts.draft;
}

/**
 * Cuts `text` to at most `max` characters at a word boundary, ending in "…".
 * A link the cut would split is left out whole.
 */
export function cutAtWord(text, max = MAX_COPY_CHARS) {
  if (text.length <= max) return text;
  let head = text.slice(0, max - 1);
  const link = [...text.matchAll(/https?:\/\/\S+/g)].find(
    (m) => m.index < max - 1 && m.index + m[0].length > max - 1,
  );
  if (link) head = text.slice(0, link.index);
  else {
    const space = head.lastIndexOf(' ');
    if (space > max * 0.6) head = head.slice(0, space);
  }
  return `${head.replace(/[\s,;:–-]+$/, '')}…`;
}

/**
 * The last resort after one rewrite: the explanation keeps its first
 * sentence when that fits, and any long sentence is cut at a word boundary.
 *
 * @template {{ recommendation: string, draft: string|null }} R
 * @param {R} rec
 * @returns {{ rec: R, cuts: number }}
 */
export function cutToLength(rec) {
  let cuts = 0;
  let recommendation = rec.recommendation ?? '';
  if (recommendation.length > MAX_COPY_CHARS) {
    const first = sentencesOf(recommendation)[0] ?? '';
    recommendation = first.length <= MAX_COPY_CHARS ? first : cutAtWord(recommendation);
    cuts += 1;
  }
  let draft = rec.draft ?? null;
  if (draft && needsShortening({ recommendation: '', draft })) {
    draft = draft
      .split('\n')
      .map((line) =>
        line
          .split(SENTENCE_BREAK_RE)
          .map((s) => {
            if (s.trim().length <= MAX_COPY_CHARS) return s;
            cuts += 1;
            const lead = s.match(/^\s*/)[0];
            return lead + cutAtWord(s.trim());
          })
          .join(' '),
      )
      .join('\n');
  }
  return { rec: { ...rec, recommendation, draft }, cuts };
}
