import * as cheerio from 'cheerio';
import { foldLetters } from '../letters.js';

/**
 * A page as a Webflow CMS item (Send to CMS #1331, phase 2): its rich text
 * as Webflow keeps it, a slug Webflow takes, and the item's fields by the
 * brand's field map (brand_cms_connections.field_map, 00283). The steps a
 * rich text field shares are exported for Framer's (framerItems.js).
 */

/** What Webflow's rich text keeps; other elements give way to their content. */
const KEEP = new Set([
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'strong',
  'b',
  'em',
  'i',
  'sup',
  'sub',
  'br',
]);
/** The blocks rich text keeps at the top: anything else there goes in a paragraph. */
const BLOCKS = new Set(['h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'ul', 'ol']);
/** What a table cell keeps: its words, links and emphasis. */
const CELL_KEEP = new Set(['a', 'strong', 'b', 'em', 'i']);
/** Media, left out until workspace files (CHAT-06, #1331). */
const MEDIA = 'img, picture, video, audio, svg, canvas, iframe, embed, object';
/** Left out with what they hold: scripts (the JSON-LD has its own field), forms and rules. */
const DROP =
  'script, style, source, track, map, hr, noscript, template, form, button, input, select, textarea';
/** The meta description's fallback: the page's opening words, as long as a search result shows. */
const OPENING_CHARS = 160;
/** Webflow's longest name and plain text it's sent here. */
export const NAME_CHARS = 256;

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const squash = (value) => String(value).replace(/\s+/g, ' ').trim();

/**
 * Attributes go but a link's address and target, and those `attrs` keeps
 * by tag (tag → names; Framer's table cells keep their spans).
 */
function bare($, el, attrs = {}) {
  const tag = el.tagName?.toLowerCase();
  for (const name of Object.keys(el.attribs ?? {})) {
    if (tag === 'a' && (name === 'href' || name === 'target')) continue;
    if (attrs[tag]?.has(name)) continue;
    $(el).removeAttr(name);
  }
}

/**
 * A table cell as one line: its paragraphs, items and lines a space apart,
 * its links and emphasis kept.
 */
export function cellHtml($, cell) {
  const $cell = $(cell).clone();
  $cell.find('br').replaceWith(' ');
  $cell
    .find('p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, dt, dd')
    .prepend(' ')
    .append(' ');
  for (const el of $cell.find('*').toArray().reverse()) {
    if (CELL_KEEP.has(el.tagName?.toLowerCase())) bare($, el);
    else $(el).replaceWith($(el).contents());
  }
  return squash($cell.html() ?? '');
}

/** A table's own rows, not those of a table inside one of its cells. */
export const ownRows = ($, table) =>
  $(table)
    .find('tr')
    .toArray()
    .filter((row) => $(row).closest('table')[0] === table);

/** The images (and video, SVG) a page loses: a picture once, by its image or its own. */
export const imagesIn = ($) =>
  $('img, video, svg').length + $('picture').filter((_, p) => !$(p).find('img').length).length;

/** Scripts, styles, forms and rules go with what they hold, and comments go. */
export function dropUnkept($) {
  $(DROP).remove();
  $('*')
    .contents()
    .add($.root().contents())
    .filter((_, node) => node.type === 'comment')
    .remove();
}

/**
 * A table as a list, a row an item ("Header: cell · …"), its header naming
 * each cell; an empty table goes.
 */
export function tableAsList($, table) {
  const rows = ownRows($, table);
  const own = (row) =>
    $(row)
      .children('th, td')
      .toArray()
      .map((cell) => cellHtml($, cell));
  const head =
    rows.length && $(rows[0]).children('th').length
      ? $(rows[0])
          .children('th, td')
          .toArray()
          .map((cell) => squash($(cell).text()))
      : null;
  const items = (head ? rows.slice(1) : rows)
    .map((row) =>
      own(row)
        .map((value, i) =>
          value && head?.[i] ? `<strong>${escape(head[i])}</strong>: ${value}` : value,
        )
        .filter(Boolean)
        .join(' · '),
    )
    .filter(Boolean);
  $(table).replaceWith(
    items.length ? `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>` : '',
  );
}

/**
 * A product card or grid (the editor's productBlock.ts, shoppingBlocks.js)
 * as a list: a product an item, its name linked, its price after it.
 */
export function productsAsList($) {
  $('.getcito-products').each((_, grid) => {
    const items = $(grid)
      .find('a.getcito-product')
      .toArray()
      .flatMap((card) => {
        const name = squash($(card).find('strong').text());
        if (!name) return [];
        const price = squash($(card).find('span').text());
        const $item = $('<li></li>').append($(card).text(name));
        if (price) $item.append(` ${escape(price)}`);
        return [$item];
      });
    $(grid).replaceWith(items.length ? $('<ul></ul>').append(items) : '');
  });
}

/** Media goes; a figure of media with its caption, a figure of words (a table's) keeps them. */
export function dropMedia($) {
  $('figure').each((_, figure) => {
    if ($(figure).find(MEDIA).length) $(figure).remove();
  });
  $(MEDIA).remove();
}

/**
 * The last steps of a rich text field: elements it doesn't keep give way to
 * their content (inside out, so an element's children are settled before
 * it), attributes go but a link's address and target (and `attrs`, as
 * bare() reads it), an item outside a list is a paragraph, words and inline
 * elements at the top go in paragraphs a run at a time (`blocks`: what
 * stands at the top on its own), and the paragraphs, items and lists a
 * removal left empty go.
 */
export function settleRichText($, { keep, blocks, attrs = {} }) {
  for (const el of $('*').toArray().reverse()) {
    if (keep.has(el.tagName?.toLowerCase())) bare($, el, attrs);
    else $(el).replaceWith($(el).contents());
  }
  $('li').each((_, el) => {
    if (!$(el).parent().is('ul, ol')) el.tagName = 'p';
  });

  let run = [];
  const wrap = () => {
    if (run.some((node) => squash($(node).text()))) $(run).wrapAll('<p></p>');
    else $(run).remove();
    run = [];
  };
  for (const node of $.root().contents().toArray()) {
    if (node.type === 'tag' && blocks.has(node.tagName.toLowerCase())) wrap();
    else if (node.type === 'tag' || node.type === 'text') run.push(node);
  }
  wrap();

  $('p, li, h2, h3, h4, h5, h6, blockquote').each((_, el) => {
    if (!squash($(el).text()) && !$(el).find('br').length) $(el).remove();
  });
  $('ul, ol').each((_, el) => {
    if (!$(el).children('li').length) $(el).remove();
  });
}

/**
 * A page's publishable HTML as Webflow's rich text keeps it:
 *   - a table becomes a list, a row an item ("Header: cell · …"), a table in
 *     a cell first: rich text has no tables (#1331);
 *   - a product card or grid becomes a list, a product an item ("Name $189.00");
 *   - images and media are left out until workspace files (CHAT-06, #1331),
 *     a figure of one with its caption; scripts (the JSON-LD has its own
 *     field), embeds, forms and rules go too;
 *   - the page's title is the item's name, so a heading 1 left in the body
 *     reads as a heading 2;
 *   - a code block, a definition list, a caption and words outside a block
 *     are paragraphs, an item outside a list too;
 *   - any other element gives way to its content, and attributes go but a
 *     link's address and target.
 * Returns the HTML, and how many tables and images it changed (the send's note).
 */
export function toWebflowRichText(html) {
  const $ = cheerio.load(String(html ?? ''), null, false);
  const changed = {
    tables: $('table').filter((_, t) => !$(t).parents('table').length).length,
    images: imagesIn($),
  };
  dropUnkept($);
  // Inner tables first: a cell holding one reads it as its list.
  for (const table of $('table').toArray().reverse()) tableAsList($, table);
  productsAsList($);
  dropMedia($);
  $('h1').each((_, el) => {
    el.tagName = 'h2';
  });
  $('pre').each((_, el) => {
    $(el).replaceWith(`<p>${escape($(el).text().trim())}</p>`);
  });
  $('dt, dd, figcaption, caption').each((_, el) => {
    $(el).replaceWith(`<p>${$(el).html() ?? ''}</p>`);
  });
  settleRichText($, { keep: KEEP, blocks: BLOCKS });
  return { html: $.html().trim(), changed };
}

/**
 * A slug Webflow takes: lowercase letters, digits, '-' and '_', starting
 * with a letter, digit or '_' (marks taken off, "ç" → "c"). Null when
 * nothing of it is left (a slug in another script).
 */
export function webflowSlug(value) {
  const slug = foldLetters(value)
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200)
    .replace(/-+$/, '');
  return slug || null;
}

/** The page's opening words, cut at a word: its meta description when it has none. */
export function openingWords(html) {
  const text = squash(
    cheerio
      .load(String(html ?? ''), null, false)
      .root()
      .text(),
  );
  if (text.length <= OPENING_CHARS) return text;
  const cut = text.slice(0, OPENING_CHARS - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 80 ? cut.slice(0, space) : cut).trim()}…`;
}

/**
 * The item's fields: its name and slug, and each part of the page in the
 * field the brand's map gives it. The meta title falls back to the title,
 * the meta description to the page's opening words. JSON-LD goes as its
 * JSON (for an embed in the collection's template), empty when the page has
 * none, so an item sent again loses what the page no longer says. The date
 * is `sentAt` as Webflow takes it (ISO 8601), only for a new item: one sent
 * again keeps its own (a blog template's publish date).
 */
export function fieldDataFor({ page, slug, body, jsonLd, sentAt }, fieldMap) {
  const data = { name: squash(page.title).slice(0, NAME_CHARS), slug };
  if (fieldMap.body) data[fieldMap.body] = body;
  if (fieldMap.metaTitle) {
    data[fieldMap.metaTitle] = squash(page.metaTitle || page.title).slice(0, NAME_CHARS);
  }
  if (fieldMap.metaDescription) {
    data[fieldMap.metaDescription] = squash(page.metaDescription) || openingWords(body);
  }
  if (fieldMap.jsonLd) data[fieldMap.jsonLd] = jsonLd?.length ? jsonLdText(jsonLd) : '';
  if (fieldMap.reviewer) data[fieldMap.reviewer] = squash(page.reviewer ?? '').slice(0, NAME_CHARS);
  if (fieldMap.date && sentAt) data[fieldMap.date] = sentAt.toISOString();
  return data;
}

/**
 * A page's JSON-LD as one field's text: one block as itself, several as a
 * list. Every "<" escaped: nothing in it can end or open a tag in the
 * embed's script.
 */
export function jsonLdText(jsonLd) {
  return JSON.stringify(jsonLd.length === 1 ? jsonLd[0] : jsonLd).replace(/</g, '\\u003c');
}
