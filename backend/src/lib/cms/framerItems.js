import * as cheerio from 'cheerio';
import {
  NAME_CHARS,
  cellHtml,
  dropMedia,
  dropUnkept,
  imagesIn,
  jsonLdText,
  openingWords,
  ownRows,
  productsAsList,
  settleRichText,
  squash,
  tableAsList,
  webflowSlug,
} from './webflowItems.js';

/**
 * A page as a Framer CMS item (Send to CMS #1331, phase 2; 00295): its body
 * as Framer's formatted text keeps it, a slug Framer takes, and the item's
 * fields by the brand's field map (brand_cms_connections.field_map: part →
 * field id). The steps it shares with Webflow's rich text come from
 * webflowItems.js.
 */

/**
 * What Framer's formatted text is sent with; other elements give way to
 * their content. Framer doesn't list what it keeps: these are the ones a
 * page needs, tables and code among them.
 */
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
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);
/** The blocks that stand at the top on their own: anything else there goes in a paragraph. */
const BLOCKS = new Set([
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'ul',
  'ol',
  'pre',
  'table',
]);

/** What a table cell keeps of its attributes: how many columns and rows it spans. */
const SPANS = new Set(['colspan', 'rowspan']);
const CELL_ATTRS = { th: SPANS, td: SPANS };

/** A cell's spans, each a whole number from 1 to 1000; any other value goes. */
function spansOf($, cell) {
  return [...SPANS]
    .map((name) => {
      const value = String($(cell).attr(name) ?? '').trim();
      const count = /^\d{1,4}$/.test(value) ? Number(value) : 0;
      return count >= 1 && count <= 1000 ? ` ${name}="${count}"` : '';
    })
    .join('');
}

/**
 * A table as Framer's formatted text keeps it: its own rows, a first row of
 * header cells only as its head, each cell one line of words, links and
 * emphasis (cellHtml) with its spans. Its caption goes before it as a
 * paragraph; a table with no words goes.
 */
function framerTable($, table) {
  const caption = $(table).children('caption').first();
  const note = caption.length ? cellHtml($, caption[0]) : '';
  const rows = ownRows($, table)
    .map((row) =>
      $(row)
        .children('th, td')
        .toArray()
        .map((cell) => ({
          head: cell.tagName.toLowerCase() === 'th',
          spans: spansOf($, cell),
          html: cellHtml($, cell),
        })),
    )
    .filter((cells) => cells.some((cell) => cell.html));
  const before = note ? `<p>${note}</p>` : '';
  if (!rows.length) {
    $(table).replaceWith(before);
    return;
  }
  const head = rows[0].every((cell) => cell.head) ? rows.shift() : null;
  const row = (cells) =>
    `<tr>${cells.map(({ head: th, spans, html }) => (th ? `<th${spans}>${html}</th>` : `<td${spans}>${html}</td>`)).join('')}</tr>`;
  $(table).replaceWith(
    `${before}<table>${head ? `<thead>${row(head)}</thead>` : ''}${
      rows.length ? `<tbody>${rows.map(row).join('')}</tbody>` : ''
    }</table>`,
  );
}

/**
 * A page's publishable HTML as Framer's formatted text keeps it:
 *   - tables stay, a cell's colspan and rowspan with them (a table in a
 *     cell first reads as a line of it, as Webflow's lists read it);
 *   - a product card or grid becomes a list, a product an item ("Name
 *     $189.00"), as for Webflow: formatted text has no grid;
 *   - images and media are left out until workspace files (CHAT-06, #1331),
 *     a figure of one with its caption; scripts (the JSON-LD has its own
 *     field), embeds, forms and rules go too;
 *   - the page's title has its own field, so a heading 1 left in the body
 *     reads as a heading 2; code blocks stay;
 *   - a definition list and a caption are paragraphs, words outside a block
 *     and an item outside a list too;
 *   - any other element gives way to its content, and attributes go but a
 *     link's address and target.
 * Returns the HTML, and how many images it left out (the send's note).
 */
export function toFramerHtml(html) {
  const $ = cheerio.load(String(html ?? ''), null, false);
  const changed = { images: imagesIn($) };
  dropUnkept($);
  // Inner tables first: a cell holding one reads it as a line.
  for (const table of $('table').toArray().reverse()) {
    if ($(table).parents('table').length) tableAsList($, table);
    else framerTable($, table);
  }
  productsAsList($);
  dropMedia($);
  $('h1').each((_, el) => {
    el.tagName = 'h2';
  });
  $('pre').each((_, el) => {
    if (!$(el).text().trim()) $(el).remove();
  });
  $('dt, dd, figcaption').each((_, el) => {
    $(el).replaceWith(`<p>${$(el).html() ?? ''}</p>`);
  });
  settleRichText($, { keep: KEEP, blocks: BLOCKS, attrs: CELL_ATTRS });
  return { html: $.html().trim(), changed };
}

/**
 * The item's slug: lowercase letters, digits and '-' (Webflow's, its '_' a
 * '-'), from the page's slug, else its title, else the draft's own, the
 * same every send (a slug in another script has nothing left).
 */
export function framerSlug(page) {
  const slug = (value) => webflowSlug(String(value ?? '').replace(/_/g, '-'));
  return slug(page.slug) ?? slug(page.title) ?? `page-${page.draftId}`;
}

/**
 * The item's fields, each part of the page in the field the brand's map
 * gives it, as Framer takes them: the title, meta title and description and
 * JSON-LD as text, the body as HTML. The meta title falls back to the
 * title, the meta description to the page's opening words. JSON-LD goes
 * as its JSON, empty when the page has none, so an item sent again loses
 * what the page no longer says. A part the map leaves out isn't sent.
 *
 * @param {{ page: { title: string, metaTitle?: string, metaDescription?: string },
 *   body: string, jsonLd?: object[] }} input
 * @param {Record<string, string>} fieldMap part → field id
 */
export function framerFieldData({ page, body, jsonLd }, fieldMap) {
  const text = (value) => ({ type: 'string', value });
  const data = {};
  if (fieldMap.title) data[fieldMap.title] = text(squash(page.title).slice(0, NAME_CHARS));
  if (fieldMap.body) {
    data[fieldMap.body] = { type: 'formattedText', value: body, contentType: 'html' };
  }
  if (fieldMap.metaTitle) {
    data[fieldMap.metaTitle] = text(squash(page.metaTitle || page.title).slice(0, NAME_CHARS));
  }
  if (fieldMap.metaDescription) {
    data[fieldMap.metaDescription] = text(squash(page.metaDescription ?? '') || openingWords(body));
  }
  // Empty when the page has none: a JSON-LD dropped from the page is cleared in Framer too.
  if (fieldMap.jsonLd) data[fieldMap.jsonLd] = text(jsonLd?.length ? jsonLdText(jsonLd) : '');
  if (fieldMap.reviewer) {
    data[fieldMap.reviewer] = text(squash(page.reviewer ?? '').slice(0, NAME_CHARS));
  }
  return data;
}
