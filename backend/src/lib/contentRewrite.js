import { randomBytes } from 'crypto';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { HEADING_LIMITS, passageKey } from './contentAgent.js';
import { HEALTH_RULE } from './contentHealth.js';
import { RESEARCH_RULE } from './contentResearch.js';
import { linkKey } from './contentLinks.js';
import { sourcesField } from './contentSources.js';
import { textLength } from './pageContent.js';

export { textLength };

/**
 * Rewrite the page to these rules (Content Editor): the Content Agent
 * rewrites a whole page in one call, left as ONE suggestion (kind 'page',
 * 00247) for a person to compare and accept or reject. Small edits stay with
 * Fix open rules (contentAgent.js); this one is for a page far from its
 * Length, or with many rules open.
 *
 * What the page keeps word for word never reaches the model to rewrite:
 * each passage AI answers quote today (locked), table, image, HTML block,
 * quote and JSON-LD script goes as a [[KEEP n]] line, described under the
 * page so the model writes around it, and is put back as it was after the
 * model answers. A rewrite that drops one is refused.
 */

/** The most text a page sent whole may hold, its kept blocks left out. */
export const MAX_REWRITE_CHARS = 60_000;

/** The longest rewritten page kept (00247's check). */
export const MAX_PAGE_HTML = 500_000;

/** Blocks kept as they are, never rewritten. */
const KEPT_BLOCKS = new Set(['table', 'img', 'figure', 'blockquote', 'script', 'pre', 'hr']);

/** The tags a rewritten page may hold; anything else is unwrapped to its text. */
const PAGE_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'br',
  'a',
]);
/** Inline content a line of text at the page's root is wrapped with in a paragraph. */
const INLINE_TAGS = new Set(['strong', 'em', 'b', 'i', 'br', 'a']);

export const rewriteSchema = z.object({
  html: z.string().describe('The whole page rewritten, as HTML.'),
  reason: z.string().describe('One short sentence on what changed.'),
  sources: sourcesField,
});

export const REWRITE_SYSTEM_PROMPT = `You are the Content Agent for Answer Engine Optimization (AEO). You rewrite one existing web page, whole, so it meets the rules listed and AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Google's AI Overviews) understand it, trust it and cite it. A person compares your page with theirs and accepts or rejects it.

How to rewrite:
- Meet the brand's rules first, then every rule listed and the writer's own rules; when they disagree, the brand's rule wins. Aim at the Length given: the page's whole text, kept blocks included, within 20% of it. When the page is too long, cut repetition, filler and the least useful parts first, and keep its answers, facts and data.
- Keep the page's facts and voice. Use only facts from the page, the brand, the brief and your data, and the ones you ask to have looked up. Never invent numbers, prices, dates, names, customers, sources or quotes. Keep each placeholder the page has in square brackets as it is: the person fills it.
${RESEARCH_RULE}
${HEALTH_RULE}
- Put the numbers (S1, S2…) of the data the page uses in "sources".
- Never give a claim to a source that neither the page nor Your input gives ("According to X…", "X says…"): you don't see what a cited page or a link says. Keep every name the page has (a product, a brand, a person) where it lists or claims it.
- One H1, the page's title, first. Sections are H2s; questions and sub-sections are H3s.
- Answer first: under each heading, a short paragraph that answers it, then the detail.
- Headings are one short line: an H1 up to ${HEADING_LIMITS.h1} characters, others up to ${HEADING_LIMITS.other}. Never put a sentence or an answer in a heading.
- Each kept line, e.g. <p>[[KEEP 1]]</p>, stands for a block kept word for word: a passage AI assistants quote today, a table, an image, an HTML block or a quote, described under the page. Write it exactly as <p>[[KEEP n]]</p>, on its own, outside lists and paragraphs, once each, where it fits the page; never change, split, merge or drop one, and don't repeat what it says.
- Keep the page's links on the words they explain. Link only to a URL the page already links to or one listed for you to link to, copied exactly, as <a href="URL">the words</a>. Never invent a URL, and never link a heading.
- HTML only: h1, h2, h3, p, ul, ol, li, strong, em and a. No Markdown, no code fences, no classes, styles or other tags.
- "reason" says in one short sentence what you changed, e.g. "cut to about 8,000 characters and answered each heading first".
- Write in the page's own language.`;

const clip = (text, max) => {
  const one = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** What a kept block is, in a few words, for the model to write around it. */
function describeKept($, $el, tag, quoted) {
  if (quoted) {
    const what = /^h[1-6]$/.test(tag) ? `the page's ${tag.toUpperCase()}` : 'a passage';
    return `${what} AI assistants quote today: "${clip($el.text(), 160)}"`;
  }
  if (tag === 'table' || $el.find('table').length) {
    return `a table, ${$el.find('tr').length} rows: "${clip($el.find('tr').first().text(), 80)}"`;
  }
  if (tag === 'img' || $el.find('img').length) {
    const alt = ($el.is('img') ? $el : $el.find('img').first()).attr('alt');
    return alt ? `an image: "${clip(alt, 80)}"` : 'an image';
  }
  if (tag === 'blockquote') return `a quote: "${clip($el.text(), 120)}"`;
  if (tag === 'script') return 'structured data (JSON-LD)';
  if ($el.is('[data-html-block]')) return 'an HTML block';
  return `a ${tag} block`;
}

/**
 * The page as the model gets it: each top-level block kept as it is (a
 * locked passage, or a table, image, quote, HTML block or script, or a list
 * holding a locked passage) stands as a <p>[[KEEP n]]</p> line.
 *   - kept: each number's block, as HTML; legend: what each holds;
 *   - h1: the page's own H1 when it isn't kept; h1Token: its number when it is;
 *   - keptChars: the kept blocks' text, which counts toward Length;
 *   - word: the marker's word, KEEP unless the page's own text has it.
 */
export function keepBlocks(html, lockedKeys) {
  const $ = cheerio.load(html || '', null, false);
  const locked = new Set([...lockedKeys].filter(Boolean));
  // A page that writes "[[KEEP" itself gets markers of its own.
  const word = $.root().text().includes('[[KEEP')
    ? `KEEP_${randomBytes(2).toString('hex')}`
    : 'KEEP';
  const kept = new Map();
  const legend = new Map();
  const firstH1 = $('h1').first().get(0) ?? null;
  let h1Token = null;
  for (const el of $.root().children().get()) {
    const tag = el.tagName?.toLowerCase();
    const $el = $(el);
    const passages = $el.is('h1, h2, h3, h4, h5, h6, p')
      ? [$el]
      : $el
          .find('h1, h2, h3, h4, h5, h6, p')
          .get()
          .map((p) => $(p));
    const quoted = passages.some((p) => locked.has(passageKey(p.text())));
    const block =
      KEPT_BLOCKS.has(tag) || $el.is('[data-html-block]') || $el.find('img, table').length > 0;
    if (!quoted && !block) continue;
    const n = kept.size + 1;
    kept.set(n, $.html(el));
    legend.set(n, describeKept($, $el, tag, quoted));
    // Only the page's own H1: one inside an HTML block isn't the title.
    if (firstH1 && (el === firstH1 || $el.find(firstH1).length)) h1Token = n;
    $el.replaceWith(`<p>[[${word} ${n}]]</p>`);
  }
  const keptChars = textLength([...kept.values()].join(' '));
  return {
    html: $.html().trim(),
    kept,
    legend,
    word,
    keptChars,
    h1Token,
    h1: firstH1 && h1Token === null ? $.html(firstH1) : null,
  };
}

/** The page's own text, its kept lines left out: what there is to rewrite. */
export function ownText(page) {
  return textLength(page.html.replace(new RegExp(`\\[\\[${page.word} \\d+\\]\\]`, 'g'), ' '));
}

/** A page's own link that isn't http(s): a path on its site, an anchor, mail or phone. */
const LOCAL_HREF = /^(\/(?![/\\])|#|mailto:|tel:)/i;

/** Where a link's address is looked up in the links a rewrite may keep. */
const hrefKey = (href) => {
  const raw = String(href ?? '').trim();
  return linkKey(raw) ?? (LOCAL_HREF.test(raw) ? `local:${raw}` : null);
};

/**
 * The links a rewrite may keep, by hrefKey: the brand's pages and the
 * draft's sources offered to link to (linkAllowList), and every link the
 * page has, as the page has it (its paths, query and anchor included).
 */
export function rewriteLinks(pageHtml, offered) {
  const links = new Map(offered ?? []);
  const $ = cheerio.load(pageHtml || '', null, false);
  $('a[href]').each((_, el) => {
    const raw = String($(el).attr('href') ?? '').trim();
    const key = hrefKey(raw);
    if (key) links.set(key, raw);
  });
  return links;
}

/**
 * The model's page kept to what the editor takes: the tags above, no
 * attributes or comments, links only to a URL in `links` (never in a
 * heading), H4–H6 as H3, code fences gone and text at the page's root put in
 * paragraphs; one H1, first: a later H1 becomes an H2, and none at all
 * takes the page's own back. With `h1Kept` the H1 is a kept block, so every
 * H1 the model wrote becomes an H2.
 */
export function cleanPageHtml(html, links, { h1Kept = false, originalH1 = null } = {}) {
  const unfenced = String(html ?? '')
    .replace(/^\s*```[a-z]*\s*/i, '')
    .replace(/\s*```\s*$/, '');
  const $ = cheerio.load(unfenced, null, false);
  $('script, style, iframe, object, embed, noscript, template, head, title').remove();
  $.root()
    .find('*')
    .addBack()
    .contents()
    .filter((_, node) => node.type === 'comment')
    .remove();
  $('h4, h5, h6').each((_, el) => {
    el.name = 'h3';
  });
  $('h1').each((i, el) => {
    if (h1Kept || i > 0) el.name = 'h2';
  });
  for (const el of $('*').get().reverse()) {
    const tag = el.tagName?.toLowerCase();
    if (tag === 'a') {
      const key = hrefKey(el.attribs?.href);
      const href = key ? links.get(key) : undefined;
      const inHeading = $(el).parents('h1, h2, h3').length > 0;
      if (href && !inHeading && $(el).text().trim()) {
        for (const name of Object.keys(el.attribs ?? {})) $(el).removeAttr(name);
        $(el).attr('href', href);
      } else {
        $(el).replaceWith($(el).contents());
      }
      continue;
    }
    if (!PAGE_TAGS.has(tag)) {
      $(el).replaceWith($(el).contents());
      continue;
    }
    for (const name of Object.keys(el.attribs ?? {})) $(el).removeAttr(name);
  }
  // Text left at the root (a bare [[KEEP n]], a div unwrapped): one
  // paragraph a line, inline marks kept with their words.
  const root = $.root();
  let run = [];
  const flush = (before) => {
    const html = run.map((node) => $.html(node)).join('');
    for (const node of run) $(node).remove();
    run = [];
    const lines = html
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => cheerio.load(line, null, false).root().text().trim());
    const paragraphs = lines.map((line) => `<p>${line}</p>`).join('');
    if (!paragraphs) return;
    if (before) $(before).before(paragraphs);
    else root.append(paragraphs);
  };
  for (const node of root.contents().get()) {
    if (node.type === 'text' || (node.type === 'tag' && INLINE_TAGS.has(node.name))) {
      run.push(node);
    } else if (run.length) {
      flush(node);
    }
  }
  if (run.length) flush(null);
  if (!h1Kept && !$('h1').length && originalH1) root.prepend(originalH1);
  return $.html().trim();
}

/** Whether the model's answer is a page in HTML, not Markdown or plain text. */
export function isPageHtml(html) {
  const text = String(html ?? '');
  if (/^\s{0,3}#{1,3} \S/m.test(cheerio.load(text, null, false).root().text())) return false;
  return /<(h[1-3]|p|ul|ol)\b/i.test(text);
}

/**
 * The kept blocks put back where the model left their lines, each once,
 * as they were. Answers the page and the numbers it left out; a number left
 * inside other text is taken out of it, and counts as left out. With
 * `h1Token`, the page's kept H1 goes first.
 */
export function restoreKept(html, kept, { word = 'KEEP', h1Token = null } = {}) {
  const $ = cheerio.load(html || '', null, false);
  const only = new RegExp(`^\\s*\\[\\[${word} (\\d+)\\]\\]\\s*$`);
  const any = new RegExp(`\\[\\[${word} \\d+\\]\\]`, 'g');
  const marker = `[[${word} `;
  const placed = new Set();
  // The lines, found first: nothing below may touch a kept block.
  $('p, li, h1, h2, h3').each((_, el) => {
    const match = $(el).text().match(only);
    if (!match) return;
    const n = Number(match[1]);
    if (!kept.has(n) || placed.has(n)) {
      $(el).remove();
      return;
    }
    placed.add(n);
    $(el).attr('data-kept', String(n)).empty();
  });
  // Lines run into other text, and the blocks they leave empty.
  $('*').each((_, el) => {
    for (const node of el.children ?? []) {
      if (node.type === 'text' && node.data.includes(marker))
        node.data = node.data.replace(any, '');
    }
  });
  $('p, li, h1, h2, h3').each((_, el) => {
    if ($(el).is('[data-kept]') || $(el).find('[data-kept]').length) return;
    if (!$(el).text().trim() && !$(el).find('img, br').length) $(el).remove();
  });
  $('ul, ol').each((_, el) => {
    if (!$(el).children().length) $(el).remove();
  });
  // Then the blocks, as they were; one in a list item goes after its list.
  $('[data-kept]').each((_, el) => {
    const n = Number($(el).attr('data-kept'));
    if (el.tagName === 'li') {
      const list = $(el).parent();
      if (list.children().length === 1) list.replaceWith(kept.get(n));
      else {
        list.after(kept.get(n));
        $(el).remove();
      }
      return;
    }
    $(el).replaceWith(kept.get(n));
  });
  if (h1Token !== null && placed.has(h1Token)) {
    const first = $.root().children().first();
    const h1 = $.root()
      .children()
      .filter((_, el) => $.html(el) === kept.get(h1Token))
      .first();
    if (h1.length && first.get(0) !== h1.get(0)) $.root().prepend(h1);
  }
  const missing = [...kept.keys()].filter((n) => !placed.has(n));
  return { html: $.html().trim(), missing };
}
